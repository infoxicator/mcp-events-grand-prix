import {expect,test} from '@playwright/test';

test('strategy screen displays each call and its consequence',async({page})=>{
 await page.goto('/?strategy');
 await expect(page.getByRole('heading',{name:'Race strategy replays'})).toBeVisible();
 const scenario=page.getByLabel('Scenario');
 await expect(page.getByRole('img',{name:'Track distance × lateral offset'})).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'Deadlines missed'})).toBeVisible();

 for(const [id,call,outcome] of [
  ['battery','Hold the boost for defence','Deployment'],
  ['fuel','Lift early in sector 2','Fuel at flag +0.12 kg'],
  ['fight','Let the faster car through','P4 · group gap'],
  ['tyres','Push for one lap','Next gap 0.25 s'],
  ['pit','Cover the rival’s stop','Stays on track this lap'],
  ['weather','Box for intermediates','Intermediates · 0 intermediate set'],
  ['team','Swap back. The pass did not happen.','Jev ahead · +0 team points'],
  ['pit-replay','The current pit exit puts us in traffic','Boxing now is 2.70 s slower'],
 ]){
  await scenario.selectOption(id);
  await expect(page.getByText(call,{exact:false}).first()).toBeVisible();
  await expect(page.getByText(outcome,{exact:false}).first()).toBeVisible();
  if(id==='battery')await expect(page.getByText('Fourth is out of range. Release the boost to attack second.',{exact:false})).toBeVisible();
  if(id==='fuel')await expect(page.getByText('The fuel margin is still negative.',{exact:false})).toBeVisible();
  if(id==='pit-replay')await expect(page.getByRole('columnheader',{name:'Before pit entry'}).first()).toBeVisible();
 }
});

test('live strategy presents provider results, escapes radio text and cancels when switching scenarios',async({page})=>{
 await page.route('**/api/strategy/models',route=>route.fulfill({json:{jev:'fixture-jev',chatgpt:'fixture-gpt'}}));
 await page.route('**/api/strategy/live?benchmark=battery',async route=>{
  const {batteryReplay,batteryState}=await import('../src/race/strategy-benchmarks');
  const variants=[1,8].map(closing=>({
   closing,responseMs:95,pairs:[[batteryReplay(batteryState(closing),17,'defend','<b>Hold defence</b>'),batteryReplay(batteryState(closing),17,'attack')]],
  }));
  await route.fulfill({json:{model:'fixture-gpt',variants}});
 });
 await page.goto('/?strategy');
 await page.getByLabel('Scenario').selectOption('battery');
 await page.getByRole('button',{name:'Run live ChatGPT benchmark'}).click();
 await expect(page.getByRole('status')).toHaveText('Live benchmark complete.');
 await expect(page.getByText('ChatGPT · fixture-gpt', {exact:false})).toBeVisible();
 await expect(page.getByText('<b>Hold defence</b>',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Call recorded before deployment · 95 ms').first()).toBeVisible();

 let started!:()=>void;
 const intercepted=new Promise<void>(resolve=>{started=resolve;});
 let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/strategy/live?benchmark=corner',async route=>{
  started();
  await held;
  await route.fulfill({json:{model:'late-fixture',runs:[]}}).catch(()=>{});
 });
 await page.getByLabel('Scenario').selectOption('corner');
 await page.getByRole('button',{name:'Run live Jev benchmark'}).click();
 await intercepted;
 await expect(page.getByRole('button',{name:'Cancel benchmark'})).toBeVisible();
 await page.getByLabel('Scenario').selectOption('fuel');
 release();
 await expect(page.getByRole('heading',{name:'Fuel by sector'})).toBeVisible();
 await expect(page.getByRole('status')).toBeHidden();
});

test('live endpoint refuses provider calls in mock mode',async({request,baseURL})=>{
 const models=await request.get('/api/strategy/models');
 expect(await models.json()).toEqual({jev:null,chatgpt:null});
 const response=await request.post('/api/strategy/live?benchmark=battery',{headers:{Origin:baseURL!}});
 expect(response.status()).toBe(503);
});
