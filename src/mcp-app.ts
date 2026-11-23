import {STRATEGY_EVENT} from './race/strategy-events';
import {App,applyDocumentTheme,applyHostStyleVariables,applyHostFonts,type McpUiHostContext} from '@modelcontextprotocol/ext-apps';
import {mountRace} from './race/ui';
import {connect,type Connection} from './race/network';
import {PERSONAS,type HostedRoom,type Team} from './race/types';
import {CIRCUITS,isCircuit,type CircuitId} from './race/track';
import {copyInvitation} from './clipboard';
import {isLiveKey,isRoomId,liveInvitation,raceSessionLabel,liveSpectatorURL,ownerRaceURL,
 CHAT_STRATEGY_LAPS,type LiveInvitation,type LivePhase} from './race/live';
import './mcp.css';

type Player=Team|'both'|'spectator';
type StrategyDriver='autopilot'|'human';
type MountedView={connection:Connection;suspend3D:()=>void;dispose:()=>void};
type Result=Parameters<NonNullable<App['ontoolresult']>>[0];

const app=new App({name:'MCP Grand Prix',version:'1.0.0'});
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
const status=element('mcp-status'),menu=element('mcp-menu'),menuToggle=element<HTMLButtonElement>('mcp-menu-toggle'),
 menuClose=element<HTMLButtonElement>('mcp-menu-close'),
 crew=element('mcp-crew'),modePill=element('mcp-mode-pill'),
 setup=element<HTMLFormElement>('mcp-setup'),acceptButton=element<HTMLButtonElement>('mcp-accept'),
 multiplayerToggle=element<HTMLInputElement>('mcp-multiplayer'),
 multiplayerBar=element('mcp-multiplayer-bar'),multiplayerTitle=element('mcp-multiplayer-title'),
 multiplayerStatus=element('mcp-multiplayer-status'),
 guestInvite=element<HTMLInputElement>('mcp-guest-invite'),guestCopy=element<HTMLButtonElement>('mcp-guest-copy'),
 joinPanel=element<HTMLDetailsElement>('mcp-join-panel'),
 joinForm=element<HTMLFormElement>('mcp-join-form'),joinField=element<HTMLInputElement>('mcp-join'),
 legacyBar=element('mcp-legacy-bar'),play=element<HTMLButtonElement>('mcp-play'),
 field=element<HTMLInputElement>('mcp-invite'),copy=element('mcp-copy'),joinWeb=element<HTMLAnchorElement>('mcp-join-web'),
 backToFeed=element('mcp-back-feed'),web=element<HTMLButtonElement>('mcp-web'),
 expand=element('mcp-fullscreen'),ownerControl=element<HTMLButtonElement>('mcp-owner');

let hosted:HostedRoom|null=null,player:Player='a',controllers:Connection[]=[],ready=false,disposed=false,solo=false;
let view:MountedView|null=null,mode:'inline'|'fullscreen'='inline';
let live:LiveInvitation|null=null,knownLive:LivePhase='running',origin='';
let strategyPractice=false,practiceKey:string|undefined,strategySeat:Team|undefined;
let strategyDriver:StrategyDriver='autopilot',multiplayerActive=false,pendingAutoStart=false;
let telemetry=false,setupBusy=false,hasActiveRace=false,menuAutoCollapsed=false;
let mountSequence=0;
document.documentElement.dataset.mcpApp='true';

const selectedCircuit=()=>setup.querySelector<HTMLInputElement>('[name="circuit"]:checked')?.value as CircuitId??'monza';
const selectedLaps=()=>{
 const value=Number(setup.querySelector<HTMLInputElement>('[name="laps"]:checked')?.value);
 return value===10?10:CHAT_STRATEGY_LAPS;
};
const selectedDriver=():StrategyDriver=>setup.querySelector<HTMLInputElement>('[name="driver"]:checked')?.value==='human'?'human':'autopilot';

function setRadio(name:string,value:string){
 const input=setup.querySelector<HTMLInputElement>(`[name="${name}"][value="${value}"]`);
 if(input&&!input.disabled)input.checked=true;
}

function setMenuOpen(open:boolean){
 menu.hidden=!open;
 menuToggle.setAttribute('aria-expanded',String(open));
 backToFeed.hidden=!hasActiveRace||!open;
 menuClose.hidden=!hasActiveRace;
}

function refreshSetup(){
 const locked=!origin||setupBusy;
 for(const group of setup.querySelectorAll<HTMLFieldSetElement>('fieldset'))group.disabled=locked;
 multiplayerToggle.disabled=locked;
 acceptButton.disabled=locked;
 acceptButton.textContent=setupBusy?'Starting…':'Accept';
}

function syncFormFromStructuredContent(data:unknown){
 const choices=data as {circuit?:unknown;laps?:unknown;driver?:unknown;multiplayer?:unknown}|undefined;
 if(isCircuit(choices?.circuit))setRadio('circuit',choices.circuit);
 if(choices?.laps===5||choices?.laps===10)setRadio('laps',String(choices.laps));
 if(choices?.driver==='human'||choices?.driver==='autopilot')setRadio('driver',choices.driver);
 if(typeof choices?.multiplayer==='boolean')multiplayerToggle.checked=choices.multiplayer;
}

let suspendTimer:ReturnType<typeof setTimeout>|undefined;
function clearSuspend(){if(suspendTimer!==undefined){clearTimeout(suspendTimer);suspendTimer=undefined;}}
function clearRaceView(){
 clearSuspend();
 view?.dispose();
 view=null;
}

function updateMultiplayerBar(snapshot:Connection['state']|undefined){
 const showBar=Boolean(live&&strategyPractice&&multiplayerActive&&guestInvite.value&&knownLive==='running');
 multiplayerBar.hidden=!showBar;
 if(!showBar)return;
 const joined=Boolean(snapshot?.guestChatStrategy);
 multiplayerTitle.textContent=joined?'Team B joined · Mercedes #63':'Team B invitation';
 multiplayerStatus.textContent=joined
  ?'Mercedes #63 is connected with their own ChatGPT strategist.'
  :'Share so Team B can race Mercedes #63 with their own ChatGPT strategist.';
}

function updateStatus(){
 if(document.documentElement.dataset.mcpHidden==='true')return;
 const connection=view?.connection,snapshot=connection?.state;
 if(snapshot){
  const race=snapshot.race;
  const needsSeat=race.phase==='racing'&&!live&&!ready&&player!=='spectator';
  if(race.phase!=='lobby'&&!needsSeat&&!menuAutoCollapsed){
   menuAutoCollapsed=true;
   setMenuOpen(false);
  }
  if(pendingAutoStart&&live&&strategyPractice&&practiceKey&&strategySeat==='a'&&race.phase==='lobby'&&snapshot.connected.a&&snapshot.connected.b&&snapshot.strategyWebhook==='connected'){
   const feedView=document.getElementById('viewport')?.getAttribute('data-feed-view');
   if(strategyDriver==='human'||feedView!=='loading'){
    pendingAutoStart=false;
    connection?.send({type:'start',startKey:practiceKey});
   }
  }
 }
 let message='Connecting to the race…';
 if(live){
  if(snapshot?.live)knownLive=snapshot.live;
  const strategy=strategySeat==='b'?snapshot?.guestChatStrategy:snapshot?.chatStrategy;
  const webhook=strategySeat==='b'?snapshot?.guestStrategyWebhook:snapshot?.strategyWebhook;
  const strategyDriverName=PERSONAS[strategySeat??strategy?.team??'a'].name;
  if(strategySeat){
   if(knownLive!=='running')crew.textContent='Strategy session ended.';
   else if(strategy?.state==='applied')crew.textContent=`ChatGPT radio delivered to ${strategyDriverName}`;
   else if(strategy?.state==='fallback')crew.textContent=`Pit wall covered ${strategyDriverName}’s strategy window`;
   else if(webhook==='failed')crew.textContent='ChatGPT did not acknowledge the event. The pit wall can cover it.';
   else if(webhook==='delivered')crew.textContent='ChatGPT acknowledged telemetry · Waiting for radio';
   else if(webhook==='connected')crew.textContent='ChatGPT strategy connected';
   else crew.textContent='In this Work chat, ask ChatGPT to subscribe to this race’s strategy events.';
  }
  const circuitName=snapshot?CIRCUITS[snapshot.race.circuit].name:CIRCUITS[selectedCircuit()].name;
  const lapsCount=snapshot?.race.laps??selectedLaps();
  const activeDriver=snapshot&&strategySeat?(snapshot.driverMode?.[strategySeat]==='human'?'Manual':'Autopilot'):(strategyDriver==='human'?'Manual':'Autopilot');
  if(strategyPractice&&knownLive==='running'){
   message=`ChatGPT strategy · ${circuitName} · ${lapsCount} laps · ${activeDriver}`;
   if(strategySeat==='b')message+=' · Team B (Mercedes)';
   else if(snapshot?.guestChatStrategy)message+=' · Multiplayer';
  }else{
   message=raceSessionLabel(knownLive,strategyPractice,Boolean(snapshot?.guestChatStrategy));
  }
  if(connection?.status==='RECONNECTING')message+=' · Reconnecting…';
  else if(connection?.status==='INVALID LIVE INVITATION')message='Invitation is invalid or expired';
  else if(!snapshot)message+=' · Connecting…';
  updateMultiplayerBar(snapshot);
  ownerControl.hidden=strategyPractice&&(!practiceKey||strategySeat==='b'||knownLive!=='running');
  ownerControl.textContent=strategyPractice?'Stop race':knownLive==='running'?'Stop live race ↗':'Owner page ↗';
 }else if(hosted){
  const label=player==='both'?'Both teams':player==='spectator'?'Spectator':`Team ${player.toUpperCase()}`;
  const remote=player==='a'?'B':'A';
  let detail='Connecting…';
  if(connection?.status==='RECONNECTING'||controllers.some(c=>c.status==='RECONNECTING'))detail='Reconnecting to the same race…';
  else if(controllers.some(c=>c.status.includes('SEAT TAKEN')))detail='Your seat is occupied. Waiting to reconnect…';
  else if(ready&&controllers.some(c=>!c.team))detail='Connecting your seat…';
  else if(snapshot?.race.phase==='finished')detail='Race finished';
  else if(solo)detail=player==='spectator'?'Mercedes is computer-controlled'
   :!ready?'Select Ready to connect your seat':snapshot?.race.phase==='racing'?'Race in progress':'Ferrari ready';
  else if(player!=='spectator'&&!ready)detail='Select Ready to connect your seat';
  else if(snapshot?.connected.a&&snapshot?.connected.b)detail=snapshot.race.phase==='racing'?'Race in progress':'Both teams ready';
  else if(snapshot)detail=ready&&player!=='both'?`Ready · Waiting for team ${remote}`:'Waiting for both teams';
  message=`${label} · ${detail}`;
  multiplayerBar.hidden=true;
 }
 if((view||hosted)&&status.textContent!==message)status.textContent=message;
}

function stopControllers(){
 controllers.forEach(c=>c.close());
 controllers=[];
}

function syncLegacy(){
 stopControllers();
 if(!hosted||live)return;
 const room=hosted;
 const teams:Team[]=player==='both'?['a','b']:player==='spectator'?[]:[player];
 if(ready&&!disposed)controllers=teams.map(team=>{
  const link=room.links?.[team];
  const token=player==='both'&&link?new URLSearchParams(new URL(link).hash.slice(1)).get('token')!:room.token;
  return connect(team,{...room,token});
 });
 play.hidden=player==='spectator';
 play.disabled=false;
 play.textContent=ready?(player==='both'?'Leave both seats':`Leave team ${player.toUpperCase()}`)
  :(player==='both'?'Ready both teams':`Ready team ${player.toUpperCase()}`);
 legacyBar.hidden=play.hidden&&element('mcp-sharing').hidden;
 updateStatus();
}

function context(c:McpUiHostContext){
 if(c.theme)applyDocumentTheme(c.theme);
 if(c.styles?.variables)applyHostStyleVariables(c.styles.variables);
 if(c.styles?.css?.fonts)applyHostFonts(c.styles.css.fonts);
 if(c.safeAreaInsets){
  const {top,right,bottom,left}=c.safeAreaInsets;
  document.body.style.padding=`${top}px ${right}px ${bottom}px ${left}px`;
 }
 if(c.availableDisplayModes)expand.hidden=!c.availableDisplayModes.includes('fullscreen');
 if(c.displayMode==='inline'||c.displayMode==='fullscreen')mode=c.displayMode;
 expand.textContent=mode==='fullscreen'?'Exit fullscreen':'Expand';
 refreshSetup();
}

function raceOrigin(value:string){
 const url=new URL(value);
 if(url.origin!==value||url.username||url.password||(url.protocol!=='https:'&&(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)))){
  throw new Error('Unsupported race origin');
 }
 return url.origin;
}

function setLegacyInvitation(invite:string,label:string,button:string){
 field.value=invite;
 element('mcp-sharing').hidden=!invite;
 element('mcp-invite-label').textContent=label;
 copy.textContent=button;
 legacyBar.hidden=play.hidden&&element('mcp-sharing').hidden;
}

async function showLive(invite:LiveInvitation,phase:LivePhase='running',strategyKey?:string,settings?:{
 practice:boolean;seat?:Team;guestInvitation?:string;driver?:StrategyDriver;multiplayer?:boolean;collapseMenu?:boolean;autoStart?:boolean;
}){
 if(!isRoomId(invite.room)||!isLiveKey(invite.key))throw new Error('Invalid race invitation');
 const seq=++mountSequence;
 stopControllers();
 clearRaceView();
 live=invite;
 knownLive=phase;
 strategyPractice=settings?.practice===true;
 strategySeat=settings?.seat;
 practiceKey=strategyPractice?strategyKey:undefined;
 strategyDriver=settings?.driver==='human'?'human':'autopilot';
 multiplayerActive=Boolean(settings?.multiplayer&&settings?.guestInvitation);
 pendingAutoStart=Boolean(settings?.autoStart&&strategyPractice&&strategyKey&&strategySeat==='a'&&!multiplayerActive);
 guestInvite.value=settings?.guestInvitation??'';
 guestCopy.textContent='Copy Team B invite';
 player='spectator';
 hasActiveRace=true;
 menuAutoCollapsed=Boolean(settings?.collapseMenu);
 play.hidden=true;
 joinWeb.hidden=true;
 setLegacyInvitation(strategyPractice?'':liveInvitation(invite),'Live spectator invitation','Copy live invitation');
 modePill.textContent=strategySeat==='b'?'ChatGPT strategy · Team B':'ChatGPT strategy';
 crew.hidden=!strategySeat;
 web.disabled=false;
 web.textContent='Open spectator ↗';
 hosted={room:invite.room,token:invite.key,links:null,origin,live:true};

 const canStart=()=>Boolean(strategyKey&&strategySeat==='a');
 const startReady=(state:{strategyWebhook?:string})=>state.strategyWebhook==='connected';
 const onStart=()=>view?.connection.send({type:'start',startKey:strategyKey});

 if(strategyPractice&&strategyDriver==='human'&&strategySeat&&strategyKey){
  const {mountDrive}=await import('./race/drive-view');
  if(disposed||seq!==mountSequence)return;
  const driverRoom:HostedRoom={room:invite.room,token:strategyKey,links:null,origin,live:true};
  view=mountDrive(driverRoom,{team:strategySeat,embedded:true,canStart,startReady,onStart,autostart:pendingAutoStart});
 }else{
  if(disposed||seq!==mountSequence)return;
  view=mountRace(hosted,{team:null,controller:false,openLink,telemetry,strategySeat,canStart,startReady,onStart});
 }
 setMenuOpen(!settings?.collapseMenu);
 refreshSetup();
 document.documentElement.dataset.mcpReady='true';
 updateStatus();
}

function parseEventFilter(value:unknown){
 const filter=value as {room?:unknown;subscription_key?:unknown}|null|undefined;
 return isRoomId(filter?.room)&&isLiveKey(filter?.subscription_key)?{room:filter.room,subscription_key:filter.subscription_key}:undefined;
}

async function shareEventFilter(filter:NonNullable<ReturnType<typeof parseEventFilter>>){
 try{
  // Share the filter for the next explicit user turn. Events never run through the widget.
  await app.updateModelContext({structuredContent:{event:STRATEGY_EVENT,event_filter:filter}});
  return;
 }catch{/* The tool can return the filter directly when invoked in Work chat. */}
}

async function openFromWidget(name:string,args:Record<string,unknown>,options:{collapseMenu?:boolean;autoStart?:boolean}={}){
 const result=await app.callServerTool({name,arguments:args});
 await applyResult(result,options);
 const filter=parseEventFilter((result.structuredContent as {event_filter?:unknown}|undefined)?.event_filter);
 if(filter)await shareEventFilter(filter);
}

async function applyResult(result:Result,options:{collapseMenu?:boolean;autoStart?:boolean}={}){
 if(disposed)return;
 if(result.isError)throw new Error(result.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ')||'Unable to join race');
 if(result._meta?.['jev-grand-prix/telemetry']===true)telemetry=true;
 syncFormFromStructuredContent(result.structuredContent);
 const liveInvite=result._meta?.liveInvitation as LiveInvitation|undefined;
 if(liveInvite){
  origin=raceOrigin(String(result._meta?.origin));
  const meta=result._meta!;
  const structured=result.structuredContent as {driver?:unknown;multiplayer?:unknown}|undefined;
  const driver:StrategyDriver=(meta.driver==='human'||structured?.driver==='human')?'human':'autopilot';
  const multiplayer=Boolean(meta.multiplayer===true||structured?.multiplayer===true);
  await showLive(liveInvite,meta.phase as LivePhase|undefined,isLiveKey(meta.strategyKey)?meta.strategyKey:undefined,{
   practice:meta.strategyPractice===true,
   seat:meta.strategySeat==='a'||meta.strategySeat==='b'?meta.strategySeat:undefined,
   guestInvitation:typeof meta.guestInvitation==='string'?meta.guestInvitation:undefined,
   driver,
   multiplayer,
   collapseMenu:options.collapseMenu,
   autoStart:options.autoStart,
  });
  return;
 }
 const connection=result._meta?.connection as {origin:string;token:string;hosted:HostedRoom}|undefined;
 if(!connection?.hosted)throw new Error('Missing race connection');
 origin=raceOrigin(connection.origin);
 ++mountSequence;
 stopControllers();
 clearRaceView();
 live=null;
 strategyPractice=false;
 strategySeat=undefined;
 practiceKey=undefined;
 multiplayerActive=false;
 pendingAutoStart=false;
 guestInvite.value='';
 multiplayerBar.hidden=true;
 crew.hidden=true;
 hosted={...connection.hosted,origin,mcpToken:connection.token};
 const data=result.structuredContent as {player?:Player;autoplay?:boolean;solo?:boolean};
 player=data.player??'a';
 solo=data.solo===true;
 ready=data.autoplay===true;
 hasActiveRace=true;
 menuAutoCollapsed=false;
 view=mountRace(hosted,{team:player==='a'||player==='b'?player:null,controller:false,openLink,telemetry,
  canStart:()=>controllers.some(c=>c.team!==null),
  onStart:()=>controllers.find(c=>c.team!==null)?.send({type:'start'})});
 const team=String(result._meta?.inviteTeam??'other').toUpperCase();
 setLegacyInvitation(typeof result._meta?.invitation==='string'?result._meta.invitation:'',`Invite team ${team}`,'Copy invitation');
 joinWeb.hidden=typeof result._meta?.joinURL!=='string';
 if(!joinWeb.hidden)joinWeb.href=String(result._meta?.joinURL);
 web.disabled=false;
 web.textContent='Open spectator ↗';
 ownerControl.hidden=true;
 setMenuOpen(false);
 refreshSetup();
 document.documentElement.dataset.mcpReady='true';
 syncLegacy();
}

async function openLink(url:string){
 const error=element('mcp-join-error');
 error.textContent='';
 try{
  if(new URL(url).origin!==origin)throw new Error('Unexpected race origin');
  const openai=(window as Window&{openai?:{openExternal?:(params:{href:string;redirectUrl:false})=>void}}).openai;
  if(!app.getHostCapabilities()?.openLinks&&openai?.openExternal){
   openai.openExternal({href:url,redirectUrl:false});
   return;
  }
  const result=await app.openLink({url});
  if(result.isError)throw new Error('Link request was denied');
 }catch{error.textContent='The host could not open this link.';}
}

app.onhostcontextchanged=context;
app.ontoolinput=()=>{if(!hosted)status.textContent='MCP connected · Preparing race setup…';};
app.ontoolresult=result=>{
 if(hosted&&!result._meta?.connection&&!result._meta?.liveInvitation)return;
 void applyResult(result).catch(error=>{status.textContent=error instanceof Error?error.message:'Unable to open race';});
};
const observer=new IntersectionObserver(([entry])=>{
 const hidden=!entry.isIntersecting;
 document.documentElement.dataset.mcpHidden=String(hidden);
 document.dispatchEvent(new Event('mcp-visibility'));
 clearSuspend();
 if(hidden)suspendTimer=setTimeout(()=>view?.suspend3D(),20_000);
 else updateStatus();
});
observer.observe(document.documentElement);
const statusTimer=setInterval(updateStatus,300);
function onMenuKeyDown(event:KeyboardEvent){
 if(event.key==='Escape'&&!menu.hidden&&hasActiveRace){
  setMenuOpen(false);
  menuToggle.focus({preventScroll:true});
 }
}
window.addEventListener('keydown',onMenuKeyDown);
function teardown(){
 if(disposed)return;
 disposed=true;
 clearSuspend();
 stopControllers();
 clearRaceView();
 observer.disconnect();
 clearInterval(statusTimer);
 window.removeEventListener('keydown',onMenuKeyDown);
 window.removeEventListener('pagehide',teardown);
 window.removeEventListener('beforeunload',teardown);
}
window.addEventListener('pagehide',teardown,{once:true});
window.addEventListener('beforeunload',teardown,{once:true});
app.onteardown=async()=>{
 teardown();
 return {};
};
app.onerror=()=>{if(!view)status.textContent='MCP host connection failed';};

function releaseOpponent(){
 if(player==='both'){
  player='a';
  const b=controllers.pop();
  b?.close();
  play.textContent=ready?'Leave team A':'Ready team A';
 }
}
copy.onclick=async()=>{
 if(!live)releaseOpponent();
 copy.textContent=await copyInvitation(field)?'Copied':'Selected — press ⌘C / Ctrl+C';
};
guestCopy.onclick=async()=>{
 guestCopy.textContent=await copyInvitation(guestInvite)?'Copied':'Selected — press ⌘C / Ctrl+C';
};
play.onclick=()=>{ready=!ready;syncLegacy();};
expand.onclick=()=>void app.requestDisplayMode({mode:mode==='inline'?'fullscreen':'inline'});
web.onclick=()=>{
 const url=live?liveSpectatorURL(origin,live):hosted?.links?.spectator;
 if(url)void openLink(url);
};
joinWeb.onclick=event=>{event.preventDefault();releaseOpponent();void openLink(joinWeb.href);};
menuToggle.onclick=()=>{
 setMenuOpen(menu.hidden);
};
menuClose.onclick=()=>{
 if(!hasActiveRace)return;
 setMenuOpen(false);
 menuToggle.focus({preventScroll:true});
};
menu.addEventListener('click',event=>{
 if(event.target===menu&&hasActiveRace){
  setMenuOpen(false);
  menuToggle.focus({preventScroll:true});
 }
});
backToFeed.onclick=()=>{
 setMenuOpen(false);
 menuToggle.focus({preventScroll:true});
};
setup.onsubmit=async event=>{
 event.preventDefault();
 if(acceptButton.disabled)return;
 const error=element('mcp-join-error');
 error.textContent='';
 const circuit=selectedCircuit();
 const laps=selectedLaps();
 const driver=selectedDriver();
 const multiplayer=multiplayerToggle.checked;
 setupBusy=true;
 refreshSetup();
 try{
  await openFromWidget('open_grand_prix_strategy',{circuit,laps,driver,multiplayer},{collapseMenu:true,autoStart:!multiplayer});
 }catch(e){error.textContent=e instanceof Error?e.message:'Could not start race.';}
 finally{setupBusy=false;refreshSetup();}
};
ownerControl.onclick=async()=>{
 if(!live)return;
 if(!strategyPractice){
  void openLink(ownerRaceURL(origin,live.room));
  return;
 }
 if(!practiceKey||strategySeat==='b')return;
 const error=element('mcp-join-error');
 error.textContent='';
 ownerControl.disabled=true;
 try{
  const result=await app.callServerTool({name:'stop_grand_prix_chat_strategy',arguments:{room:live.room,key:practiceKey}});
  if(result.isError)throw new Error('Could not stop the race.');
 }catch{error.textContent='Could not stop the race.';}
 finally{ownerControl.disabled=false;}
};
joinForm.onsubmit=async event=>{
 event.preventDefault();
 const error=element('mcp-join-error');
 error.textContent='';
 const button=joinForm.querySelector('button')!;
 button.disabled=true;
 try{
  const driver=selectedDriver();
  await openFromWidget('open_grand_prix',{invite:joinField.value.trim(),driver},{collapseMenu:true,autoStart:false});
  joinField.value='';
  joinPanel.open=false;
 }catch(e){error.textContent=e instanceof Error?e.message:'Unable to join race';}
 finally{button.disabled=false;}
};

await app.connect();
const ctx=app.getHostContext();
if(ctx)context(ctx);
