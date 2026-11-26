import {CLIENT_CAPABILITIES_META_KEY,CLIENT_INFO_META_KEY,createMcpHandler,PROTOCOL_VERSION_META_KEY,WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {expect,test,vi} from 'vitest';
import {createRaceMcp,type RaceGateway} from '../server/race-mcp';
import type {DriverAnswerInput} from '../server/strategy-events';

const origin='https://grand-prix.example';
const modernVersion='2026-07-28';
const tool='answer_grand_prix_driver';
const driverQuestion='How long can I stay out on these tyres?';
const draft='Stay out one more lap.';
const accepted={driverReply:{action:'accept',content:{reply:'One more lap, then box.'}}};

function fixture(){
 const room=crypto.randomUUID(),event_id=crypto.randomUUID();
 const otherEvent=crypto.randomUUID();
 const args={room,event_id,team:'b',suggested_reply:draft};
 const pending=new Set<string>([event_id,otherEvent]);
 const answerDriver=vi.fn(async(input:DriverAnswerInput)=>{
  pending.delete(input.event_id);
  return input.reply?{team:'b' as const,line:input.reply}:{team:'b' as const,sent:false as const};
 });
 const gateway:RaceGateway={
  create:vi.fn(),get:vi.fn(),html:vi.fn(),
  driverQuestion:async(id,eventId,team)=>id===room&&pending.has(eventId)&&team!=='a'
   ?{team:'b',question:driverQuestion,elicitationKey:'a'.repeat(64)}:null,
  answerDriver,
 };
 const factory=()=>createRaceMcp(origin,gateway);
 const handler=createMcpHandler(factory,{legacy:'reject'});
 const request=(params:object,modern=true,form=true)=>new Request(origin+'/mcp',{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(modern?{
   'Mcp-Protocol-Version':modernVersion,'Mcp-Method':'tools/call','Mcp-Name':tool,
  }:{})},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args,...params,...(modern?{_meta:{
   [PROTOCOL_VERSION_META_KEY]:modernVersion,
   [CLIENT_INFO_META_KEY]:{name:'Radio test host',version:'1'},
   [CLIENT_CAPABILITIES_META_KEY]:form?{elicitation:{form:{}}}:{},
  }}:{})}}),
 });
 const rpc=async(params:object={},form=true)=>handler.fetch(request(params,true,form)).then(r=>r.json());
 return {args,otherEvent,answerDriver,factory,request,rpc};
}

test('the MCP form displays the driver question and sends only the accepted radio reply',async()=>{
 const {args,answerDriver,rpc}=fixture();
 const {result}=await rpc();
 expect(result).toMatchObject({
  resultType:'input_required',
  inputRequests:{driverReply:{
   method:'elicitation/create',params:{mode:'form',message:'Mercedes asks: '+driverQuestion,
    requestedSchema:{required:['reply'],properties:{reply:{type:'string',default:draft,maxLength:180}}}},
  }},
  requestState:expect.any(String),
 });
 expect(answerDriver).not.toHaveBeenCalled();
 const retry={requestState:result.requestState,inputResponses:accepted};
 expect((await rpc(retry)).result).toMatchObject({
  structuredContent:{team:'b',line:accepted.driverReply.content.reply},
 });
 expect(answerDriver).toHaveBeenCalledExactlyOnceWith({room:args.room,event_id:args.event_id,team:'b',reply:accepted.driverReply.content.reply});
 expect((await rpc(retry)).error).toMatchObject({code:-32602});
 expect(answerDriver).toHaveBeenCalledTimes(1);
});

test('driver radio rejects invalid continuations and closes declined questions without radio',async()=>{
 const {args,otherEvent,answerDriver,rpc}=fixture();
 const {result:{requestState}}=await rpc();
 expect((await rpc({inputResponses:accepted})).result).toMatchObject({isError:true});
 expect((await rpc({requestState:requestState+'x',inputResponses:accepted})).error).toMatchObject({code:-32602});
 for(const differentArgs of [
  {...args,event_id:otherEvent},
  {...args,team:'a'},
  {...args,suggested_reply:'Box this lap.'},
 ]){
  expect((await rpc({arguments:differentArgs,requestState,inputResponses:accepted})).result).toMatchObject({isError:true});
 }
 expect((await rpc({requestState,inputResponses:{driverReply:{action:'accept',content:{reply:'   '}}}})).result).toMatchObject({isError:true});
 expect(answerDriver).not.toHaveBeenCalled();
 expect((await rpc({requestState,inputResponses:{driverReply:{action:'decline'}}})).result).toMatchObject({structuredContent:{team:'b',sent:false}});
 expect(answerDriver).toHaveBeenCalledExactlyOnceWith({room:args.room,event_id:args.event_id,team:'b'});
 expect((await rpc({requestState,inputResponses:accepted})).error).toMatchObject({code:-32602});
});

test('hosts must support the MCP form to send a driver reply',async()=>{
 const {answerDriver,factory,request,rpc}=fixture();
 expect((await rpc({},false)).error).toMatchObject({code:-32021});
 const server=factory(),transport=new WebStandardStreamableHTTPServerTransport({enableJsonResponse:true});
 await server.connect(transport);
 try{
  const response=await transport.handleRequest(request({},false));
  expect(await response.json()).toMatchObject({
   result:{isError:true,content:[{type:'text',text:expect.stringContaining('form elicitation')}]},
  });
 }finally{await server.close();}
 expect(answerDriver).not.toHaveBeenCalled();
});
