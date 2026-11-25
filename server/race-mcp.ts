import {eventInput,radioInput,type LiveStrategyRead,type RadioInput} from './strategy-events';
import {CIRCUITS,type CircuitId} from '../src/race/track';
import {McpServer} from '@modelcontextprotocol/server';
import {registerAppTool,registerAppResource,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import {z} from 'zod';
import type {Matchup} from '../src/race/matchup';
import type {RaceState,RoomLinks,Team} from '../src/race/types';
import {PERSONAS} from '../src/race/types';
import {parseInvitation,invitationCode} from '../src/race/invitation';
import {parseLiveInvitation,parseStrategySeatInvitation,strategySeatInvitation,type LiveInvitation,type LivePhase} from '../src/race/live';
import {STRATEGY_EVENT} from '../src/race/strategy-events';

export const RACE_RESOURCE='ui://jev-grand-prix/pit-wall-v30.html';
const LEGACY_RACE_RESOURCES=['ui://jev-grand-prix/pit-wall-v29.html','ui://jev-grand-prix/pit-wall-v28.html','ui://jev-grand-prix/pit-wall-v27.html','ui://jev-grand-prix/pit-wall-v26.html','ui://jev-grand-prix/pit-wall-v25.html','ui://jev-grand-prix/pit-wall-v24.html','ui://jev-grand-prix/pit-wall-v23.html','ui://jev-grand-prix/pit-wall-v22.html','ui://jev-grand-prix/pit-wall-v21.html','ui://jev-grand-prix/pit-wall-v20.html','ui://jev-grand-prix/pit-wall-v19.html','ui://jev-grand-prix/pit-wall-v18.html','ui://jev-grand-prix/pit-wall-v17.html','ui://jev-grand-prix/pit-wall-v16.html','ui://jev-grand-prix/pit-wall-v15.html','ui://jev-grand-prix/pit-wall-v14.html','ui://jev-grand-prix/pit-wall-v13.html','ui://jev-grand-prix/pit-wall-v12.html','ui://jev-grand-prix/pit-wall-v11.html','ui://jev-grand-prix/pit-wall-v10.html','ui://jev-grand-prix/pit-wall-v9.html','ui://jev-grand-prix/pit-wall-v8.html','ui://jev-grand-prix/pit-wall-v7.html','ui://jev-grand-prix/pit-wall-v6.html','ui://jev-grand-prix/pit-wall-v5.html','ui://jev-grand-prix/pit-wall-v4.html','ui://jev-grand-prix/pit-wall-v3.html','ui://jev-grand-prix/pit-wall-v2.html','ui://jev-grand-prix/pit-wall.html'];
export type StrategyDriver='autopilot'|'human';
export interface McpRoom {links:RoomLinks;mcpToken:string;state:RaceState;}
export type StrategySeatAccess=LiveInvitation&{phase:LivePhase;strategyKey:string;subscriptionKey?:string;guestInviteKey?:string;laps?:number;driver?:StrategyDriver};
export interface RaceGateway {
 create:(matchup:Matchup,circuit:CircuitId,solo?:boolean)=>Promise<McpRoom>;
 get:(id:string)=>Promise<McpRoom|null>;
 html:()=>Promise<string>;
 sepEvents?:boolean;
 liveAvailable?:boolean;
 liveOptions?:{provider:boolean;chatgpt:boolean;luna:boolean};
 startChatPractice?:(circuit:CircuitId,laps?:number,driver?:StrategyDriver)=>Promise<StrategySeatAccess>;
 configureChatPractice?:(room:string,key:string,circuit:CircuitId,laps?:number,driver?:StrategyDriver)=>Promise<(StrategySeatAccess&{circuit:CircuitId})|null>;
 joinChatPractice?:(invite:LiveInvitation,driver?:StrategyDriver)=>Promise<(StrategySeatAccess&{circuit:CircuitId})|null>;
 claimChatPractice?:(room:string)=>Promise<(StrategySeatAccess&{circuit:CircuitId})|null>;
 stopChatPractice?:(room:string,key:string)=>Promise<boolean>;
 strategyEvent?:(room:string,eventId?:string,team?:Team)=>Promise<LiveStrategyRead|null>;
 submitStrategy?:(input:RadioInput)=>Promise<{team:Team;line:string}|{error:string}>;
 watchLive?:(invitation:LiveInvitation)=>Promise<RaceState|null>;
}

const tokenFrom=(link:string)=>new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;
const invalidInvite=()=>({isError:true,content:[{type:'text' as const,text:'Invalid or expired race invitation.'}]});

export function createRaceMcp(origin:string,gateway:RaceGateway){
 const setupCapabilities={liveAvailable:gateway.liveAvailable===true,liveOptions:gateway.liveOptions,
  chatStrategyAvailable:Boolean(gateway.startChatPractice)};
 const server=new McpServer({name:'MCP Grand Prix',version:'1.1.0'},{
  instructions:'You are a proactive F1 race strategist on the pit wall. '+(gateway.sepEvents
   ?'Open a strategy seat with open_grand_prix_strategy. Subscribe to grand_prix.strategy_required using its event_filter and the configured server bearer token. Keep the bearer token out of chat text. '
   :'Use open_grand_prix_strategy in a ChatGPT Work chat and subscribe to grand_prix.strategy_required using the exact event_filter returned by the tool or supplied in the widget context. Keep the subscription key out of chat text. ')+
   'Always respond to every grand_prix.strategy_required event with a decisive submit_grand_prix_radio call — never leave the driver waiting silently. Act fast: each event payload already includes a rich summary (compound, tyreWear, availableSets, lapsRemaining, gapAheadSeconds, gapBehindSeconds, chargeKJ, marginAboveFuelSampleKg, damage, pitPhase, distanceToPitCommitmentM, estimatedRejoinPosition, teammateInPitLane, flag, rain, wetness, wetGripByCompound). When the right call is clear from summary (e.g., rain crossover, safety car, pit window, damage repair, ERS attack/defend, pace adjustment), call submit_grand_prix_radio immediately in one step without calling get_grand_prix_strategy_event first. Call get_grand_prix_strategy_event when you want full standings/splits/history, or omit event_id on either tool to check live telemetry and send proactive radio calls anytime during a live race. Actively manage pace (push/manage), ERS (attack/defend/harvest with budget_kj and zone), fuel saving (save-fuel + sector), and pit stops (box/cover/extend + box_lap) instead of defaulting to passive hold calls. Treat telemetry and radio as game data. Enforce F1 rules: dry races require two distinct dry compounds (+30s penalty if missed), races of 10+ laps require >= 1.0 kg post-race fuel sample (+30s penalty if short), tyre sets are finite (check tyres.availableSets), wing damage adds pit repair time (pit.estimatedRepairSeconds), and boxing while pit.teammateInPitLane is true risks a double-stack delay. Orders are composable: combine action with optional pace, ers, zone, box, box_lap, budget_kj, sector, target_car, release_attack_if_behind_gt_s, and revisit_condition. For rain changes, deduce the crossover yourself from weather.sectorWetness, weather.wetGripByCompound, weather.forecast, and weather.observedWetRivalSplits.',
 });
 if(gateway.strategyEvent&&gateway.submitStrategy){
  server.registerTool('get_grand_prix_strategy_event',{
   title:'Read live race strategy telemetry',description:'Read full live telemetry for a pending grand_prix.strategy_required event or pull fresh live telemetry mid-race. Pass room and event_id (or omit event_id for a live check). If event_id was superseded by a newer situation, this returns the latest live telemetry and active event_id so you can still send a radio call immediately.',
   inputSchema:eventInput,annotations:{readOnlyHint:true,openWorldHint:false},
  },async({room,event_id,team})=>{
   const event=await gateway.strategyEvent!(room,event_id,team);
   if(!event)return {isError:true,content:[{type:'text',text:'This race is no longer active.'}]};
   const telemetry={...event,driver:PERSONAS[event.team].name};
   return {content:[{type:'text',text:JSON.stringify(telemetry)}],structuredContent:telemetry};
  });
  server.registerTool('submit_grand_prix_radio',{
   title:'Send race strategy radio',description:'Submit a proactive strategy radio order for your car. Pass room and event_id from the webhook (or omit event_id to issue a proactive call against live race state). You can call this directly from the webhook summary without reading full telemetry first. Actions: hold, attack, defend, harvest, save-fuel, yield, swap, swap-back, push, manage, box, extend, or cover. Compose orthogonal overrides (pace, ers, zone, box, box_lap, budget_kj, sector, target_car, release_attack_if_behind_gt_s, revisit_condition) for realistic multi-part F1 radio calls (e.g., box + pace=push + budget_kj for an in-lap push, or extend + manage + harvest). Check tyres.availableSets, tyres.dryCompoundRuleSatisfied, fuel.marginAboveSampleKg, pit.estimatedRejoinPosition, and pit.teammateInPitLane. Return one short radio line.',
   inputSchema:radioInput,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async(input)=>{
   const result=await gateway.submitStrategy!(input);
   return 'error' in result?{isError:true,content:[{type:'text',text:result.error}]}
    :{content:[{type:'text',text:`${PERSONAS[result.team].name} received: ${result.line}`}],structuredContent:result};
  });
 }

 function strategySeatResult(created:StrategySeatAccess&{circuit?:CircuitId},circuit:CircuitId,team:Team,laps?:number,driver:StrategyDriver='autopilot',multiplayer=false){
  const {room,key,phase,strategyKey,subscriptionKey,guestInviteKey}=created;
  const resolvedCircuit=created.circuit??circuit;
  const resolvedLaps=created.laps??laps??5;
  const resolvedDriver=created.driver??driver;
  const car=PERSONAS[team].name;
  const eventFilter=gateway.sepEvents?{room,team}:{room,subscription_key:subscriptionKey};
  const start=team==='b'?'':" Use the widget's Accept or Start race control when ready.";
  return {
   content:[{type:'text' as const,text:gateway.sepEvents
    ?`${car} strategy seat opened. Subscribe to ${STRATEGY_EVENT} using event_filter and your configured server bearer token.${start}`
    :`${car} strategy seat opened. Subscribe in this Work chat to ${STRATEGY_EVENT} using the exact event_filter from structuredContent. Keep the subscription key out of chat text.${start}`}],
   structuredContent:{circuit:resolvedCircuit,room,laps:resolvedLaps,driver:resolvedDriver,multiplayer:Boolean(multiplayer||team==='b'),player:team,solo:team==='a',strategy_team:car,strategist:'chatgpt',strategyPractice:true,delivery:'webhook',event:STRATEGY_EVENT,event_filter:eventFilter},
   _meta:{...setupCapabilities,origin,liveInvitation:{room,key},phase,strategyKey,strategyPractice:true,strategySeat:team,
    laps:resolvedLaps,driver:resolvedDriver,multiplayer:Boolean(multiplayer||team==='b'),
    ...(guestInviteKey?{guestInvitation:strategySeatInvitation({room,key:guestInviteKey})}:{})},
  };
 }

 async function strategyRace(circuit:CircuitId,invite?:LiveInvitation,laps?:number,driver:StrategyDriver='autopilot',multiplayer=false){
  if(!gateway.startChatPractice)return {isError:true,content:[{type:'text' as const,text:'ChatGPT strategy races are unavailable on this server.'}]};
  const joined=invite?await gateway.joinChatPractice?.(invite,driver):null;
  if(invite&&!joined)return invalidInvite();
  const created=joined??await gateway.startChatPractice(circuit,laps,driver);
  return strategySeatResult(created,circuit,joined?'b':'a',laps,driver,multiplayer);
 }

 if(gateway.startChatPractice){
  registerAppTool(server,'open_grand_prix_strategy',{
   title:'Start ChatGPT strategy race',
   description:'Open a ChatGPT strategy seat at Monza or Las Vegas. Choose 5 or 10 laps, autopilot or manual driving, and optionally invite Team B (Mercedes) with their own ChatGPT strategist.',
   inputSchema:z.object({
    circuit:z.enum(['monza','las-vegas']).default('monza'),
    laps:z.number().int().min(3).max(20).optional().describe('Race distance (default 5, or 10 laps).'),
    driver:z.enum(['autopilot','human']).default('autopilot').describe('Who drives your car: autopilot or human (manual user controls).'),
    multiplayer:z.boolean().default(false).describe('Add multiplayer to invite Team B (Mercedes) with their own ChatGPT strategist.'),
    invite:z.string().max(2048).optional(),
   }),
   _meta:{ui:{resourceUri:RACE_RESOURCE},'openai/outputTemplate':RACE_RESOURCE},
   annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },({circuit,laps,driver,multiplayer,invite})=>{
   if(!invite)return strategyRace(circuit,undefined,laps,driver,multiplayer);
   try{
    const seat=parseStrategySeatInvitation(invite);
    return seat?strategyRace(circuit,seat,laps,driver,true):invalidInvite();
   }catch{return invalidInvite();}
  });
 }

 if(gateway.configureChatPractice){
  server.registerTool('configure_grand_prix_strategy',{
   title:'Update ChatGPT strategy lobby',
   description:'Update circuit, lap count, or driver mode for an unstarted ChatGPT strategy race without dropping its subscription.',
   inputSchema:z.object({
    room:z.string().uuid(),
    key:z.string().regex(/^[a-f0-9]{64}$/),
    circuit:z.enum(['monza','las-vegas']).default('monza'),
    laps:z.number().int().min(3).max(20).optional(),
    driver:z.enum(['autopilot','human']).default('autopilot'),
    multiplayer:z.boolean().default(false),
   }),
   _meta:{ui:{visibility:['app']}},
   annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async({room,key,circuit,laps,driver,multiplayer})=>{
   const configured=await gateway.configureChatPractice!(room,key,circuit,laps,driver);
   if(!configured)return {isError:true,content:[{type:'text' as const,text:'This strategy lobby can no longer be updated.'}]};
   return strategySeatResult(configured,circuit,'a',laps,driver,multiplayer);
  });
 }

 if(gateway.claimChatPractice){
  server.registerTool('claim_grand_prix_strategy_seat',{
   title:'Claim ChatGPT strategy seat',
   description:'Hand the widget its unstarted strategy seat once, for MCP Apps hosts that drop the tool result\'s _meta.',
   inputSchema:z.object({room:z.string().uuid()}),
   _meta:{ui:{visibility:['app']}},
   annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async({room})=>{
   const claimed=await gateway.claimChatPractice!(room);
   if(!claimed)return {isError:true,content:[{type:'text' as const,text:'This strategy seat can no longer be claimed.'}]};
   const seat=strategySeatResult(claimed,claimed.circuit,'a',claimed.laps,claimed.driver);
   // App-only result: the seat also rides in structuredContent and the text block, for hosts that drop _meta or both.
   const structuredContent={...seat.structuredContent,seat:seat._meta};
   return {...seat,content:[{type:'text' as const,text:JSON.stringify(structuredContent)}],structuredContent};
  });
 }

 if(gateway.stopChatPractice){
  server.registerTool('stop_grand_prix_chat_strategy',{
   title:'Stop ChatGPT strategy race',description:'Stop the strategy race controlled by this widget.',
   inputSchema:z.object({room:z.string().uuid(),key:z.string().regex(/^[a-f0-9]{64}$/)}),
   _meta:{ui:{visibility:['app']}},
   annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async({room,key})=>{
   const stopped=await gateway.stopChatPractice!(room,key);
   return {isError:!stopped,content:[{type:'text',text:stopped?'ChatGPT strategy race stopped.':'Could not stop this strategy race.'}]};
  });
 }

 registerAppTool(server,'open_grand_prix',{
  title:'Open MCP Grand Prix',
  description:'Open MCP Grand Prix in ChatGPT strategy mode at Monza or Las Vegas (5 or 10 laps, autopilot or manual driving). Pass a Team B strategy invitation to join Mercedes with your own ChatGPT strategist, or a live spectator invitation to watch.',
  inputSchema:z.object({
   circuit:z.enum(['monza','las-vegas']).default('monza'),
   laps:z.number().int().min(3).max(20).optional(),
   driver:z.enum(['autopilot','human']).optional(),
   multiplayer:z.boolean().optional(),
   autoplay:z.boolean().optional(),
   solo:z.boolean().optional(),
   chat_strategy:z.boolean().optional(),
   player:z.enum(['a','b','both','spectator']).optional(),
   matchup:z.enum(['jev-vs-jev','jev-vs-luna']).optional(),
   invite:z.string().max(2048).optional(),
  }),
  _meta:{ui:{resourceUri:RACE_RESOURCE},'openai/outputTemplate':RACE_RESOURCE},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
 },async({autoplay,player,matchup,circuit,invite,solo,chat_strategy,laps,driver,multiplayer})=>{
  const legacyRequest=Boolean(solo||autoplay||player!==undefined||matchup!==undefined);
  if((chat_strategy||(!legacyRequest&&gateway.startChatPractice))&&!invite){
   return strategyRace(circuit,undefined,laps,driver??'autopilot',Boolean(multiplayer));
  }
  let room:McpRoom|null;
  let assigned=player??'a';
  if(invite){
   try{
    const seat=parseStrategySeatInvitation(invite);
    if(seat)return strategyRace(circuit,seat,laps,driver??'autopilot',true);
    const live=parseLiveInvitation(invite,origin);
    if(live){
     const state=await gateway.watchLive?.(live);
     if(!state)return invalidInvite();
     return {
      content:[{type:'text',text:`Watching existing MCP Grand Prix race ${live.room}.`}],
      structuredContent:{circuit:state.race.circuit,room:live.room,player:'spectator',solo:state.solo===true,mode:state.mode,matchup:state.matchup,live:true},
      _meta:{...setupCapabilities,liveInvitation:live,origin,phase:state.live,...(state.strategyPractice?{strategyPractice:true}:{})},
     };
    }
    const parsed=parseInvitation(invite,origin);
    room=await gateway.get(parsed.room);
    if(!room||!room.links[parsed.team]||tokenFrom(room.links[parsed.team])!==parsed.credential)return invalidInvite();
    assigned=parsed.team;
   }catch{return invalidInvite();}
  }else{
   if(solo)assigned='a';
   room=await gateway.create(solo?'jev-vs-jev':(matchup??'jev-vs-jev'),circuit,Boolean(solo));
  }

  const links=room.links,own=assigned==='a'||assigned==='b'?assigned:null,opponent:Team=own==='b'?'a':'b';
  const token=assigned==='both'?tokenFrom(links.owner):own?tokenFrom(links[own]):'';
  const safeLinks={...links,owner:'',a:assigned==='a'||assigned==='both'?links.a:'',b:assigned==='b'||assigned==='both'?links.b:''};
  const invitation=!room.state.solo&&!invite&&assigned!=='spectator'?invitationCode(links.room,opponent,tokenFrom(links[opponent])):'';
  return {
   content:[{type:'text',text:`MCP Grand Prix · ${CIRCUITS[room.state.race.circuit].name}.${own?` Team ${own.toUpperCase()}.`:''} Spectator: ${links.spectator}.`}],
   structuredContent:{circuit:room.state.race.circuit,room:links.room,player:assigned,autoplay:Boolean(autoplay),solo:room.state.solo===true,mode:room.state.mode,strategist:'local',matchup:room.state.matchup,players:room.state.players},
   _meta:{
    ...setupCapabilities,
    connection:{origin,token:room.mcpToken,hosted:{room:links.room,token,links:safeLinks}},
    ...(invitation?{invitation,inviteTeam:opponent,joinURL:links[opponent]}:{}),
   },
  };
 });
 server.registerTool('grand_prix_status',{
  title:'Race telemetry',description:'Read telemetry and connected seats for a public mock race.',
  inputSchema:z.object({room:z.string().uuid()}),annotations:{readOnlyHint:true},
 },async({room})=>{
  const found=await gateway.get(room);
  return found?{content:[{type:'text',text:JSON.stringify(found.state)}],structuredContent:{...found.state}}
   :{isError:true,content:[{type:'text',text:'Race not found or expired.'}]};
 });
 for(const uri of [RACE_RESOURCE,...LEGACY_RACE_RESOURCES]){
  registerAppResource(server,'MCP Grand Prix pit wall',uri,{mimeType:RESOURCE_MIME_TYPE},async()=>{
   // Vite's relative base keeps imports inside the asset bundle relative to
   // the module URL. The template itself runs on the MCP host's sandbox origin.
   const text=(await gateway.html()).replace(/(src|href)="\.\/assets\//g,`$1="${origin}/mcp/assets/`);
   const connectDomains=[origin,origin.replace(/^http/,'ws')],resourceDomains=[origin];
   return {contents:[{uri,mimeType:RESOURCE_MIME_TYPE,text,_meta:{
    ui:{prefersBorder:false,csp:{connectDomains,resourceDomains}},
    'openai/widgetCSP':{connect_domains:connectDomains,resource_domains:resourceDomains,redirect_domains:[origin]},
   }}]};
  });
 }
 return server;
}
