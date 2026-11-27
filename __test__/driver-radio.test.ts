import {CLIENT_CAPABILITIES_META_KEY,CLIENT_INFO_META_KEY,createMcpHandler,PROTOCOL_VERSION_META_KEY,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {expect,test,vi} from 'vitest';
import {createRaceMcp,type RaceGateway} from '../server/race-mcp';
import type {RadioInput} from '../server/strategy-events';

const origin='https://grand-prix.example';
const version='2026-07-28';
const tool='submit_grand_prix_radio';

test.each(['modern','legacy'])('driver radio accepts a spoken reply in a %s MCP call',async(protocol)=>{
 const args={room:crypto.randomUUID(),event_id:crypto.randomUUID(),team:'b',action:'hold',radio:'One more lap, then box.'};
 const submitStrategy=vi.fn(async(input:RadioInput)=>({team:'b' as const,line:input.radio}));
 const gateway:RaceGateway={create:vi.fn(),get:vi.fn(),html:vi.fn(),strategyEvent:vi.fn(),submitStrategy};
 const factory=()=>createRaceMcp(origin,gateway);
 const modern=protocol==='modern';
 const request=new Request(origin+'/mcp',{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(modern?{
   'Mcp-Protocol-Version':version,'Mcp-Method':'tools/call','Mcp-Name':tool,
  }:{})},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args,...(modern?{_meta:{
   [PROTOCOL_VERSION_META_KEY]:version,
   [CLIENT_INFO_META_KEY]:{name:'Radio test host',version:'1'},
   [CLIENT_CAPABILITIES_META_KEY]:{},
  }}:{})}}),
 });
 const server=modern?undefined:factory();
 const transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});
 try{
  if(server)await server.connect(transport);
  const response=await (server?transport.handleRequest(request):createMcpHandler(factory,{legacy:'reject'}).fetch(request));
  expect(await response.json()).toMatchObject({result:{
   content:[{type:'text',text:`Mercedes received: ${args.radio}`}],
   structuredContent:{team:'b',line:args.radio},
  }});
  expect(submitStrategy).toHaveBeenCalledExactlyOnceWith(args);
 }finally{await server?.close();}
});
