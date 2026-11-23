import {STRATEGY_EVENT,type LiveStrategist} from './race/strategy-events';
import {App,applyDocumentTheme,applyHostStyleVariables,applyHostFonts,type McpUiHostContext} from '@modelcontextprotocol/ext-apps';
import {mountRace} from './race/ui';
import {connect,type Connection} from './race/network';
import {PERSONAS,type HostedRoom,type Team} from './race/types';
import {CIRCUITS,isCircuit,type CircuitId} from './race/track';
import {isMatchup,type Matchup} from './race/matchup';
import {copyInvitation} from './clipboard';
import {isLiveKey,isRoomId,liveInvitation,raceSessionLabel,liveSpectatorURL,newLiveKey,ownerRaceURL,pairingChallenge,
 LIVE_PAIR_PATH,PAIR_TTL_MS,type LiveInvitation,type LivePhase} from './race/live';
import './mcp.css';

const app=new App({name:'MCP Grand Prix',version:'1.0.0'});
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
const status=element('mcp-status'),play=element<HTMLButtonElement>('mcp-play'),expand=element('mcp-fullscreen'),
 guestSharing=element('mcp-guest-sharing'),
 guestInvite=element<HTMLInputElement>('mcp-guest-invite'),guestCopy=element<HTMLButtonElement>('mcp-guest-copy'),
 strategy=element('mcp-strategy'),web=element<HTMLButtonElement>('mcp-web'),field=element<HTMLInputElement>('mcp-invite'),copy=element('mcp-copy'),
 joinForm=element<HTMLFormElement>('mcp-join-form'),joinField=element<HTMLInputElement>('mcp-join'),
 joinWeb=element<HTMLAnchorElement>('mcp-join-web'),
 ownerControl=element<HTMLButtonElement>('mcp-owner'),pairRow=element('mcp-pairing'),pairStatus=element('mcp-pair-status'),
 pairOpen=element<HTMLButtonElement>('mcp-pair-open'),crew=element('mcp-crew');
const menu=element('mcp-menu'),menuToggle=element<HTMLButtonElement>('mcp-menu-toggle'),backToFeed=element('mcp-back-feed'),
 raceView=element('app'),startSlot=element('mcp-start-slot'),badgeSlot=element('mcp-session-badge'),sessionDetails=element('mcp-session-details'),
 setup=element<HTMLFormElement>('mcp-setup'),openLobby=element<HTMLButtonElement>('mcp-open-lobby'),
 circuitChoice=element<HTMLSelectElement>('mcp-circuit'),matchupChoice=element<HTMLSelectElement>('mcp-matchup'),
 seatChoice=element<HTMLSelectElement>('mcp-seat'),strategistChoice=element<HTMLSelectElement>('mcp-strategist'),
 autoConnect=element<HTMLInputElement>('mcp-autoconnect');
type Player=Team|'both'|'spectator';
type SetupMode='solo'|'multiplayer'|'chat'|'live';
type LiveOptions={provider:boolean;chatgpt:boolean;luna:boolean};
type Result=Parameters<NonNullable<App['ontoolresult']>>[0];

let hosted:HostedRoom|null=null,player:Player='a',controllers:Connection[]=[],ready=false,disposed=false,solo=false;
let view:ReturnType<typeof mountRace>|null=null,mode:'inline'|'fullscreen'='inline';
let live:LiveInvitation|null=null,knownLive:LivePhase='running',origin='';
let strategyPractice=false,practiceKey:string|undefined;
let strategySeat:Team|undefined;
let telemetry=false;
let menuInRace=false,setupBusy=false,chatAvailable=false,liveOptions:LiveOptions|undefined;
let pairing:{url:string;cancel:AbortController}|null=null;
document.documentElement.dataset.mcpApp='true';

const launchLabels={solo:'Open solo lobby',multiplayer:'Open multiplayer lobby',chat:'Open ChatGPT strategy lobby',live:'Start live race'};
const selectedMode=()=>setup.querySelector<HTMLInputElement>('[name="race-mode"]:checked')!.value as SetupMode;
const modeInput=(mode:SetupMode)=>setup.querySelector<HTMLInputElement>(`[name="race-mode"][value="${mode}"]`)!;
function setMenuOpen(open:boolean){
 menu.hidden=!open;
 menuToggle.setAttribute('aria-expanded',String(open));
}

function setMenuStage(inRace:boolean){
 if(menuInRace===inRace)return;
 menuInRace=inRace;
 if(inRace)raceView.after(menu);
 else raceView.before(menu);
 backToFeed.hidden=!inRace;
 setMenuOpen(!inRace);
}

function refreshSetup(){
 const work=Boolean(app.getHostCapabilities()?.updateModelContext);
 const liveChat=Boolean(work&&liveOptions?.chatgpt),provider=Boolean(liveOptions?.provider);
 const chat=chatAvailable&&work,privateLive=provider||liveChat;
 element('mcp-mode-chat-option').hidden=!chat;
 element('mcp-mode-live-option').hidden=!privateLive;
 if((selectedMode()==='chat'&&!chat)||(selectedMode()==='live'&&!privateLive))modeInput('multiplayer').checked=true;
 const selected=selectedMode(),multi=selected==='multiplayer',paid=selected==='live';
 strategistChoice.options[0].disabled=!provider;
 strategistChoice.options[1].disabled=!liveChat;
 if(paid&&strategistChoice.selectedOptions[0]?.disabled)strategistChoice.value=provider?'provider':'chatgpt';
 const providerMatchup=paid&&strategistChoice.value==='provider';
 matchupChoice.options[1].disabled=providerMatchup&&!liveOptions?.luna;
 if(matchupChoice.selectedOptions[0]?.disabled)matchupChoice.value='jev-vs-jev';
 element('mcp-matchup-option').hidden=!multi&&!providerMatchup;
 element('mcp-seat-option').hidden=!multi;
 element('mcp-autoconnect-option').hidden=!multi||seatChoice.value==='spectator';
 element('mcp-strategist-option').hidden=!paid;
 const locked=!origin||setupBusy||Boolean(pairing);
 setup.querySelector('fieldset')!.disabled=locked;
 for(const field of [circuitChoice,matchupChoice,seatChoice,strategistChoice,autoConnect])field.disabled=locked;
 openLobby.disabled=locked;
 openLobby.textContent=launchLabels[selected];
}

function useLobbyOptions(data:unknown){
 const choices=data as {circuit?:unknown;matchup?:unknown;player?:Player;solo?:boolean;autoplay?:boolean};
 if(isCircuit(choices?.circuit))circuitChoice.value=choices.circuit;
 if(isMatchup(choices?.matchup))matchupChoice.value=choices.matchup;
 seatChoice.value=choices?.player??'a';
 autoConnect.checked=choices?.autoplay===true;
}

let suspendTimer:ReturnType<typeof setTimeout>|undefined;
function clearSuspend(){if(suspendTimer!==undefined){clearTimeout(suspendTimer);suspendTimer=undefined;}}
function clearRaceView(){
 clearSuspend();
 view?.dispose();
 view=null;
 startSlot.replaceChildren();
 badgeSlot.replaceChildren();
}

function setupRaceView(){
 const openedFromBroadcast=menuInRace;
 const start=element('start-race');
 startSlot.append(start);
 badgeSlot.append(element('mode'));
 sessionDetails.textContent='Connecting to the grid…';
 setMenuStage(false);
 setMenuOpen(true);
 if(openedFromBroadcast)menu.scrollIntoView({block:'start'});
 refreshSetup();
}

function updateStatus(){
 if(document.documentElement.dataset.mcpHidden==='true')return;
 const connection=view?.connection,snapshot=connection?.state;
 if(snapshot){
  const race=snapshot.race,details=`${CIRCUITS[race.circuit].name} · ${race.laps} laps · ${snapshot.matchup==='jev-vs-luna'?'Jev vs Luna':'Jev vs Jev'}`;
  if(sessionDetails.textContent!==details)sessionDetails.textContent=details;
  const needsSeat=race.phase==='racing'&&!live&&!ready&&player!=='spectator';
  setMenuStage(race.phase!=='lobby'&&!needsSeat);
 }
 let message='Connecting to the race…';
 if(live){
  if(snapshot?.live)knownLive=snapshot.live;
  const strategy=strategySeat==='b'?snapshot?.guestChatStrategy:snapshot?.chatStrategy;
  const webhook=strategySeat==='b'?snapshot?.guestStrategyWebhook:snapshot?.strategyWebhook;
  const strategyDriver=PERSONAS[strategySeat??strategy?.team??'a'].name;
  if(strategySeat){
   if(knownLive!=='running')crew.textContent='Live strategy ended.';
   else if(strategy?.state==='applied')crew.textContent=`ChatGPT radio delivered to ${strategyDriver}`;
   else if(strategy?.state==='fallback')crew.textContent=`Local pit wall covered ${strategyDriver}’s strategy window`;
   else if(webhook==='failed')crew.textContent='ChatGPT did not acknowledge the event. The local pit wall can cover it.';
   else if(webhook==='delivered')crew.textContent='ChatGPT acknowledged telemetry · Waiting for radio';
   else if(webhook==='connected')crew.textContent='ChatGPT subscription verified · Waiting for telemetry';
   else crew.textContent='In this Work chat, ask ChatGPT to subscribe to this race’s strategy events.';
  }
  message=raceSessionLabel(knownLive,strategyPractice,Boolean(snapshot?.guestChatStrategy));
  if(strategySeat&&snapshot?.guestChatStrategy&&knownLive==='running')message+=` · Your car: ${PERSONAS[strategySeat].name}`;
  guestSharing.hidden=!guestInvite.value||knownLive!=='running';
  if(connection?.status==='RECONNECTING')message+=' · Reconnecting…';
  else if(connection?.status==='INVALID LIVE INVITATION')message='Live invitation is invalid or expired';
  else if(!snapshot)message+=' · Connecting…';
  ownerControl.hidden=strategyPractice&&(!practiceKey||strategySeat==='b'||knownLive!=='running');
  ownerControl.textContent=strategyPractice?'Stop strategy race':knownLive==='running'?'Stop live race ↗':'Owner page ↗';
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
  message=`${label} · ${solo?'Solo race':'Mock race'} · ${detail}`;
 }
 if((view||hosted)&&status.textContent!==message)status.textContent=message;
}

function stopControllers(){
 controllers.forEach(c=>c.close());
 controllers=[];
}

function sync(){
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

function setInvitation(invite:string,label:string,button:string){
 field.value=invite;
 element('mcp-sharing').hidden=!invite;
 element('mcp-invite-label').textContent=label;
 copy.textContent=button;
}

function cancelPairing(){
 pairing?.cancel.abort();
 pairing=null;
 pairRow.hidden=true;
 refreshSetup();
}

function resetStrategy(){
 crew.hidden=true;
}

function showLive(invite:LiveInvitation,phase:LivePhase='running',strategyKey?:string,settings?:{
 practice:boolean;seat?:Team;guestInvitation?:string;
}){
 if(!isRoomId(invite.room)||!isLiveKey(invite.key))throw new Error('Invalid live invitation');
 cancelPairing();
 resetStrategy();
 stopControllers();
 clearRaceView();
 live=invite;
 knownLive=phase;
 strategyPractice=settings?.practice===true;
 strategySeat=settings?.seat;
 practiceKey=strategyPractice?strategyKey:undefined;
 guestInvite.value=settings?.guestInvitation??'';
 guestCopy.textContent='Copy Mercedes invitation';
 player='spectator';
 hosted={room:invite.room,token:invite.key,links:null,origin,live:true};
 view=mountRace(hosted,{team:null,controller:false,openLink,telemetry,strategySeat,
  canStart:()=>Boolean(strategyKey&&strategySeat==='a'),
  startReady:state=>state.strategyWebhook==='connected',
  onStart:()=>view?.connection.send({type:'start',startKey:strategyKey})});
 crew.hidden=!strategySeat;
 play.hidden=true;
 web.disabled=false;
 web.textContent='Open live spectator ↗';
 setInvitation(liveInvitation(invite),'Live spectator invitation','Copy live invitation');
 joinWeb.hidden=true;
 strategy.hidden=false;
 modeInput(strategyPractice?'chat':'live').checked=true;
 setupRaceView();
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
 element('mcp-join-error').textContent='Open the strategy seat from ChatGPT Work to subscribe to telemetry.';
}

async function openFromWidget(name:string,args:Record<string,unknown>){
 const result=await app.callServerTool({name,arguments:args});
 applyResult(result);
 const filter=parseEventFilter((result.structuredContent as {event_filter?:unknown}|undefined)?.event_filter);
 if(filter)await shareEventFilter(filter);
}

function applyResult(result:Result){
 if(disposed)return;
 if(result.isError)throw new Error(result.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ')||'Unable to join race');
 if(result._meta?.['jev-grand-prix/telemetry']===true)telemetry=true;
 if(typeof result._meta?.chatStrategyAvailable==='boolean')chatAvailable=result._meta.chatStrategyAvailable;
 if(result._meta?.liveOptions)liveOptions=result._meta.liveOptions as LiveOptions;
 useLobbyOptions(result.structuredContent);
 const liveInvite=result._meta?.liveInvitation as LiveInvitation|undefined;
 if(liveInvite){
  origin=raceOrigin(String(result._meta?.origin));
  const {phase,strategyKey,strategyPractice,strategySeat,guestInvitation}=result._meta!;
  showLive(liveInvite,phase as LivePhase|undefined,isLiveKey(strategyKey)?strategyKey:undefined,{
   practice:strategyPractice===true,
   seat:strategySeat==='a'||strategySeat==='b'?strategySeat:undefined,
   guestInvitation:typeof guestInvitation==='string'?guestInvitation:undefined,
  });
  return;
 }
 const connection=result._meta?.connection as {origin:string;token:string;hosted:HostedRoom}|undefined;
 if(!connection?.hosted)throw new Error('Missing race connection');
 origin=raceOrigin(connection.origin);
 cancelPairing();
 resetStrategy();
 stopControllers();
 clearRaceView();
 live=null;
 strategyPractice=false;
 strategySeat=undefined;
 guestInvite.value='';
 guestSharing.hidden=true;
 practiceKey=undefined;
 hosted={...connection.hosted,origin,mcpToken:connection.token};
 const data=result.structuredContent as {player?:Player;autoplay?:boolean;solo?:boolean};
 player=data.player??'a';
 solo=data.solo===true;
 ready=data.autoplay===true;
 view=mountRace(hosted,{team:player==='a'||player==='b'?player:null,controller:false,openLink,telemetry,
  canStart:()=>controllers.some(c=>c.team!==null),
  onStart:()=>controllers.find(c=>c.team!==null)?.send({type:'start'})});
 const team=String(result._meta?.inviteTeam??'other').toUpperCase();
 setInvitation(typeof result._meta?.invitation==='string'?result._meta.invitation:'',`Invite team ${team}`,'Copy invitation');
 joinWeb.hidden=typeof result._meta?.joinURL!=='string';
 if(!joinWeb.hidden)joinWeb.href=String(result._meta?.joinURL);
 web.disabled=false;
 web.textContent='Open spectator ↗';
 ownerControl.hidden=true;
 strategy.hidden=false;
 modeInput(solo?'solo':'multiplayer').checked=true;
 setupRaceView();
 document.documentElement.dataset.mcpReady='true';
 sync();
}

async function openLink(url:string){
 const error=element('mcp-join-error');
 error.textContent='';
 try{
  if(new URL(url).origin!==origin)throw new Error('Unexpected race origin');
  // Older ChatGPT hosts may expose their external-link API instead of ui/open-link.
  const openai=(window as Window&{openai?:{openExternal?:(params:{href:string;redirectUrl:false})=>void}}).openai;
  if(!app.getHostCapabilities()?.openLinks&&openai?.openExternal){
   openai.openExternal({href:url,redirectUrl:false});
   return;
  }
  const result=await app.openLink({url});
  if(result.isError)throw new Error('Link request was denied');
 }catch{error.textContent='The host could not open this link.';}
}

async function pairRequest(path:string,room:string,key:string,signal:AbortSignal,chat=false){
 return fetch(`${origin}${LIVE_PAIR_PATH}${path}`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,key,chat}),credentials:'omit',signal,
 });
}

async function startPairing(circuit:CircuitId,matchup:Matchup,strategist:LiveStrategist){
 if(pairing)return;
 const room=crypto.randomUUID(),key=newLiveKey(),cancel=new AbortController();
 const ownerUrl=new URL(ownerRaceURL(origin,room));
 ownerUrl.searchParams.set('circuit',circuit);
 ownerUrl.searchParams.set('matchup',matchup);
 ownerUrl.searchParams.set('strategist',strategist);
 const current={url:ownerUrl.href,cancel};
 pairing=current;
 refreshSetup();
 pairRow.hidden=false;
 pairOpen.disabled=true;
 pairStatus.textContent='Preparing owner sign-in…';
 const signal=cancel.signal;
 const deadline=Date.now()+PAIR_TTL_MS;
 try{
  const registered=await pairRequest('',room,await pairingChallenge(key),signal,Boolean(app.getHostCapabilities()?.updateModelContext));
  if(!registered.ok)throw new Error('Live pairing is unavailable. Try again in a minute.');
  pairOpen.disabled=false;
  pairStatus.textContent=`Pairing ${room.slice(0,8)} · Sign in and confirm in your browser`;
  void openLink(current.url);
  let pollDelay=2000;
  while(!signal.aborted&&Date.now()<deadline){
   if(document.hidden||document.documentElement.dataset.mcpHidden==='true'){
    await new Promise<void>(resolve=>{
     const wake=()=>{if(!document.hidden&&document.documentElement.dataset.mcpHidden!=='true')done();};
     const done=()=>{document.removeEventListener('visibilitychange',wake);document.removeEventListener('mcp-visibility',wake);signal.removeEventListener('abort',done);resolve();};
     document.addEventListener('visibilitychange',wake);
     document.addEventListener('mcp-visibility',wake);
     signal.addEventListener('abort',done,{once:true});
    });
    if(signal.aborted||Date.now()>=deadline)break;
   }
   const response=await pairRequest('/claim',room,key,signal);
   if(response.status===200){
    const result=await response.json() as LiveInvitation&{phase:LivePhase;eventFilter?:unknown;strategyKey?:unknown};
    if(!signal.aborted&&result.room===room){
     const filter=parseEventFilter(result.eventFilter);
     showLive(result,result.phase,isLiveKey(result.strategyKey)?result.strategyKey:undefined,{practice:false,seat:filter?'a':undefined});
     if(filter)await shareEventFilter(filter);
    }
    return;
   }
   if(response.status!==202)break;
   await new Promise(resolve=>setTimeout(resolve,pollDelay));
   pollDelay=Math.min(5000,Math.round(pollDelay*1.5));
  }
  if(!signal.aborted)throw new Error('Pairing expired. Start a new pairing.');
 }catch(error){
  if(signal.aborted)return;
  pairStatus.textContent=error instanceof Error?error.message:'Live pairing failed.';
  pairOpen.disabled=true;
  pairing=null;
  refreshSetup();
 }
}

app.onhostcontextchanged=context;
app.ontoolinput=()=>{if(!hosted)status.textContent='MCP connected · Preparing pit wall…';};
app.ontoolresult=result=>{
 if(hosted&&!result._meta?.connection&&!result._meta?.liveInvitation)return;
 try{applyResult(result);}
 catch(error){status.textContent=error instanceof Error?error.message:'Unable to open race';}
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
function teardown(){
 if(disposed)return;
 disposed=true;
 clearSuspend();
 cancelPairing();
 resetStrategy();
 stopControllers();
 clearRaceView();
 observer.disconnect();
 clearInterval(statusTimer);
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
  // Keep the local seat and its in-flight decision stream while releasing B.
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
play.onclick=()=>{ready=!ready;sync();};
expand.onclick=()=>void app.requestDisplayMode({mode:mode==='inline'?'fullscreen':'inline'});
web.onclick=()=>{
 const url=live?liveSpectatorURL(origin,live):hosted?.links?.spectator;
 if(url)void openLink(url);
};
strategy.onclick=()=>{if(origin)void openLink(new URL('/?strategy',origin).href);};
joinWeb.onclick=event=>{event.preventDefault();releaseOpponent();void openLink(joinWeb.href);};
menuToggle.onclick=()=>{
 const open=menu.hidden;
 setMenuOpen(open);
 if(open&&menuInRace)menu.scrollIntoView({block:'start'});
};
backToFeed.onclick=()=>{
 setMenuOpen(false);
 menuToggle.focus({preventScroll:true});
 raceView.scrollIntoView({block:'start'});
};
setup.onchange=refreshSetup;
setup.onsubmit=async event=>{
 event.preventDefault();
 if(openLobby.disabled)return;
 const error=element('mcp-join-error');
 error.textContent='';
 const circuit=circuitChoice.value as CircuitId,matchup=matchupChoice.value as Matchup;
 const selected=selectedMode();
 if(selected==='live'){
  const strategist=strategistChoice.value as LiveStrategist;
  void startPairing(circuit,strategist==='chatgpt'?'jev-vs-jev':matchup,strategist);
  return;
 }
 setupBusy=true;
 refreshSetup();
 try{
  if(selected==='chat')await openFromWidget('open_grand_prix_strategy',{circuit});
  else if(selected==='solo')await openFromWidget('open_grand_prix',{circuit,solo:true,autoplay:true});
  else await openFromWidget('open_grand_prix',{circuit,matchup,player:seatChoice.value,autoplay:seatChoice.value!=='spectator'&&autoConnect.checked});
 }catch(e){error.textContent=e instanceof Error?e.message:'Could not open a race lobby.';}
 finally{setupBusy=false;refreshSetup();}
};
pairOpen.onclick=()=>{if(pairing)void openLink(pairing.url);};
element('mcp-pair-cancel').onclick=cancelPairing;
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
  if(result.isError)throw new Error('Could not stop the strategy race.');
 }catch{error.textContent='Could not stop the strategy race.';}
 finally{ownerControl.disabled=false;}
};
joinForm.onsubmit=async event=>{
 event.preventDefault();
 const error=element('mcp-join-error');
 error.textContent='';
 const button=joinForm.querySelector('button')!;
 button.disabled=true;
 try{
  await openFromWidget('open_grand_prix',{invite:joinField.value});
  joinField.value='';
 }catch(e){error.textContent=e instanceof Error?e.message:'Unable to join race';}
 finally{button.disabled=false;}
};

await app.connect();
const ctx=app.getHostContext();
if(ctx)context(ctx);
