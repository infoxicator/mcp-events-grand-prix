import {expect,test} from '@playwright/test';

for(const sep of [false,true]){
 test(`historical benchmark delivers and scores a ${sep?'SEP':'ChatGPT'} strategy event`,async({request,page,baseURL})=>{
  const token='e'.repeat(64),version='2026-07-28',eventName='grand_prix.strategy_required';
  const rpc=async(method:string,params:Record<string,unknown>)=>{
   const response=await request.post(sep?'/mcp/sep-events':'/mcp',{
    headers:{Accept:'application/json, text/event-stream',...(sep?{
     Authorization:'Bearer '+token,'Mcp-Protocol-Version':version,'Mcp-Method':method,...(params.name?{'Mcp-Name':String(params.name)}:{}),
    }:{})},
    data:{jsonrpc:'2.0',id:crypto.randomUUID(),method,params:sep?{...params,_meta:{
     'io.modelcontextprotocol/protocolVersion':version,
     'io.modelcontextprotocol/clientInfo':{name:'Replay fixture',version:'1'},
     'io.modelcontextprotocol/clientCapabilities':{},
    }}:params},
   });
   return response.json();
  };
  const call=(name:string,args:object={})=>rpc('tools/call',{name,arguments:args});
  const catalog=await call('list_grand_prix_replays');
  expect(catalog.result.structuredContent.races).toEqual(expect.arrayContaining([
   expect.objectContaining({id:'9590',year:2024,name:'Italian Grand Prix'}),
   expect.objectContaining({id:'9558',year:2024,name:'British Grand Prix'}),
  ]));
  const opening=await call('open_grand_prix_replay',{race:'9590',driver:16});
  const access=opening.result.structuredContent;
  expect(access).toMatchObject({driver:{number:16,code:'LEC'},mode:'historical-replay',checkpoints:expect.any(Number)});
  const controller=new URL(access.url);
  const api='/api/replay-benchmarks/'+access.room;
  const viewerHeaders={Authorization:'Bearer '+new URLSearchParams(controller.hash.slice(1)).get('key'),Origin:baseURL!};
  expect((await request.get(api+'/status')).status()).toBe(403);
  expect((await request.post(api+'/next',{headers:viewerHeaders})).status()).toBe(409);
  const endpoint=(sep?'/sep-callback/':'/webhook/mcp-events/')+crypto.randomUUID();
  const url=(sep?'https://callback.example.test':'https://connectors.api.openai.com')+endpoint;
  const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
  const subscription={name:eventName,arguments:access.event_filter,delivery:{mode:'webhook',url,secret}};
  const subscribed=await rpc('events/subscribe',subscription);
  expect(subscribed.result.id).toMatch(/^sub_/);

  await page.goto(access.url);
  await page.getByRole('button',{name:'Start benchmark'}).click();
  await expect(page.locator('#replay-benchmark-status')).toContainText('Decision 1');
  const deliveries=async()=>{
   const response=await request.get('http://127.0.0.1:8798'+endpoint);
   const value=await response.json();
   return sep?value.attempts.filter((a:{status:number})=>a.status===200).map((a:{value:unknown})=>a.value):value.events;
  };
  await expect.poll(async()=>(await deliveries()).length).toBe(1);
  const [event]=await deliveries();
  expect(event.data).toMatchObject({room:access.room,mode:'historical-replay',lap:3,summary:{driver:'LEC',compound:'medium'}});
  expect(event.data).not.toHaveProperty('historical');
  expect(await (await request.get(api+'/status',{headers:viewerHeaders})).json()).toMatchObject({results:[],window:{lap:3}});
  const args={room:access.room,event_id:event.data.event_id};
  const telemetry=(await call('get_grand_prix_strategy_event',args)).result.structuredContent;
  expect(telemetry).toMatchObject({mode:'historical-replay',observation:{driver:{name:'Charles Leclerc',lap:3}}});
  expect(telemetry.observation.recentLaps.every(({lap}:{lap:number})=>lap<3)).toBe(true);
  const rejected=await call('submit_grand_prix_radio',{...args,action:'box',radio:'Box.'});
  expect(rejected.result.isError).toBe(true);
  const radio={...args,action:'extend',radio:'Stay out on the mediums.'};
  const submitted=await call('submit_grand_prix_radio',radio);
  expect(submitted.result.structuredContent).toMatchObject({mode:'historical-replay',driver:'Charles Leclerc',line:radio.radio});
  expect((await call('submit_grand_prix_radio',radio)).result.isError).toBe(true);
  await expect(page.getByRole('cell',{name:/Stay out on the mediums/})).toBeVisible();
  await expect(page.getByRole('cell',{name:'Match',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Next decision'})).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('cell',{name:'Match',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next decision'}).click();
  await expect(page.locator('#replay-benchmark-status')).toContainText('Lap 7');
  const ended=await rpc('events/unsubscribe',{...subscription,delivery:{url}});
  expect(ended.error).toBeUndefined();
 });
}
