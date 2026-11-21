import {raceSessionLabel} from './live';
import {damageLevel} from './crashes';
import {broadcastView} from './broadcast-view';
import {classification, opponents, paints, type GridEntry} from './grid';
import '@fontsource/space-grotesk/400.css';import '@fontsource/space-grotesk/500.css';import '@fontsource/space-grotesk/600.css';import '@fontsource/space-grotesk/700.css';import '@fontsource/space-mono/400.css';
import './style.css';
import {createScene,type CameraMode} from './scene';
import {connect,createInterpolator,type Connection} from './network';
import {blendRace} from './presentation-motion';
import {engineLabel,type Matchup} from './matchup';
import {PERSONAS,TEAMS,type ChatStrategyRadio,type HostedRoom,type Radio,type Team,type Race,type RaceState} from './types';
import {pitCommitmentPoint} from './strategy-calls';
import {getTrack,type CircuitId} from './track';
import {parseInvitation,playerURL,invitationCode} from './invitation';
import {copyInvitation} from '../clipboard';
import {radioOverlay} from './radio-overlay';
import {nextSafetyCarLap,raceControlTelemetry,rainLabel,rainLevels,type Hazard,type RainLevel} from './race-control';
const stripe=(entry:GridEntry)=>paints(entry)[entry.team==='Mercedes'?1:0];
const timing=(seconds:number)=>!seconds?'—:—.———':`${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`;
const el=(id:string)=>document.getElementById(id)!;
export function mountRace(room:HostedRoom,options:{team?:Team|null;controller?:boolean;telemetry?:boolean;strategySeat?:Team;canStart?:()=>boolean;startReady?:(state:RaceState)=>boolean;onStart?:()=>void;openLink?:(url:string)=>void}={}){
 const params=new URLSearchParams(location.search),team=room.live?null:options.team===undefined?(params.get('team')==='a'?'a':params.get('team')==='b'?'b':null):options.team;
 const strategySeat=options.strategySeat;
 const c=connect(options.controller===false?null:team,room),interpolate=createInterpolator();let camera:CameraMode=team?`cockpit-${team}`:'broadcast',disposed=false,frameId=0,lastUi=0,lastEvent='',title=params.has('intro'),replay:Race[]=[],replayStart=0,replayActive=false,graph:number[]=[],lastTick=-1,lastFrame=performance.now(),fps=60;
 el('app').innerHTML=`
 <header class="topbar"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-wordmark">MCP <b>Grand Prix</b></span></a><nav><a data-view="broadcast" href="${room.links?.spectator??`/?room=${room.room}&spectate`}">Broadcast</a><a data-view="a" href="${room.links?.a||'/?team=a'}">Ferrari pit wall</a><a data-view="b" href="${room.links?.b||'/?team=b'}">Mercedes pit wall</a><a id="strategy-link" href="/?strategy">Strategy replays</a></nav><div class="top-status"><i></i><span id="connection">CONNECTING</span><span class="mock-badge" id="mode">MOCK MODE</span></div></header>
 <main><div class="race-heading"><h1 class="eyebrow"><span id="country-flag" aria-label="Italy">🇮🇹</span> <span id="grand-prix-name">ITALIAN GRAND PRIX</span></h1><div class="track-meta"><b id="circuit-name">MONZA</b><span id="circuit-details">5.793 KM <em>•</em> 11 CORNERS <em>•</em> 3 LAPS</span><small id="circuit-weather">45.6189° N &nbsp; 9.2812° E &nbsp; / &nbsp; DRY 28°C</small></div></div>
 <section class="race-feed"><div class="feed-top"><span><i class="live-dot"></i> LIVE FEED <span id="view-label">${team?'ONBOARD / '+PERSONAS[team].name:'WORLD FEED'}</span></span><div class="feed-actions"><label class="matchup-label">DRIVERS<select id="circuit-select" disabled aria-label="Circuit"><option value="monza">Monza / Day</option><option value="las-vegas">Las Vegas / Night</option></select><select id="matchup-select" disabled aria-label="Driver matchup"><option value="jev-vs-jev">Jev vs Jev</option><option value="jev-vs-luna">Jev vs Luna</option></select></label><a id="solo-race" href="/?solo">Open solo lobby ↗</a><button id="title-button">Title sequence ↗</button><button id="share-toggle">Invite a team ＋</button></div></div>
 <div id="viewport" class="viewport"><div class="vignette"></div><div class="race-rain" aria-hidden="true"></div><div class="broadcast-bug">MCP <span>GP</span><small id="circuit-bug">MONZA / ITALY</small></div><div class="timing-tower"><div class="tower-header"><button id="grid-toggle" aria-expanded="false" aria-controls="timing-rows">Full grid ▾</button><b id="lap-counter">LAP 1 <small>/ 3</small></b></div><div id="timing-rows"></div><div class="tower-footer"><span id="race-phase">WAITING FOR TEAMS</span><span id="clock">00:00</span></div></div>
 <div class="race-conditions" id="race-conditions" role="status" hidden></div>
 <div id="event-flash" class="event-flash" hidden></div><div class="corner-chip"><span>TRACK POSITION</span><b id="corner">Rettifilo</b></div>
 <div class="feed-side">
  <section id="chatgpt-radio" class="chatgpt-radio" aria-label="ChatGPT radio" hidden></section>
  <div id="radio-announcement" class="radio-announcement" role="status" aria-atomic="true"></div>
  <div class="minimap"><svg viewBox="-90 -1440 1450 2390" aria-label="Race circuit minimap"><path id="map-track"/><path id="map-sector"/><circle id="map-commitment" r="24"><title>Pit commitment point</title></circle><g id="map-field"></g><circle id="map-a" r="44"/><circle id="map-b" r="44"/><circle id="map-safety-car" r="55" visibility="hidden"><title>Safety car</title></circle></svg><span><i id="map-name">MONZA</i> <b id="map-lap">01/03</b></span></div>
 </div>
 <div id="feed-map" class="feed-map" hidden>
  <svg id="feed-map-track" role="img" aria-label="Live circuit map">
   <use href="#map-track"/><use href="#map-sector"/><use href="#map-commitment"/><use href="#map-field"/><use href="#map-a"/><use href="#map-b"/><use href="#map-safety-car"/>
  </svg>
  <span id="feed-map-status" role="status">Preparing 3D view…</span>
 </div>
 <div id="waiting" class="waiting" ${room.live?'hidden':''}><span class="eyebrow">RACE CONTROL</span><h2>Race lobby</h2><p>Connecting to the race…</p><button id="start-race" hidden disabled>Start race</button><div><a href="${room.links?.a??'/?team=a'}" target="_blank">Launch Ferrari ↗</a><a href="${room.links?.b??'/?team=b'}" target="_blank">Launch Mercedes ↗</a></div></div>
 <div id="lights" class="lights" hidden><div>${'<i></i>'.repeat(5)}</div><span>HOLD YOUR BREATH.</span></div>
 <div id="battle" class="battle" hidden><span id="battle-label">⚡ PLAYER DUEL</span><b>FERRARI <i>VS</i> MERCEDES</b><strong id="battle-gap"></strong></div>
 <div class="camera-controls"><button data-camera="broadcast">◉ Broadcast</button><button data-camera="cockpit-a">44 Onboard</button><button data-camera="cockpit-b">63 Onboard</button><button data-camera="tcam-a">44 T-cam</button><button data-camera="tcam-b">63 T-cam</button><button data-camera="chase">Chase</button><button data-camera="pits">Pit lane</button><button data-camera="trackside">Trackside</button><button data-camera="side">Side</button><button data-camera="detail">Car detail</button><button data-camera="showroom">Showroom</button><button data-camera="helicopter">↗ Aerial</button><button data-camera="sphere" id="sphere-camera" hidden>◉ Sphere</button><button data-camera="strip" id="strip-camera" hidden>↗ The Strip</button></div>
 <div class="studio-heading"><b>MCP GP</b><span>Interactive 3D explorer</span></div><div class="studio-controls"><button data-finish="colour">Colour</button><button data-finish="clay">Clay</button><button data-finish="wireframe">Wireframe</button><button id="turntable">Pause rotation</button><button id="exit-studio">Back to race</button></div><div class="feed-diagnostics"><span id="camera-name">HELICOPTER</span><span id="diagnostics">120 HZ PHYSICS · 30 HZ SYNC</span></div>
 <div id="steering" class="steering" ${team?'':'hidden'}><div class="wheel-grips"></div><div class="wheel-display"><div class="rev-lights">● ● ● ● ● ● ● ●</div><div><strong id="dash-gear">1</strong><b id="dash-speed">0</b><small>KM/H</small></div><span id="dash-drs">LEGACY DRS CLOSED</span><span id="dash-ers">ERS 90%</span></div><span class="wheel-logo">MCP GP / ${team?PERSONAS[team].name:'VECTOR'}</span></div>
 <details id="provisional" hidden><summary id="provisional-summary">Provisional standings</summary><div id="provisional-rows"></div></details>
 <div id="results" class="results" hidden><div class="eyebrow">▧ CHEQUERED FLAG / RACE COMPLETE</div><h2 id="winner">Race classification</h2><p>Final classification</p><div id="result-rows"></div><div class="results-actions"><button id="results-replay">↶ Replay the battle</button><button id="new-race">Race again ↗</button></div><small>MCP GRAND PRIX</small></div>
 </div><div class="telemetry-strip"><div class="speed-stat"><span>SPEED <small id="speed-trap">TRAP 0</small></span><strong id="speed">000<small>KM/H</small></strong><svg id="speed-graph" viewBox="0 0 160 35"><path/></svg></div><div><span>GEAR</span><strong id="gear">N</strong><small id="inputs">THR 0% / BRK 0%</small></div><div><span>ENERGY <b id="ers-mode">BALANCED</b></span><strong id="ers">90<small>%</small></strong><div class="meter"><i id="ers-bar"></i></div></div><div><span>TYRES <b id="compound">SOFT</b></span><strong id="wear">100<small>%</small></strong><small id="tyre-temp">85°C / 0.0 LAPS</small></div><div><span>LAST LAP <b id="sector-label">S1</b></span><strong class="lap-time" id="last-lap">—:—.———</strong><div class="sector-bars"><i></i><i></i><i></i></div></div></div>
 <p id="driver-warning" class="driver-warning" role="status" hidden></p>
 <div class="bottom-line"><button id="replay-button">↶ Instant replay</button></div>
 ${room.live&&!options.openLink?`<fieldset class="race-control-buttons" id="race-control-buttons" disabled>
  <legend>Race control</legend>
  <details><summary>Safety car</summary><div><button id="deploy-safety-car">Deploy now</button><button id="queue-safety-car">Deploy next lap</button><button id="return-safety-car">Safety car in next lap</button></div></details>
  <button id="yellow-flags" aria-pressed="false">Yellow flags</button>
  <details><summary>Rain</summary><div>${rainLevels.map(level=>`<button data-rain="${level}" aria-pressed="false">${rainLabel(level)}</button>`).join('')}</div></details>
 </fieldset>`:''}</section></main>
 <dialog id="share-dialog"><div class="eyebrow">SHARED RACE / TEAM INVITATIONS</div><h2>Bring your rival.</h2><p>One team per host. Send a seat invitation to join this race.</p><div id="share-codes"></div><form id="join-form"><label>Join by invitation<input id="join-input" placeholder="jev:room:team:credential" autocomplete="off"/></label><button>Join team ↗</button><span id="join-error" role="alert"></span></form><button id="share-close">Close</button></dialog>
 <div id="title-card" class="title-card" ${title?'':'hidden'}><div class="title-grid"></div><span class="eyebrow">RUBEN CASAS / @INFOXICADOR PRESENTS</span><h2>MCP<span>GRAND</span><em>PRIX.</em></h2><p>THE ENGINEER THINKS.<br>THE DRIVER <b>JUST KNOWS.</b></p><div class="title-footer"><span><i id="title-location">MONZA, ITALY</i><br><b>TWO TEAMS. TWO BRAINS. ONE WINNER.</b></span><button id="start-title">Continue to race ↗</button></div></div>`;
 el('app').classList.toggle('team-view',!!team);document.body.dataset.view=team??'spectator';document.querySelector(`[data-view="${team??'broadcast'}"]`)?.classList.add('active');
 const waiting=el('waiting'),startRace=el('start-race') as HTMLButtonElement;
 const waitingTitle=waiting.querySelector('h2')!,waitingMessage=waiting.querySelector('p')!;
 const launchSeats=waiting.querySelector('div')!;
 startRace.onclick=options.onStart??(()=>c.send({type:'start'}));
 if(room.live||options.openLink){
  el('share-toggle').hidden=true;
  el('solo-race').hidden=true;
  const nav=el('app').querySelector('nav')!;
  nav.querySelectorAll<HTMLElement>('[data-view]').forEach(link=>{link.hidden=true;});
  el('new-race').hidden=true;
  if(room.live)el('circuit-select').closest('label')!.setAttribute('hidden','');
  if(options.openLink){
   for(const [link,path] of [[el('app').querySelector<HTMLAnchorElement>('.brand')!,'/'],[el('strategy-link') as HTMLAnchorElement,'/?strategy']] as const){
    link.href=new URL(path,room.origin).href;
    link.onclick=event=>{event.preventDefault();options.openLink!(link.href);};
   }
  }
 }
 let track=getTrack();let {LENGTH,pointAt,cornerName,SECTORS,tangentAt}=track;
 const raceControlButtons=document.querySelector<HTMLFieldSetElement>('#race-control-buttons');
 const rainButtons=Array.from(raceControlButtons?.querySelectorAll<HTMLButtonElement>('[data-rain]')??[]);
 const yellowButton=raceControlButtons?.querySelector<HTMLButtonElement>('#yellow-flags');
 const deployButton=raceControlButtons?.querySelector<HTMLButtonElement>('#deploy-safety-car');
 const queueButton=raceControlButtons?.querySelector<HTMLButtonElement>('#queue-safety-car');
 const returnButton=raceControlButtons?.querySelector<HTMLButtonElement>('#return-safety-car');
 const sendHazard=(hazard:Hazard)=>c.send({type:'race-control',hazard});
 if(deployButton)deployButton.onclick=()=>sendHazard({kind:'safety-car',when:'now'});
 if(queueButton)queueButton.onclick=()=>sendHazard({kind:'safety-car',when:'next-lap'});
 if(returnButton)returnButton.onclick=()=>sendHazard({kind:'safety-car-in'});
 if(yellowButton)yellowButton.onclick=()=>sendHazard({kind:'yellow',active:!c.state?.race.control?.yellowUntil});
 for(const button of rainButtons)button.onclick=()=>sendHazard({kind:'rain',level:button.dataset.rain as RainLevel});
 // The first authoritative snapshot selects the circuit. Creating a default
 // renderer here would also allocate Monza's models and atlas on every Vegas join.
 const telemetryOnly=options.telemetry||params.get('view')==='telemetry';
 const embeddedFeed=import.meta.env.MCP_APP==='true'&&!telemetryOnly;
 const viewport=el('viewport'),feedMap=el('feed-map');
 let feedView:'loading'|'map'|'3d'=embeddedFeed?'loading':'3d',renderDeadline=Infinity;
 let renderFailed=false;
 function showFeed(next:typeof feedView){
  feedView=next;
  viewport.dataset.feedView=next;
  feedMap.hidden=next==='3d';
  if(next!=='3d')text('feed-map-status',next==='loading'?'Preparing 3D view…':'3D unavailable · Live map');
 }
 if(embeddedFeed)showFeed('loading');
 if(telemetryOnly){
  viewport.classList.add('telemetry-only');
  const note=document.createElement('span');
  note.className='telemetry-note';
  note.textContent='Telemetry view';
  viewport.prepend(note);
 }
 let presented=false;
 let scene:ReturnType<typeof createScene>|undefined;let speedTrap=0;
 const watchURL=(circuit:string)=>new URL('/?watch&circuit='+encodeURIComponent(circuit),room.origin??location.origin).href;
 const presentation=broadcastView(viewport,!team&&window.top===window&&
  (params.has('watch')||params.has('broadcast')||!location.search),watchURL(params.get('circuit')??track.id),c,options.openLink);
 function updateCircuit(){presentation.setWatchURL(watchURL(track.id));
 const mapPoints=Array.from({length:Math.ceil(LENGTH/25)},(_,i)=>pointAt(i*25));el('map-track').setAttribute('d',mapPoints.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ')+'Z');
 el('map-sector').setAttribute('d',SECTORS.slice(1,-1).map(d=>{const p=pointAt(d),t=tangentAt(d);return `M${p.x-t.z*48},${p.z+t.x*48}L${p.x+t.z*48},${p.z-t.x*48}`;}).join(' '));
 const commitment=pointAt(pitCommitmentPoint(track.PIT_ENTRY));
 el('map-commitment').setAttribute('cx',String(commitment.x));
 el('map-commitment').setAttribute('cy',String(commitment.z));
 const xs=mapPoints.map(p=>p.x),zs=mapPoints.map(p=>p.z),pad=140;
 const viewBox=`${Math.min(...xs)-pad} ${Math.min(...zs)-pad} ${Math.max(...xs)-Math.min(...xs)+pad*2} ${Math.max(...zs)-Math.min(...zs)+pad*2}`;
 el('map-track').parentElement!.setAttribute('viewBox',viewBox);
 el('feed-map-track').setAttribute('viewBox',viewBox);
 text('circuit-name',track.name.toUpperCase());text('grand-prix-name',track.grandPrix);text('country-flag',track.night?'🇺🇸':'🇮🇹');el('country-flag').setAttribute('aria-label',track.night?'United States':'Italy');text('circuit-details',`${(track.OFFICIAL_LENGTH/1000).toFixed(3)} KM • ${track.corners} CORNERS • ${c.state?.race.laps??3} LAPS`);text('circuit-weather',`${track.coordinates} / ${track.night?'NIGHT':'DRY'} ${track.temperature}°C`);text('circuit-bug',`${track.name.toUpperCase()} / ${track.country}`);text('map-name',track.name.toUpperCase());text('title-location',`${track.name.toUpperCase()}, ${track.country}`);document.body.dataset.circuit=track.id;el('sphere-camera').hidden=!track.night;el('strip-camera').hidden=!track.night;document.title=`MCP Grand Prix · ${track.name}`;}updateCircuit();
 let fullGrid=false;
 el('grid-toggle').onclick=()=>{fullGrid=!fullGrid;el('grid-toggle').setAttribute('aria-expanded',String(fullGrid));text('grid-toggle',fullGrid?(c.state?.solo?'Player car ▴':'Player cars ▴'):'Full grid ▾');el('timing-rows').classList.toggle('expanded',fullGrid);};
 const markers=opponents.map(entry=>{
  const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
  dot.setAttribute('r','20');dot.setAttribute('fill',paints(entry)[0]);el('map-field').append(dot);return dot;
 });
 const cameras=document.querySelectorAll<HTMLButtonElement>('[data-camera]');function setCamera(next:CameraMode){camera=next;el('viewport').dataset.camera=next;scene?.setMode(next);cameras.forEach(b=>b.classList.toggle('selected',b.dataset.camera===next));el('steering').hidden=true;}cameras.forEach(b=>b.onclick=()=>setCamera(b.dataset.camera as CameraMode));const requested=params.get('camera');setCamera(['broadcast','side','trackside','pits','helicopter','flythrough','sphere','strip','detail','showroom','chase','cockpit-a','cockpit-b','tcam-a','tcam-b'].includes(requested??'')?requested as CameraMode:camera);
 document.querySelectorAll<HTMLButtonElement>('[data-finish]').forEach(b=>b.onclick=()=>{scene?.setFinish(b.dataset.finish as 'colour'|'clay'|'wireframe');document.querySelectorAll('[data-finish]').forEach(x=>x.classList.toggle('selected',x===b));});let spinning=true;el('turntable').onclick=()=>{spinning=!spinning;scene?.setTurntable(spinning);el('turntable').textContent=spinning?'Pause rotation':'Rotate';};el('exit-studio').onclick=()=>setCamera('broadcast');
 (el('circuit-select') as HTMLSelectElement).onchange=()=>c.send({type:'circuit',circuit:(el('circuit-select') as HTMLSelectElement).value as CircuitId});
 (el('matchup-select') as HTMLSelectElement).onchange=()=>c.send({type:'matchup',matchup:(el('matchup-select') as HTMLSelectElement).value as Matchup});
 el('title-button').onclick=()=>{el('title-card').hidden=false;};el('start-title').onclick=()=>{title=false;el('title-card').hidden=true;};
 const endReplay=()=>{replayActive=false;el('replay-button').textContent='↶ Instant replay';document.querySelector('.feed-replay')!.textContent='Replay';};
 const showReplay=()=>{c.send({type:'replay'});};el('replay-button').onclick=()=>{if(replayActive){endReplay();}else showReplay();};el('results-replay').onclick=showReplay;c.onReplay=frames=>{if(!frames.length)return;replay=frames;replayStart=performance.now();replayActive=true;setCamera('broadcast');el('replay-button').textContent='● REPLAY / Back to live';document.querySelector('.feed-replay')!.textContent='Back to live';};el('new-race').onclick=()=>{if(c.canReset)c.send({type:'reset'});else location.assign('/?spectate');};
 el('share-toggle').onclick=()=>{(el('share-dialog') as HTMLDialogElement).showModal();};el('share-close').onclick=()=>{(el('share-dialog') as HTMLDialogElement).close();};
 if(room.links)for(const t of ['a','b'] as const){const u=room.links[t];if(!u)continue;const input=document.createElement('input');input.readOnly=true;input.value=invitationCode(room.room,t,new URLSearchParams(new URL(u).hash.slice(1)).get('token')!);input.setAttribute('aria-label',`${t} team invitation`);const label=document.createElement('label');label.textContent=`${PERSONAS[t].name} / TEAM ${t.toUpperCase()}`;label.append(input);const copy=document.createElement('button');copy.textContent=`Copy ${t.toUpperCase()} invitation`;copy.onclick=async()=>copy.textContent=await copyInvitation(input)?'Copied':'Selected — press ⌘C / Ctrl+C';el('share-codes').append(label,copy);}
 el('join-form').onsubmit=e=>{e.preventDefault();try{location.assign(playerURL(room.origin??location.origin,parseInvitation((el('join-input') as HTMLInputElement).value,room.origin??location.origin)));}catch(error){el('join-error').textContent=error instanceof Error?error.message:'Invalid invitation';}};
 function text(id:string,value:string){if(el(id).textContent!==value)el(id).textContent=value;}
 // Live telemetry is authoritative between renders, including an occluded or reconnecting seat.
 Object.defineProperty(window,'__raceState',{configurable:true,get:()=>c.state});
 let displayedMatchup:Matchup|undefined,displayedCircuit:CircuitId|undefined;
 const radio=radioOverlay(el('chatgpt-radio'),el('radio-announcement'),presentation.audio.speakRadio);
 c.onSnapshot=(s,received)=>{
  if(disposed)return;
  interpolate.push(s,received);
  let latest:(Radio&Partial<ChatStrategyRadio>)|undefined;
  const seats=strategySeat?[strategySeat]:s.solo&&!s.guestChatStrategy?['a'] as const:team?[team]:TEAMS;
  for(const seat of seats){
   const order=s.latestChatRadio?.[seat]??s.race.radio.findLast(x=>x.team===seat&&x.strategist==='chatgpt');
   if(order&&(!latest||order.id>latest.id))latest=order;
  }
  radio.show(latest);
 };
 function ui(s:RaceState,r:Race,now:number){
  document.body.dataset.phase=s.race.phase;document.body.dataset.room=s.room;document.body.dataset.tick=String(s.race.tick);document.body.dataset.connected=String(s.connected.a&&s.connected.b);document.body.dataset.replay=String(replayActive);
  const focus:Team=camera==='cockpit-a'||camera==='tcam-a'?'a':camera==='cockpit-b'||camera==='tcam-b'?'b':team??r.leader,car=r.cars[focus],rival=r.cars[focus==='a'?'b':'a'],gap=Math.abs(car.distance-rival.distance)/Math.max(30,car.speed),order=classification(r);speedTrap=car.speedTrap;
  const control=r.control,{flag,speedLimitKph,safetyCarScheduledLap,safetyCarInLap}=raceControlTelemetry(r);
  const flagLabel=flag==='safety-car'?'SAFETY CAR':flag==='yellow'?'YELLOW FLAGS':'GREEN FLAG';
  const rain=control?.rain??'dry',wetness=Math.round((control?.wetness??0)*100);
  viewport.dataset.rain=rain;
  viewport.dataset.flag=r.phase==='racing'?flag:'green';
  text('circuit-weather',`${track.coordinates} / ${rain!=='dry'?rainLabel(rain).toUpperCase():wetness?'TRACK DRYING':track.night?'NIGHT':'DRY'} ${track.temperature}°C`);
  const conditions=[
   speedLimitKph!==null?`${speedLimitKph} km/h · Hold position`:'',
   safetyCarScheduledLap?`Safety car scheduled for lap ${safetyCarScheduledLap}`:'',
   safetyCarInLap?`Safety car in at start of lap ${safetyCarInLap}`:'',
   rain!=='dry'||wetness>0?`${rain==='dry'?'Track drying':rainLabel(rain)} · ${wetness}% wet`:'',
  ].filter(Boolean);
  el('race-conditions').hidden=r.phase!=='racing'||!conditions.length;
  text('race-conditions',conditions.join(' / '));
  const safety=r.phase==='racing'?control?.safetyCar:undefined,marker=el('map-safety-car');
  marker.setAttribute('visibility',safety?'visible':'hidden');
  if(safety){
   const position=pointAt(safety.distance,safety.offset);
   marker.setAttribute('cx',String(position.x));
   marker.setAttribute('cy',String(position.z));
  }
  if(raceControlButtons){
   const live=s.race.control;
   const hasNextLap=nextSafetyCarLap(s.race,track)<=s.race.laps;
   raceControlButtons.disabled=s.live!=='running'||s.race.phase!=='racing'||c.status!=='CONNECTED'||replayActive;
   deployButton!.disabled=Boolean(live?.safetyCar);
   queueButton!.disabled=Boolean(live?.queuedSafetyCarLap||live?.safetyCarInLap)||!hasNextLap;
   returnButton!.disabled=!live?.safetyCar||Boolean(live.safetyCarInLap)||!hasNextLap;
   yellowButton!.setAttribute('aria-pressed',String(Boolean(live?.yellowUntil)));
   for(const button of rainButtons)button.setAttribute('aria-pressed',String(button.dataset.rain===(live?.rain??'dry')));
  }
  if(!room.live&&!options.openLink){
   (el('solo-race') as HTMLAnchorElement).href=`/?solo&circuit=${r.circuit}`;
   el('solo-race').hidden=s.solo===true;
  }
  const solo=s.solo&&!s.guestChatStrategy;
  if(s.solo){
   document.querySelector<HTMLElement>('[data-view="b"]')!.hidden=true;
   el('share-toggle').hidden=true;
   text('battle-label','⚡ ON-TRACK BATTLE');
   launchSeats.querySelector<HTMLElement>('a:nth-child(2)')!.hidden=true;
  }
  text('connection',s.live&&c.status==='CONNECTED'?raceSessionLabel(s.live,s.strategyPractice,Boolean(s.guestChatStrategy)).toUpperCase():c.status);const circuitSelector=el('circuit-select') as HTMLSelectElement;if(displayedCircuit!==s.race.circuit){displayedCircuit=s.race.circuit;circuitSelector.value=displayedCircuit??'monza';}circuitSelector.disabled=!c.canReset;circuitSelector.title=c.canReset?'Changing circuit opens a fresh lobby':'Only the race owner can change circuit';const selector=el('matchup-select') as HTMLSelectElement;if(displayedMatchup!==s.matchup){displayedMatchup=s.matchup;selector.value=displayedMatchup??'jev-vs-jev';}selector.disabled=!c.canReset||s.solo===true;selector.title=c.canReset?'Changing drivers opens a fresh lobby':'Only the race owner can change drivers';const observed=Object.values(s.decisions).filter(Boolean),hasFallback=observed.some(d=>d!.source==='fallback'),hasLive=observed.filter(d=>(d!.source==='jev'||d!.source==='luna')).length>=Object.values(s.players??{a:{mock:false},b:{mock:false}}).filter(p=>!p.mock).length;text('mode',s.mode==='mock'?(s.strategyPractice?'BUILT-IN DRIVERS':'MOCK MODE'):hasFallback?'API FALLBACK':!hasLive?'APIS CONFIGURED':s.mode==='mixed'?'LIVE + MOCK':s.matchup==='jev-vs-luna'?'JEV + LUNA LIVE':'JEV LIVE');el('mode').classList.toggle('api-fallback',hasFallback);text('lap-counter',`LAP ${Math.min(r.laps,Math.max(0,Math.floor(order[0].car.distance/LENGTH))+1)} / ${r.laps}`);text('clock',`${Math.floor(r.time/60).toString().padStart(2,'0')}:${Math.floor(r.time%60).toString().padStart(2,'0')}`);text('race-phase',replayActive?'INSTANT REPLAY':r.phase==='racing'?(order.some(x=>x.car.finishTime!==null)?'CHEQUERED · '+order.filter(x=>x.car.finishTime!==null).length+'/'+order.length:flagLabel):r.phase.toUpperCase());
  const leader=order[0].car;
  el('timing-rows').innerHTML=order.map(({entry,car:x},i)=>{
   if(!fullGrid&&(!entry.seat||solo&&entry.seat==='b')&&(!presentation.clean||i>=3))return '';
   const delta=leader.finishTime!==null&&x.finishTime!==null?x.finishTime-leader.finishTime:(leader.distance-x.distance)/Math.max(30,x.speed);
   const status=x.finishTime!==null?'FIN':i===0?'LEADER':r.phase==='racing'?'+'+delta.toFixed(1)+'s':'GRID';
   const player=entry.seat?r.cars[entry.seat]:undefined;
   const tyre=player&&!fullGrid?`<span class="tyre-icon ${player.compound}">${player.compound[0].toUpperCase()}<small>${player.tyreAge.toFixed(1)}</small></span>`:'';
   const damage=damageLevel(player?.damage);
   const detail=damage?(player?.pit==='stopped'?'REPAIRING':Math.round(damage*100)+'% DAMAGE'):player?.pit&&player.pit!=='none'?'PIT LANE':player?.drs?'LEGACY DRS OPEN':entry.team+' · #'+entry.number;
   return `<div class="timing-row" style="--team:${stripe(entry)}"><span class="position">${i+1}</span><i class="team-colour"></i><b>${presentation.clean&&!fullGrid?entry.code:entry.name}<small>${detail}</small></b><span class="interval">${presentation.clean&&damage&&x.finishTime===null?detail:status}<small>${strategySeat===entry.seat&&strategySeat?'YOUR CAR':solo&&entry.seat?(entry.seat==='a'?'YOUR CAR':'AI'):entry.seat?'PLAYER '+entry.seat.toUpperCase():entry.code}</small></span>${tyre}</div>`;
  }).join('');
  markers.forEach((dot,i)=>{const x=r.field?.[i];dot.style.display=x?'':'none';if(x){const p=pointAt(x.distance);dot.setAttribute('cx',String(p.x));dot.setAttribute('cy',String(p.z));}});
  const seatsReady=s.connected.a&&s.connected.b;
  const inLobby=s.race.phase==='lobby'&&(!s.live||s.live==='running');
  const canStart=options.canStart?.()??(c.canReset||c.team!==null);
  const canShowStart=inLobby&&canStart;
  const startReady=options.startReady?.(s)??true;
  startRace.hidden=!canShowStart;
  startRace.disabled=!canShowStart||!seatsReady||!startReady||feedView==='loading'||(!c.canReset&&c.status!=='CONNECTED');
  launchSeats.hidden=!!room.live||!!options.openLink||seatsReady;
  waiting.hidden=replayActive||((camera==='detail'||camera==='showroom')&&(!canShowStart||!seatsReady))||(!inLobby&&(!!s.live||seatsReady));
  waiting.classList.toggle('grid-ready',inLobby&&seatsReady);
  if(!waiting.hidden){
   const heading=inLobby?'Race lobby':'Race paused';
   let message=s.solo?'Waiting for Ferrari to connect.':'Waiting for both teams to connect.';
   if(seatsReady){
    if(!canStart)message='Waiting for the host to start the race.';
    else if(!startReady)message='Waiting for ChatGPT to subscribe.';
    else if(feedView==='loading')message='Preparing the 3D grid…';
    else message=feedView==='map'?'Grid ready in map view.':'Grid ready.';
   }
   if(waitingTitle.textContent!==heading)waitingTitle.textContent=heading;
   if(waitingMessage.textContent!==message)waitingMessage.textContent=message;
  }
  el('lights').hidden=r.phase!=='lights';document.querySelectorAll<HTMLElement>('.lights i').forEach((v,i)=>v.classList.toggle('lit',5-r.countdown>=i));el('battle').hidden=gap>=1||r.phase!=='racing'||car.pit!=='none'||rival.pit!=='none';text('battle-gap',`${gap.toFixed(3)}s`);
  text('corner',cornerName(car.distance));text('map-lap',`${String(Math.min(r.laps,car.lap+1)).padStart(2,'0')}/${String(r.laps).padStart(2,'0')}`);for(const t of ['a','b'] as const){const p=pointAt(r.cars[t].distance);el(`map-${t}`).setAttribute('cx',String(p.x));el(`map-${t}`).setAttribute('cy',String(p.z));}
  text('camera-name',replayActive?'REPLAY / 0.65×':feedView==='3d'?scene?.label??'LOADING':'CIRCUIT OVERVIEW');text('diagnostics',`${Math.round(fps)} FPS · ${c.latency} MS · 120 HZ`);
  text('speed',`${Math.round(car.speed*3.6).toString().padStart(3,'0')}`);el('speed').insertAdjacentHTML('beforeend','<small>KM/H</small>');text('speed-trap',`TRAP ${Math.round(speedTrap)}`);text('gear',String(car.gear));text('inputs',`THR ${Math.round(car.throttle*100)}% / BRK ${Math.round(car.brake*100)}%`);text('ers',`${Math.round(car.ers)}%`);text('ers-mode',car.instruction.ers.toUpperCase());el('ers-bar').style.width=`${car.ers}%`;text('wear',`${Math.round((1-car.wear)*100)}%`);text('compound',car.compound.toUpperCase());text('tyre-temp',`${Math.round(car.temperature)}°C / ${car.tyreAge.toFixed(1)} L / ${car.fuel.toFixed(1)}KG`);text('last-lap',timing(car.lastLap));text('sector-label',`S${car.sector+1}`);document.querySelectorAll<HTMLElement>('.sector-bars i').forEach((e,i)=>e.style.background=({purple:'#bd7bff',green:'#b8f56b',yellow:'#f6cb68'}[car.splitColours[i]]));
  if(lastTick!==r.tick){graph.push(car.speed/102);if(graph.length>60)graph.shift();lastTick=r.tick;}el('speed-graph').firstElementChild!.setAttribute('d',graph.map((v,i)=>`${i?'L':'M'}${i*160/59},${33-v*30}`).join(' '));text('dash-gear',String(car.gear));text('dash-speed',String(Math.round(car.speed*3.6)));text('dash-drs',car.drs?'LEGACY DRS OPEN':car.eligible.some(Boolean)?'LEGACY DRS READY':'LEGACY DRS CLOSED');el('dash-drs').classList.toggle('drs-open',car.drs);text('dash-ers',`ERS ${Math.round(car.ers)}%`);
  const decision=s.decisions[focus],engine=s.players?.[focus]?.engine??'jev',name=engineLabel(engine);
  const source=decision?.source==='jev'?'JEV / SYSTEM ONE':decision?.source==='luna'?'LUNA / DECISIONS'
   :decision?.source==='fallback'?`${name} / FALLBACK`:`${name} / MOCK`;
  const stats=s.driverStats?.[focus]??{successes:0,attempts:0};
  el('mode').title=`${source} · ${stats.successes} CONFIRMED / ${stats.attempts} ATTEMPTS${decision?.api?.status?' · HTTP '+decision.api.status:''}`;
  el('driver-warning').hidden=!decision?.warning;
  text('driver-warning',decision?.warning??'');
  const latest=r.events.filter(x=>['overtake','pit','lap','finish','incident','collision'].includes(x.kind)).at(-1);if(latest&&String(latest.id)!==lastEvent){lastEvent=String(latest.id);text('event-flash',latest.kind==='lap'&&r.fastest?.team===latest.team&&Math.abs(r.fastest.time-r.cars[latest.team].lastLap)<.01?'PURPLE LAP / '+latest.message:latest.message);el('event-flash').hidden=false;el('event-flash').style.setProperty('--flash-colour',latest.kind==='lap'?'#c399ff':PERSONAS[latest.team].colour);}if(latest&&r.time-latest.time>7)el('event-flash').hidden=true;
  const finished=order.filter(x=>x.car.finishTime!==null).length;
  const provisional=r.phase==='racing'&&finished>0&&!replayActive;
  const board=el('provisional') as HTMLDetailsElement;board.hidden=!provisional;
  if(provisional){
   text('provisional-summary',`Provisional · ${finished}/${order.length} finished · ${order.length-finished} running`);
   if(board.open)el('provisional-rows').innerHTML=order.map(({entry,car},i)=>
    `<div><b>${i+1} · ${entry.name}</b><span>${car.finishTime===null?'On lap '+Math.min(r.laps,Math.max(1,Math.floor(car.distance/LENGTH)+1)):timing(car.finishTime)}</span></div>`).join('');
  }else board.open=false;
  el('results').hidden=r.phase!=='finished'||replayActive;if(r.phase==='finished'){text('winner',order[0].entry.name+' wins.');el('result-rows').innerHTML=order.map(({entry,car:x},i)=>`<div class="result-row" style="--team:${stripe(entry)}"><strong>${String(i+1).padStart(2,'0')}</strong><div><b>${entry.name}</b><span>${entry.team} · #${entry.number}${strategySeat===entry.seat&&strategySeat?' · YOUR CAR':solo&&entry.seat?(entry.seat==='a'?' · YOUR CAR':' · AI'):entry.seat?' · PLAYER '+entry.seat.toUpperCase():''}</span></div><div><b>${timing(x.finishTime??0)}</b></div></div>`).join('');}
 }
 function frame(now:number){
  if(disposed)return;
  if(document.documentElement.dataset.mcpHidden==='true'){frameId=requestAnimationFrame(frame);return;}
  fps=fps*.95+Math.min(120,1000/Math.max(1,now-lastFrame))*.05;
  lastFrame=now;
  const state=c.state;
  if(!state){text('connection',c.status);frameId=requestAnimationFrame(frame);return;}
  if(!presented||(state.race.circuit??'monza')!==track.id){
   scene?.dispose();scene=undefined;
   track=getTrack(state.race.circuit);
   ({LENGTH,pointAt,cornerName,SECTORS,tangentAt}=track);
   if(embeddedFeed){renderFailed=false;renderDeadline=now+12_000;showFeed('loading');}
   if(!telemetryOnly)try{scene=createScene(viewport,track);}
   catch(error){
    if(!embeddedFeed)throw error;
    renderFailed=true;
    viewport.querySelector(':scope > canvas[aria-label]')?.remove();
    console.warn('Could not initialize the 3D race feed',error);
   }
   presented=true;
   if(!track.night&&(camera==='sphere'||camera==='strip'))setCamera('broadcast');
   else scene?.setMode(camera);
   endReplay();replay=[];lastEvent='';graph=[];updateCircuit();
  }
  let race=interpolate(state,c.received,now);
  if(replayActive){
   const position=Math.max(0,(now-replayStart)/1000*30*.65),idx=Math.floor(position);
   if(idx>=replay.length)endReplay();
   else race=blendRace(replay[idx],replay[Math.min(idx+1,replay.length-1)],position-idx);
  }
  const focus:Team=camera.endsWith('-b')?'b':camera.endsWith('-a')?'a':race.cars.b.pit==='stopped'?'b':race.cars.a.pit==='stopped'?'a':race.leader;
  presentation.audio.update(race,focus,c.status==='CONNECTED'&&state.connected.a&&state.connected.b&&now-c.received<500);
  if(scene)try{
   scene.render(race,now);
   (window as unknown as {__renderStats:unknown}).__renderStats={...scene.info,fps};
  }catch(error){
   if(!embeddedFeed)throw error;
   renderFailed=true;
   scene.dispose();scene=undefined;
   console.warn('Could not draw the 3D race feed',error);
  }
  if(embeddedFeed){
   const next=scene?.ready?'3d':renderFailed||scene?.startupError||now>=renderDeadline?'map':'loading';
   if(next!==feedView)showFeed(next);
  }
  if(now-lastUi>100){lastUi=now;ui(state,race,now);}
  frameId=requestAnimationFrame(frame);
 }
 frameId=requestAnimationFrame(frame);
 return {connection:c,dispose:()=>{disposed=true;radio.dispose();presentation.dispose();cancelAnimationFrame(frameId);c.close();scene?.dispose();}};
}
