import {createRace,DT,stepRace,event,other} from '../src/race/physics';
import {TEAMS,type Team,type Race,type RaceState,type Decision,type RoomLinks,type Instruction,type ClientMessage,type ServerMessage} from '../src/race/types';
import {createRaceDriver,createRaceEngineer,providerConfig} from './race-brains';
import {invitationCode} from '../src/race/invitation';
export interface Peer{send:(m:ServerMessage)=>void;team:Team|null;owner:boolean;joined:boolean;lastSeen:number;lastDecision:number;sequence:number;accepted:number;busy:boolean;}
export class RaceRoom {
 race=createRace();readonly peers=new Set<Peer>();readonly tokens={owner:crypto.randomUUID(),a:crypto.randomUUID(),b:crypto.randomUUID()};readonly mcpToken=crypto.randomUUID();expiresAt=Date.now()+2*60*60_000;
 decisions:Record<Team,Decision|null>={a:null,b:null};intents={a:0,b:0};engineerCalls={a:0,b:0};paidCalls=0;history:Race[]=[];replay:Race[]=[];bestReplayScore=0;private captureUntil=0;
 private engineerAt={a:-100,b:-100};private engineerBusy={a:false,b:false};private generation=0;private sequence=0;private driver;private engineer;readonly mode:'mock'|'live';
 constructor(readonly id:string,readonly origin:string,env:Record<string,string|undefined>={},readonly speed=4){const config=providerConfig(env);this.mode=config.mock&&(env.JEV_MOCK==='1'||env.ENGINEER_MOCK==='1'||!(env.OPENROUTER_API_KEY||env.AI_GATEWAY_API_KEY))?'mock':'live';this.driver=createRaceDriver(config);this.engineer=createRaceEngineer(env);}
 connected(){return {a:[...this.peers].some(p=>p.team==='a'),b:[...this.peers].some(p=>p.team==='b')};}
 state():RaceState{return {type:'state',room:this.id,race:this.race,connected:this.connected(),decisions:this.decisions,intents:this.intents,engineerCalls:this.engineerCalls,mode:this.mode,serverTime:Date.now(),physicsHz:120,snapshotHz:30,speed:this.speed,paidCalls:this.paidCalls};}
 links():RoomLinks{const root=`${this.origin}/?room=${this.id}`;return {room:this.id,expiresAt:this.expiresAt,owner:`${root}#token=${this.tokens.owner}`,a:`${root}&team=a#token=${this.tokens.a}`,b:`${root}&team=b#token=${this.tokens.b}`,spectator:`${root}&spectate`};}
 invitation(team:Team){return invitationCode(this.id,team,this.tokens[team]);}
 add(send:Peer['send']):Peer{const p:Peer={send,team:null,owner:false,joined:false,lastSeen:Date.now(),lastDecision:0,sequence:0,accepted:0,busy:false};this.peers.add(p);return p;}
 remove(p:Peer){this.peers.delete(p);this.broadcast();}
 join(p:Peer,team:Team|null,token:string){if(p.joined)return;p.joined=true;p.owner=token===this.tokens.owner;const allowed=team&&(token===this.tokens[team]||p.owner),taken=team&&this.connected()[team];p.team=allowed&&!taken?team:null;p.send({type:'joined',team:p.team,canReset:p.owner, ...(team&&!p.team?{reason:taken?'SEAT TAKEN · SPECTATING':'INVALID TEAM INVITATION'}:{})});this.broadcast();}
 broadcast(){const state=this.state();for(const p of this.peers)if(p.joined)p.send(state);}
 radio(team:Team,instruction:Instruction,source:'mock'|'live'|'fallback',responseMs=1){this.race.cars[team].instruction=structuredClone(instruction);this.race.radio.push({id:++this.sequence,time:this.race.time,team,speaker:'ENGINEER',text:instruction.line,source,responseMs});this.race.radio=this.race.radio.slice(-20);event(this.race,'radio',team,instruction.line);}
 private async think(team:Team){if(this.engineerBusy[team])return;this.engineerBusy[team]=true;this.engineerAt[team]=this.race.time;const generation=this.generation;this.engineerCalls[team]++;try{const result=await this.engineer(structuredClone(this.race),team);if(generation!==this.generation)return;this.radio(team,result.instruction,result.source,result.responseMs);if(result.source!=='mock')this.paidCalls++;}finally{this.engineerBusy[team]=false;}}
 advance(steps:number){if(Date.now()>this.expiresAt||!this.connected().a||!this.connected().b)return;if(this.race.phase==='lobby')this.race.phase='lights';
  for(let n=0;n<steps;n++){const oldLeader=this.race.leader;stepRace(this.race);if(this.race.phase==='racing')for(const t of TEAMS)if(this.race.time-this.engineerAt[t]>=12)void this.think(t);
   if(this.race.tick%4===0){this.history.push(structuredClone(this.race));if(this.history.length>240)this.history.shift();}
   if(oldLeader!==this.race.leader){const score=100-Math.abs(this.race.cars.a.distance-this.race.cars.b.distance);if(score>this.bestReplayScore){this.bestReplayScore=score;this.replay=structuredClone(this.history);this.captureUntil=this.race.time+3;}}
   if(this.captureUntil>this.race.time&&this.race.tick%4===0)this.replay.push(structuredClone(this.race));
  }
 }
 async message(p:Peer,msg:ClientMessage){p.lastSeen=Date.now();if(msg.type==='join'){this.join(p,msg.team,msg.token);return;}if(!p.joined)return;
  if(msg.type==='ping'){p.send({type:'pong',sent:msg.sent});return;}if(msg.type==='replay'){p.send({type:'replay',frames:this.replay.length?this.replay:this.history});return;}
  if(msg.type==='reset'&&p.owner){this.generation++;this.race=createRace();this.decisions={a:null,b:null};this.intents={a:0,b:0};this.engineerCalls={a:0,b:0};this.engineerAt={a:-100,b:-100};this.history=[];this.replay=[];this.bestReplayScore=0;this.broadcast();return;}
  if(msg.type==='radio'&&p.team){const i=msg.instruction;if(i&&['push','balanced','manage'].includes(i.pace)&&['deploy','balanced','harvest'].includes(i.ers)&&['soft','medium','hard'].includes(i.tyre)&&['attack','defend','hold'].includes(i.tactic)&&typeof i.box==='boolean'&&typeof i.line==='string'&&i.line.length<=180)this.radio(p.team,i,'mock');return;}
  if(!p.team)return;const team=p.team;
  if(msg.type==='decide'&&!p.busy&&Date.now()-p.lastDecision>=150&&this.race.phase==='racing'){
   p.busy=true;p.lastDecision=Date.now();const gen=this.generation;
   try{const decision=await this.driver(structuredClone(this.race),team,++p.sequence);if(gen!==this.generation||!this.peers.has(p))return;this.decisions[team]=decision;if(decision.source!=='mock')this.paidCalls++;p.send({type:'decision',decision});}finally{p.busy=false;}
  }
  if(msg.type==='intent'){const d=this.decisions[team];if(d&&d.sequence===msg.sequence&&msg.sequence>p.accepted){p.accepted=msg.sequence;this.race.cars[team].intent=structuredClone(d.intent);this.intents[team]++;if(this.intents[team]===1||this.intents[team]%20===0){this.race.radio.push({id:++this.sequence,time:this.race.time,team,speaker:'JEV',text:d.intent.reply,source:d.source==='jev'?'live':d.source,responseMs:d.responseMs});this.race.radio=this.race.radio.slice(-20);}}}
 }
}
