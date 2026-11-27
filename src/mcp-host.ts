import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { AppBridge, PostMessageTransport, getToolUiResourceUri, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/app-bridge';
const status=document.getElementById('host-status')!,diagnostic=document.getElementById('diagnostic')!,frame=document.getElementById('app-frame') as HTMLIFrameElement,close=document.getElementById('host-close') as HTMLButtonElement;
const config=await fetch('/config').then(r=>r.json()) as {endpoint:string;sandboxOrigin:string;testStrategy?:boolean};
const params=new URLSearchParams(location.search);
const testMessages=config.testStrategy&&params.get('test-messages')==='1';
const client=new Client({name:'MCP Grand Prix local MCP host',version:'1.0.0'});
let bridge:AppBridge|undefined;
try{
  await client.connect(new StreamableHTTPClientTransport(new URL(config.endpoint)));
  const {tools}=await client.listTools(),tool=tools.find(t=>t.name==='open_grand_prix');
  if(!tool)throw new Error('open_grand_prix tool not found');
  const uri=getToolUiResourceUri(tool);if(!uri)throw new Error('Missing MCP UI resource link');
  const resource=await client.readResource({uri}),content=resource.contents[0];
  if(content.mimeType!==RESOURCE_MIME_TYPE||!('text' in content))throw new Error('Expected MCP App HTML resource');
  const ui=content._meta?.ui as {csp?:Record<string,unknown>}|undefined;
  const sandboxURL=new URL('/mcp-sandbox.html',config.sandboxOrigin);sandboxURL.searchParams.set('csp',JSON.stringify(ui?.csp??{}));
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');
  const ready=new Promise<void>(resolve=>{const listener=(e:MessageEvent)=>{if(e.source===frame.contentWindow&&e.origin===config.sandboxOrigin&&e.data?.method==='ui/notifications/sandbox-proxy-ready'){removeEventListener('message',listener);resolve();}};addEventListener('message',listener);});
  frame.hidden=false;frame.src=sandboxURL.href;await ready;
  bridge=new AppBridge(client,{name:'MCP Grand Prix MCP host',version:'1.0.0'},{openLinks:{},...(testMessages?{message:{text:{}}}:{}),serverTools:client.getServerCapabilities()?.tools,serverResources:client.getServerCapabilities()?.resources,updateModelContext:{text:{}}},{hostContext:{theme:'dark',platform:'web',displayMode:'inline',availableDisplayModes:['inline','fullscreen'],containerDimensions:{height:Math.max(700,innerHeight-66),width:innerWidth},safeAreaInsets:{top:0,right:0,bottom:0,left:0}}});
  const initialized=new Promise<void>(resolve=>{bridge!.oninitialized=()=>resolve();});
  bridge.onopenlink=async({url})=>{window.open(url,'_blank','noopener,noreferrer');return {};};
  bridge.onupdatemodelcontext=async({structuredContent})=>{
   if(testMessages)document.body.dataset.strategyContext=JSON.stringify(structuredContent);
   return {};
  };
  if(testMessages)bridge.onmessage=async(message)=>{
   const count=Number(document.body.dataset.strategyMessageCount??0)+1;
   document.body.dataset.strategyMessage='true';
   document.body.dataset.strategyMessageCount=String(count);
   document.body.dataset.lastStrategyMessage=JSON.stringify(message);
   return {isError:count===1&&params.get('reject-first')==='1'};
  };
  bridge.onrequestdisplaymode=async({mode})=>{const display=mode==='fullscreen'?'fullscreen':'inline';document.body.classList.toggle('fullscreen',display==='fullscreen');bridge!.sendHostContextChange({displayMode:display});return {mode:display};};
  bridge.onerror=error=>{status.textContent='MCP app error';diagnostic.textContent=String(error);diagnostic.hidden=false;};
  await bridge.connect(new PostMessageTransport(frame.contentWindow!,frame.contentWindow!));
  await bridge.sendSandboxResourceReady({html:content.text,csp:ui?.csp});await initialized;
  // The local host opens read-only. Starting the two agents requires an explicit UI click.
  const args={
   ...(params.has('circuit')?{circuit:params.get('circuit')}:{}),
   ...(params.has('laps')?{laps:Number(params.get('laps'))}:{}),
   ...(params.has('driver')?{driver:params.get('driver')}:{}),
   ...(params.has('multiplayer')?{multiplayer:params.get('multiplayer')==='1'}:{}),
   ...(params.has('autoplay')?{autoplay:params.get('autoplay')==='1'}:{}),
   ...(params.has('player')?{player:params.get('player')}:{}),
   ...(params.has('matchup')?{matchup:params.get('matchup')}:{}),
   ...(params.has('invite')?{invite:params.get('invite')}:{}),
  };
  bridge.sendToolInput({arguments:args});
  const result=await client.callTool({name:'open_grand_prix',arguments:args});
  if(config.testStrategy)result._meta={...result._meta,'jev-grand-prix/telemetry':true};
  const initialFilter=(result.structuredContent as {event_filter?:unknown}|undefined)?.event_filter;
  if(testMessages&&initialFilter)document.body.dataset.initialEventFilter=JSON.stringify(initialFilter);
  await bridge.sendToolResult(result);
  status.textContent='Connected · Streamable HTTP · open_grand_prix';diagnostic.hidden=true;close.disabled=false;document.body.dataset.mcpConnected='true';
  close.onclick=async()=>{await bridge!.teardownResource({});await bridge!.close();await client.close();frame.remove();close.disabled=true;status.textContent='App closed · controllers disconnected';document.body.dataset.mcpConnected='false';};
  addEventListener('pagehide',()=>{void bridge?.close();void client.close();},{once:true});
}catch(error){status.textContent='Connection failed';diagnostic.textContent=error instanceof Error?error.message:String(error);}
