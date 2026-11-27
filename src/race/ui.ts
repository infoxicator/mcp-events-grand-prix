import {AI_CONTROL_INFO,AI_CONTROL_LABELS} from './ai-controls';
import {moveMapDot} from './hud-dom';
import {raceSessionLabel} from './live';
import {damageLevel} from './crashes';
import {mountTcamTelemetry} from './tcam-telemetry';
import {broadcastView} from './broadcast-view';
import {classification, opponents, paints, type GridEntry} from './grid';
import '@fontsource/space-grotesk/400.css';import '@fontsource/space-grotesk/500.css';import '@fontsource/space-grotesk/600.css';import '@fontsource/space-grotesk/700.css';import '@fontsource/space-mono/400.css';
import './style.css';
import {createScene,type CameraMode} from './scene';
import {connect,createInterpolator,type Connection} from './network';
import {blendRace} from './presentation-motion';
import {engineLabel,type Matchup} from './matchup';
import {PERSONAS,TEAMS,type ChatStrategyRadio,type Compound,type ErsMode,type HostedRoom,type Instruction,type Radio,type Team,type Race,type RaceState} from './types';
import {pitCommitmentPoint} from './strategy-calls';
import {getTrack,type CircuitId} from './track';
import {parseInvitation,playerURL,invitationCode} from './invitation';
import {copyInvitation} from '../clipboard';
import {radioOverlay} from './radio-overlay';
import {mountDriverRadio,type SendDriverQuestion} from './driver-radio';
import {mountEventLog} from './event-log-view';
import {nextSafetyCarLap,raceControlTelemetry,rainLabel,rainLevels,type Hazard,type RainLevel} from './race-control';
const stripe=(entry:GridEntry)=>paints(entry)[entry.team==='Mercedes'?1:0];
const timing=(seconds:number)=>!seconds?'—:—.———':`${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`;
const rcSvg=(body:string)=>`<svg class="rc-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const rcIcons={
 flag:rcSvg('<path d="M5 21V4"/><path d="M5 5h10.5l-1.8 4 1.8 4H5" fill="currentColor" fill-opacity=".2"/>'),
 scNow:rcSvg('<path d="M3 14.5h18v3a1 1 0 0 1-1 1h-1.5M5.5 18.5H4a1 1 0 0 1-1-1v-3l2.2-4.4A2 2 0 0 1 7 9h10a2 2 0 0 1 1.8 1.1L21 14.5"/><circle cx="7.5" cy="18.5" r="1.8"/><circle cx="16.5" cy="18.5" r="1.8"/><path d="M9.5 9V7.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V9" fill="currentColor" fill-opacity=".25"/><path d="M12 3.2v1.3M7.5 4.6l1 1M16.5 4.6l-1 1"/>'),
 scNext:rcSvg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/><path d="M12 7.5v4.8l3.2 1.8"/>'),
 scIn:rcSvg('<path d="M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/><path d="M15 8l-4 4 4 4"/><path d="M11 12h9"/>'),
 dry:rcSvg('<circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity=".2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.8 4.8l1.6 1.6M17.6 17.6l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6"/>'),
 light:rcSvg('<path d="M6.5 15.5h10.8a3.7 3.7 0 0 0 .5-7.35 5.2 5.2 0 0 0-10-1.45A3.8 3.8 0 0 0 6.5 15.5Z" fill="currentColor" fill-opacity=".14"/><path d="M12 18.5v2.5"/>'),
 moderate:rcSvg('<path d="M6.5 14.8h10.8a3.7 3.7 0 0 0 .5-7.35 5.2 5.2 0 0 0-10-1.45A3.8 3.8 0 0 0 6.5 14.8Z" fill="currentColor" fill-opacity=".16"/><path d="M9.5 17.8l-.8 3M14.8 17.8l-.8 3"/>'),
 heavy:rcSvg('<path d="M6.5 14.2h10.8a3.7 3.7 0 0 0 .5-7.35 5.2 5.2 0 0 0-10-1.45A3.8 3.8 0 0 0 6.5 14.2Z" fill="currentColor" fill-opacity=".2"/><path d="M8 17.2l-1 3.3M12.2 17.2l-1 3.3M16.4 17.2l-1 3.3"/>'),
};
const el=(id:string)=>document.getElementById(id)!;
export function mountRace(room:HostedRoom,options:{team?:Team|null;controller?:boolean;telemetry?:boolean;strategySeat?:Team;canStart?:()=>boolean;startReady?:(state:RaceState)=>boolean;onStart?:()=>void;openLink?:(url:string)=>void;sendDriverQuestion?:SendDriverQuestion|null}={}){
 const params=new URLSearchParams(location.search),team=room.live?null:options.team===undefined?(params.get('team')==='a'?'a':params.get('team')==='b'?'b':null):options.team;
 const strategySeat=options.strategySeat;
 const isEngineer=Boolean(team&&params.has('engineer'));
 const c=strategySeat?connect(strategySeat,room,{role:'driver',shouldDecide:()=>false})
  :connect(options.controller===false?null:team,room,isEngineer?{role:'engineer'}:undefined);
 const interpolate=createInterpolator();let camera:CameraMode=isEngineer?'broadcast':team?`cockpit-${team}`:'broadcast',disposed=false,frameId=0,lastUi=0,lastEvent='',title=params.has('intro'),replay:Race[]=[],replayStart=0,replayActive=false,graph:number[]=[],lastTick=-1,lastFrame=performance.now(),fps=60;
 el('app').innerHTML=`
 <header class="topbar"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-wordmark">MCP <b>Grand Prix</b></span></a><nav><a data-view="broadcast" href="${room.links?.spectator??`/?room=${room.room}&spectate`}">Broadcast</a><a data-view="a" href="${room.links?.a||'/?team=a'}">Ferrari pit wall</a><a data-view="b" href="${room.links?.b||'/?team=b'}">Mercedes pit wall</a><a id="strategy-link" href="/?strategy">Strategy replays</a><a id="historical-link" href="/?replay">Historical races</a><a id="drive-link" href="/?drive">Drive</a></nav><div class="top-status"><i></i><span id="connection">CONNECTING</span><span class="mock-badge" id="mode">AUTOPILOT</span></div></header>
 <main><div class="race-heading"><h1 class="eyebrow"><span id="country-flag" aria-label="Italy">🇮🇹</span> <span id="grand-prix-name">ITALIAN GRAND PRIX</span></h1><div class="track-meta"><b id="circuit-name">MONZA</b><span id="circuit-details">5.793 KM <em>•</em> 11 CORNERS <em>•</em> 3 LAPS</span><small id="circuit-weather">45.6189° N &nbsp; 9.2812° E &nbsp; / &nbsp; DRY 28°C</small></div></div>
 <section class="race-feed"><div class="feed-top"><span><i class="live-dot"></i> LIVE FEED <span id="view-label">${isEngineer?'STRATEGY PIT WALL / '+PERSONAS[team!].name:team?'ONBOARD / '+PERSONAS[team].name:'WORLD FEED'}</span></span><div class="feed-actions"><label class="matchup-label">DRIVERS<select id="circuit-select" disabled aria-label="Circuit"><option value="monza">Monza / Day</option><option value="las-vegas">Las Vegas / Night</option></select><select id="matchup-select" disabled aria-label="Driver matchup"><option value="jev-vs-jev">Jev vs Jev</option><option value="jev-vs-luna">Jev vs Luna</option></select></label><a id="solo-race" href="/?solo&local">Open solo lobby ↗</a><button id="title-button">Title sequence ↗</button><button id="share-toggle">Invite a team ＋</button></div></div>
 <div id="viewport" class="viewport"><div class="vignette"></div><div class="broadcast-bug">MCP <span>GP</span><small id="circuit-bug">MONZA / ITALY</small></div><div class="tower-stack"><div class="timing-tower"><div class="tower-header"><button id="grid-toggle" aria-expanded="false" aria-controls="timing-rows">Full grid ▾</button><b id="lap-counter">LAP 1 <small>/ 3</small></b></div><div id="timing-rows"></div><div class="tower-footer"><span id="race-phase">WAITING FOR TEAMS</span><span id="clock">00:00</span></div></div><div id="event-flash" class="event-flash" hidden></div></div>
 <div class="race-conditions" id="race-conditions" role="status" hidden></div>
 ${strategySeat?`<section id="autopilot-radio" class="autopilot-radio" aria-label="Driver radio" style="--team:${PERSONAS[strategySeat].colour}" hidden></section>`:''}
 <div class="corner-chip"><span>TRACK POSITION</span><b id="corner">Rettifilo</b></div>
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
 <div class="studio-heading"><b>MCP GP</b><span>Interactive 3D explorer</span></div><div class="studio-controls"><button data-finish="colour">Colour</button><button data-finish="clay">Clay</button><button data-finish="wireframe">Wireframe</button><button id="turntable">Pause rotation</button><button id="exit-studio">Back to race</button></div>
 <div id="steering" class="steering" ${team?'':'hidden'}><div class="wheel-grips"></div><div class="wheel-display"><div class="rev-lights">● ● ● ● ● ● ● ●</div><div><strong id="dash-gear">1</strong><b id="dash-speed">0</b><small>KM/H</small></div><span id="dash-drs">AERO / CORNER</span><span id="dash-ers">ERS 90%</span></div><span class="wheel-logo">MCP GP / ${team?PERSONAS[team].name:'VECTOR'}</span></div>
 <details id="provisional" hidden><summary id="provisional-summary">Provisional standings</summary><div id="provisional-rows"></div></details>
 <div id="results" class="results" hidden><div class="eyebrow">▧ CHEQUERED FLAG / RACE COMPLETE</div><h2 id="winner">Race classification</h2><p>Final classification</p><div id="result-rows"></div><div class="results-actions"><button id="results-replay">↶ Replay the battle</button><button id="new-race">Race again ↗</button></div><small>MCP GRAND PRIX</small></div>
 <div class="camera-dock"><div class="camera-controls"><button data-camera="broadcast">◉ Broadcast</button><button data-camera="cockpit-a">44 Onboard</button><button data-camera="cockpit-b">63 Onboard</button><button data-camera="tcam-a">44 T-cam</button><button data-camera="tcam-b">63 T-cam</button><button data-camera="chase">Chase</button><button data-camera="pits">Pit lane</button><button data-camera="trackside">Trackside</button><button data-camera="side">Side</button><button data-camera="detail">Car detail</button><button data-camera="showroom">Showroom</button><button data-camera="helicopter">↗ Aerial</button><button data-camera="sphere" id="sphere-camera" hidden>◉ Sphere</button><button data-camera="strip" id="strip-camera" hidden>↗ The Strip</button></div><div class="feed-diagnostics"><span id="camera-name">HELICOPTER</span><span id="diagnostics">120 HZ PHYSICS · 30 HZ SYNC</span></div></div></div>
 <div class="telemetry-strip"><div class="speed-stat"><span>SPEED <small id="speed-trap">TRAP 0</small></span><strong id="speed"><span id="speed-value">000</span><small>KM/H</small></strong><svg id="speed-graph" viewBox="0 0 160 35" preserveAspectRatio="none" aria-hidden="true"><path class="trace-line"/><path class="trace-area"/></svg><div class="rpm-track"><i id="dock-rpm"></i></div></div><div><span>GEAR</span><strong id="gear">N</strong><small id="inputs">THR 0% / BRK 0%</small><div class="pedal-tracks" aria-hidden="true"><i><b id="dock-thr"></b></i><i><b id="dock-brk"></b></i></div></div><div><span>ENERGY <b id="ers-mode">BALANCED</b></span><strong id="ers">90<small>%</small></strong><div class="meter"><i id="ers-bar"></i></div></div><div><span>TYRES <b id="compound">SOFT</b></span><strong id="wear">100<small>%</small></strong><div class="life-track"><i id="dock-life"></i></div><small id="tyre-temp">85°C / 0.0 LAPS</small></div><div><span>LAST LAP <b id="sector-label">S1</b></span><strong class="lap-time" id="last-lap">—:—.———</strong><div class="sector-bars"><i>S1</i><i>S2</i><i>S3</i></div></div></div>
 <p id="driver-warning" class="driver-warning" role="status" hidden></p>
 ${isEngineer?`<section id="engineer-console" class="engineer-console" aria-label="Strategy Engineer Pit Wall">
  <div class="eng-head">
   <div class="eng-title"><span class="eyebrow">STRATEGY ENGINEER PIT WALL</span><strong id="eng-team">${PERSONAS[team!].name.toUpperCase()} · #${PERSONAS[team!].number}</strong></div>
   <div class="eng-badges">
    <span class="eng-pill" id="eng-driver-badge">DRIVER: YOU</span>
    <button type="button" id="eng-mode-toggle" class="eng-toggle">ENGINEER: LIVE (YOU)</button>
   </div>
  </div>
  <div class="eng-presets">
   <button type="button" data-preset="push">Push · Attack</button>
   <button type="button" data-preset="box-hard">Box · Hard</button>
   <button type="button" data-preset="box-soft">Box · Soft</button>
   <button type="button" data-preset="box-inter">Box · Inter</button>
   <button type="button" data-preset="manage">Manage Tyres</button>
   <button type="button" data-preset="defend">Defend</button>
   <button type="button" data-preset="stay-out">Stay Out</button>
  </div>
  <form id="eng-form" class="eng-form">
   <label>PACE<select id="eng-pace"><option value="push">Push</option><option value="balanced" selected>Balanced</option><option value="manage">Manage</option></select></label>
   <label>ERS<select id="eng-ers"><option value="deploy">Deploy</option><option value="balanced" selected>Balanced</option><option value="harvest">Harvest</option></select></label>
   <label>TACTIC<select id="eng-tactic"><option value="attack">Attack</option><option value="defend">Defend</option><option value="hold" selected>Hold</option></select></label>
   <label>TYRE<select id="eng-tyre"><option value="soft">Soft</option><option value="medium">Medium</option><option value="hard" selected>Hard</option><option value="intermediate">Inter</option><option value="wet">Wet</option></select></label>
   <label class="eng-check"><input type="checkbox" id="eng-box"/><span>Box this lap</span></label>
   <div class="eng-msg-row"><input id="eng-line" type="text" maxlength="180" placeholder="Radio message to driver…" value="Box this lap for fresh tyres."/><button type="submit" id="eng-send">Transmit radio ↗</button></div>
  </form>
  <div class="eng-log" id="eng-radio-log"><span class="eng-empty">No team radio transmissions yet.</span></div>
 </section>`:``}
 <div class="bottom-line"><button id="replay-button">↶ Instant replay</button></div>
 ${(room.live||isEngineer)&&!options.openLink?`<fieldset class="race-control-buttons" id="race-control-buttons" disabled>
  <legend>Race control</legend>
  <div class="rc-shell">
   <div class="rc-bar">
    <span class="rc-status" id="rc-status" data-state="green"><i aria-hidden="true"></i><span>GREEN FLAG · DRY TRACK</span></span>
   </div>
   <div class="rc-groups">
    <div class="rc-group rc-group--flag">
     <span class="rc-group-label">Track</span>
     <div class="rc-group-buttons">
      <button type="button" class="rc-btn rc-btn--flag" id="yellow-flags" aria-pressed="false"><span class="rc-icon" aria-hidden="true">${rcIcons.flag}</span><span class="rc-label">Yellow flags</span></button>
     </div>
    </div>
    <div class="rc-group rc-group--sc">
     <span class="rc-group-label">Safety car</span>
     <div class="rc-group-buttons">
      <button type="button" class="rc-btn rc-btn--sc" id="deploy-safety-car" data-active="false"><span class="rc-icon" aria-hidden="true">${rcIcons.scNow}</span><span class="rc-label">Deploy now</span></button>
      <button type="button" class="rc-btn rc-btn--sc" id="queue-safety-car" data-active="false"><span class="rc-icon" aria-hidden="true">${rcIcons.scNext}</span><span class="rc-label">Deploy next lap</span></button>
      <button type="button" class="rc-btn rc-btn--sc-in" id="return-safety-car" data-active="false"><span class="rc-icon" aria-hidden="true">${rcIcons.scIn}</span><span class="rc-label">Safety car in next lap</span></button>
     </div>
    </div>
    <div class="rc-group rc-group--rain">
     <span class="rc-group-label">Rain</span>
     <div class="rc-group-buttons">${rainLevels.map(level=>`<button type="button" class="rc-btn rc-btn--rain" data-rain="${level}" aria-pressed="false"><span class="rc-icon" aria-hidden="true">${rcIcons[level]}</span><span class="rc-label">${rainLabel(level)}</span></button>`).join('')}</div>
    </div>
   </div>
  </div>
 </fieldset>`:''}
 <section id="race-event-log" class="race-event-log" aria-labelledby="event-log-title"></section></section></main>
 <dialog id="share-dialog"><div class="eyebrow">SHARED RACE / TEAM INVITATIONS</div><h2>Bring your rival.</h2><p>One team per host. Send a seat invitation to join this race.</p><div id="share-codes"></div><form id="join-form"><label>Join by invitation<input id="join-input" placeholder="jev:room:team:credential" autocomplete="off"/></label><button>Join team ↗</button><span id="join-error" role="alert"></span></form><button id="share-close">Close</button></dialog>
 <div id="title-card" class="title-card" ${title?'':'hidden'}><div class="title-grid"></div><span class="eyebrow">RUBEN CASAS / @INFOXICADOR PRESENTS</span><h2>MCP<span>GRAND</span><em>PRIX.</em></h2><p>THE ENGINEER THINKS.<br>THE DRIVER <b>JUST KNOWS.</b></p><div class="title-footer"><span><i id="title-location">MONZA, ITALY</i><br><b>TWO TEAMS. TWO BRAINS. ONE WINNER.</b></span><button id="start-title">Continue to race ↗</button></div></div>`;
 el('app').classList.toggle('team-view',!!team);document.body.dataset.view=team??'spectator';document.querySelector(`[data-view="${team??'broadcast'}"]`)?.classList.add('active');
 const tcam=mountTcamTelemetry(el('viewport'));
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
   for(const [link,path] of [[el('app').querySelector<HTMLAnchorElement>('.brand')!,'/'],[el('strategy-link') as HTMLAnchorElement,'/?strategy'],[el('drive-link') as HTMLAnchorElement,'/?drive'],[el('historical-link') as HTMLAnchorElement,'/?replay']] as const){
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
 const rcStatusEl=raceControlButtons?.querySelector<HTMLElement>('#rc-status');
 const rcStatusText=rcStatusEl?.querySelector<HTMLElement>('span');
 const sendHazard=(hazard:Hazard)=>c.send({type:'race-control',hazard});
 if(deployButton)deployButton.onclick=()=>sendHazard({kind:'safety-car',when:'now'});
 if(queueButton)queueButton.onclick=()=>sendHazard({kind:'safety-car',when:'next-lap'});
 if(returnButton)returnButton.onclick=()=>sendHazard({kind:'safety-car-in'});
 if(yellowButton)yellowButton.onclick=()=>sendHazard({kind:'yellow',active:!c.state?.race.control?.yellowUntil});
 for(const button of rainButtons)button.onclick=()=>sendHazard({kind:'rain',level:button.dataset.rain as RainLevel});
 const engLogEl=isEngineer?document.getElementById('eng-radio-log'):null;
 const engDriverBadge=isEngineer?document.getElementById('eng-driver-badge'):null;
 const engModeToggle=isEngineer?document.getElementById('eng-mode-toggle') as HTMLButtonElement|null:null;
 if(isEngineer&&team){
  const sendOrder=(instruction:Instruction)=>c.send({type:'radio',instruction});
  const presets:Record<string,Instruction>={
   push:{pace:'push',ers:'deploy',box:false,tyre:'medium',tactic:'attack',line:'Push now. Full deploy. Attack the car ahead.'},
   'box-hard':{pace:'push',ers:'harvest',box:true,tyre:'hard',tactic:'hold',line:'Box, box. Hard tyres. Going for the undercut.'},
   'box-soft':{pace:'push',ers:'harvest',box:true,tyre:'soft',tactic:'hold',line:'Box this lap. Fresh softs. Attack to the flag.'},
   'box-inter':{pace:'manage',ers:'harvest',box:true,tyre:'intermediate',tactic:'hold',line:'Box for intermediates. Watch the grip on entry.'},
   manage:{pace:'manage',ers:'harvest',box:false,tyre:'medium',tactic:'hold',line:'Manage the tyres. Lift and coast, harvest ERS.'},
   defend:{pace:'balanced',ers:'deploy',box:false,tyre:'medium',tactic:'defend',line:'Car behind is closing. Cover the inside and defend.'},
   'stay-out':{pace:'balanced',ers:'balanced',box:false,tyre:'medium',tactic:'hold',line:'Stay out, stay out. Track position is key.'},
  };
  for(const btn of document.querySelectorAll<HTMLButtonElement>('#engineer-console [data-preset]')){
   btn.onclick=()=>{
    const p=presets[btn.dataset.preset!];
    if(!p)return;
    const cur=c.state?.race.cars[team];
    sendOrder({...p,tyre:p.box?p.tyre:(cur?.compound??p.tyre)});
   };
  }
  const form=document.getElementById('eng-form') as HTMLFormElement|null;
  if(form)form.onsubmit=ev=>{
   ev.preventDefault();
   const pace=(document.getElementById('eng-pace') as HTMLSelectElement).value as Instruction['pace'];
   const ers=(document.getElementById('eng-ers') as HTMLSelectElement).value as ErsMode;
   const tactic=(document.getElementById('eng-tactic') as HTMLSelectElement).value as Instruction['tactic'];
   const tyre=(document.getElementById('eng-tyre') as HTMLSelectElement).value as Compound;
   const box=(document.getElementById('eng-box') as HTMLInputElement).checked;
   const lineInput=document.getElementById('eng-line') as HTMLInputElement;
   const line=lineInput.value.trim()||(box?`Box this lap for ${tyre} tyres.`:`Pace ${pace}, ERS ${ers}, ${tactic}.`);
   sendOrder({pace,ers,box,tyre,tactic,line});
  };
  if(engModeToggle)engModeToggle.onclick=()=>{
   const cur=c.state?.engineerMode?.[team]??'joined';
   c.send({type:'engineer-mode',mode:cur==='joined'?'mock':'joined'});
  };
 }
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
 Object.defineProperty(window,'__renderStats',{configurable:true,get:()=>scene?{...scene.info,fps}:undefined});
 Object.defineProperty(window,'__raceState',{configurable:true,get:()=>c.state});
 let displayedMatchup:Matchup|undefined,displayedCircuit:CircuitId|undefined;
 const radio=radioOverlay(el('chatgpt-radio'),el('radio-announcement'),presentation.audio.speakRadio);
 const driverRadio=strategySeat?mountDriverRadio(el('autopilot-radio'),strategySeat,()=>c,{collapsible:true,sendDriverQuestion:options.sendDriverQuestion}):null;
 if(driverRadio){
  c.onQuestionAccepted=driverRadio.onAccepted;
  c.onQuestionError=driverRadio.onError;
 }
 const eventLog=mountEventLog(el('race-event-log'),c);
 const lightBulbs=Array.from(document.querySelectorAll<HTMLElement>('.lights i'));
 const gauges=['dock-rpm','dock-thr','dock-brk','dock-life','ers-bar'].map(id=>el(id));
 const previousGauges:number[]=[];
 function gauge(index:number,fraction:number){
  const level=Math.round(Math.max(0,Math.min(1,fraction))*100);
  if(previousGauges[index]===level)return;
  previousGauges[index]=level;gauges[index].style.transform=`scaleX(${level/100})`;
 }
 const trace=el('speed-graph').querySelectorAll('path');
 const sectorBars=Array.from(document.querySelectorAll<HTMLElement>('.sector-bars i'));
 let lastTimingHtml='',lastProvisionalHtml='',lastResultsHtml='',suspended3D=false;
 c.onSnapshot=(s,received)=>{
  if(disposed)return;
  interpolate.push(s,received);
  let latest:(Radio&Partial<ChatStrategyRadio>)|undefined;
  const seats=strategySeat?[strategySeat]:s.solo&&!s.guestChatStrategy?['a'] as const:team?[team]:TEAMS;
  for(const seat of seats){
   const order=s.latestChatRadio?.[seat]??s.race.radio.findLast(x=>x.team===seat&&!x.consultation&&(x.strategist==='chatgpt'||(s.drive&&x.speaker==='ENGINEER'&&x.source==='live')));
   if(order&&(!latest||order.id>latest.id))latest=order;
  }
  const consultations=seats.flatMap(seat=>s.driverConsultRadio?.[seat]??[]).sort((a,b)=>a.id-b.id);
  radio.show(latest,consultations);
 };
 let lastShot:CameraMode|undefined;
 function ui(s:RaceState,r:Race,now:number,shot:CameraMode|undefined){
  driverRadio?.sync(replayActive);
  document.body.dataset.phase=s.race.phase;document.body.dataset.room=s.room;document.body.dataset.tick=String(s.race.tick);document.body.dataset.connected=String(s.connected.a&&s.connected.b);document.body.dataset.replay=String(replayActive);
  const view=shot??camera;
  const focus:Team=view==='cockpit-a'||view==='tcam-a'?'a':view==='cockpit-b'||view==='tcam-b'?'b':team??r.leader,car=r.cars[focus],rival=r.cars[focus==='a'?'b':'a'],gap=Math.abs(car.distance-rival.distance)/Math.max(30,car.speed),order=classification(r);speedTrap=car.speedTrap;
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
   moveMapDot(marker,position);
  }
  if(raceControlButtons){
   const live=s.race.control;
   const hasNextLap=nextSafetyCarLap(s.race,track)<=s.race.laps;
   raceControlButtons.disabled=!(s.live==='running'||(s.drive&&isEngineer))||s.race.phase!=='racing'||c.status!=='CONNECTED'||replayActive;
   const scOut=Boolean(live?.safetyCar);
   const scQueued=Boolean(live?.queuedSafetyCarLap);
   const scReturning=Boolean(live?.safetyCarInLap);
   deployButton!.disabled=scOut;
   queueButton!.disabled=scQueued||scReturning||!hasNextLap;
   returnButton!.disabled=!scOut||scReturning||!hasNextLap;
   deployButton!.dataset.active=String(scOut);
   queueButton!.dataset.active=String(scQueued);
   returnButton!.dataset.active=String(scReturning);
   yellowButton!.setAttribute('aria-pressed',String(Boolean(live?.yellowUntil)));
   for(const button of rainButtons)button.setAttribute('aria-pressed',String(button.dataset.rain===(live?.rain??'dry')));
   if(rcStatusEl&&rcStatusText){
    const flagText=scReturning?`SC IN LAP ${live!.safetyCarInLap}`:scOut?'SAFETY CAR OUT':scQueued?`SC LAP ${live!.queuedSafetyCarLap}`:live?.yellowUntil?'YELLOW FLAGS':'GREEN FLAG';
    const weatherText=rain!=='dry'?`${rainLabel(rain).toUpperCase()} · ${wetness}%`:wetness>0?`DRYING · ${wetness}%`:'DRY TRACK';
    const nextText=`${flagText} · ${weatherText}`;
    if(rcStatusText.textContent!==nextText)rcStatusText.textContent=nextText;
    rcStatusEl.dataset.state=scOut||scQueued||scReturning?'sc':live?.yellowUntil?'yellow':rain!=='dry'?'rain':'green';
   }
  }
  if(!room.live&&!options.openLink){
   (el('solo-race') as HTMLAnchorElement).href=`/?solo&local&circuit=${r.circuit}`;
   el('solo-race').hidden=s.solo===true;
  }
  if(isEngineer&&team){
   const dMode=s.driverMode?.[team]??'jev';
   const eMode=s.engineerMode?.[team]??'joined';
   if(engDriverBadge){
    const lbl=dMode==='human'?'DRIVER: YOU (MANUAL)':dMode==='autopilot'?'DRIVER: AUTOPILOT':dMode==='luna'?'DRIVER: LUNA (AI)':'DRIVER: JEV (AI)';
    if(engDriverBadge.textContent!==lbl)engDriverBadge.textContent=lbl;
    engDriverBadge.dataset.mode=dMode;
   }
   if(engModeToggle){
    const lbl=eMode==='joined'?'ENGINEER: LIVE (YOU)':'ENGINEER: MOCKED (TAKE OVER)';
    if(engModeToggle.textContent!==lbl)engModeToggle.textContent=lbl;
    engModeToggle.dataset.mode=eMode;
   }
   if(engLogEl){
    const calls=s.race.radio.filter(x=>x.team===team).slice(-6).reverse();
    const html=calls.length?calls.map(x=>`<div class="eng-radio-row" data-src="${x.source}"><b>${x.speaker}</b><small>${x.source.toUpperCase()}</small><span>${x.text.replace(/</g,'&lt;')}</span></div>`).join(''):'<span class="eng-empty">No team radio transmissions yet.</span>';
    if(engLogEl.innerHTML!==html)engLogEl.innerHTML=html;
   }
  }
  const solo=s.solo&&!s.guestChatStrategy;
  if(s.solo){
   document.querySelector<HTMLElement>('[data-view="b"]')!.hidden=true;
   el('share-toggle').hidden=true;
   text('battle-label','⚡ ON-TRACK BATTLE');
   launchSeats.querySelector<HTMLElement>('a:nth-child(2)')!.hidden=true;
  }
  text('connection',room.local&&c.status==='CONNECTED'?'LOCAL':s.live&&c.status==='CONNECTED'?raceSessionLabel(s.live,s.strategyPractice,Boolean(s.guestChatStrategy)).toUpperCase():c.status);text('circuit-details',`${(track.OFFICIAL_LENGTH/1000).toFixed(3)} KM • ${track.corners} CORNERS • ${r.laps} LAPS`);const circuitSelector=el('circuit-select') as HTMLSelectElement;if(displayedCircuit!==s.race.circuit){displayedCircuit=s.race.circuit;circuitSelector.value=displayedCircuit??'monza';}circuitSelector.disabled=!c.canReset;circuitSelector.title=c.canReset?'Changing circuit opens a fresh lobby':'Only the race owner can change circuit';const selector=el('matchup-select') as HTMLSelectElement;if(displayedMatchup!==s.matchup){displayedMatchup=s.matchup;selector.value=displayedMatchup??'jev-vs-jev';}selector.disabled=!c.canReset||s.solo===true;selector.title=c.canReset?'Changing drivers opens a fresh lobby':'Only the race owner can change drivers';const observed=Object.values(s.decisions).filter(Boolean),hasFallback=observed.some(d=>d!.source==='fallback'),liveSeats=Object.values(s.players??{a:{mock:false},b:{mock:false}}).filter(p=>!p.mock),hasLive=liveSeats.length>0&&observed.filter(d=>(d!.source==='jev'||d!.source==='luna')).length>=liveSeats.length;const seatDriver=s.driverMode?.[strategySeat??'a'];const seatPlayer=s.players?.[strategySeat??'a'];const modeLabel=s.mode==='mock'?(seatDriver==='human'?'MANUAL':seatDriver==='luna'?'LUNA':seatDriver==='jev'?'JEV':'AUTOPILOT'):hasFallback?'API FALLBACK':!hasLive?(s.strategyPractice&&seatPlayer&&!seatPlayer.mock?`${seatPlayer.name} READY`:'APIS CONFIGURED'):s.strategyPractice&&seatPlayer&&!seatPlayer.mock?`${seatPlayer.name} LIVE`:s.mode==='mixed'?'LIVE + AUTOPILOT':s.matchup==='jev-vs-luna'?'JEV + LUNA LIVE':'JEV LIVE';const controlStyle=s.aiControlStyle?.[strategySeat??focus];
  text('mode',controlStyle&&controlStyle!=='tactical'?AI_CONTROL_LABELS[controlStyle]:modeLabel);
  el('mode').classList.toggle('api-fallback',hasFallback);text('lap-counter',`LAP ${Math.min(r.laps,Math.max(0,Math.floor(order[0].car.distance/LENGTH))+1)} / ${r.laps}`);text('clock',`${Math.floor(r.time/60).toString().padStart(2,'0')}:${Math.floor(r.time%60).toString().padStart(2,'0')}`);text('race-phase',replayActive?'INSTANT REPLAY':s.stepLockWaiting?'WAITING ON AI':r.phase==='racing'?(order.some(x=>x.car.finishTime!==null)?'CHEQUERED · '+order.filter(x=>x.car.finishTime!==null).length+'/'+order.length:flagLabel):r.phase.toUpperCase());
  const leader=order[0].car;
  const timingHtml=order.map(({entry,car:x},i)=>{
   if(!fullGrid&&(!entry.seat||solo&&entry.seat==='b')&&(!presentation.clean||i>=3))return '';
   const delta=leader.finishTime!==null&&x.finishTime!==null?x.finishTime-leader.finishTime:(leader.distance-x.distance)/Math.max(30,x.speed);
   const status=x.finishTime!==null?'FIN':i===0?'LEADER':r.phase==='racing'?'+'+delta.toFixed(1)+'s':'GRID';
   const player=entry.seat?r.cars[entry.seat]:undefined;
   const compound=x.compound??'medium';
   const tyre=`<span class="tyre-icon ${compound}"><b>${compound[0].toUpperCase()}</b><small>${(x.tyreAge??0).toFixed(1)}</small></span>`;
   const damage=damageLevel(player?.damage);
   const inPit=Boolean(player?.pit&&player.pit!=='none');
   const isYourCar=(strategySeat&&strategySeat===entry.seat)||(solo&&entry.seat==='a');
   const isPlayer=Boolean(isYourCar||(!solo&&entry.seat));
   const isAlert=Boolean(damage||inPit);
   const detail=damage?(player?.pit==='stopped'?'REPAIRING':Math.round(damage*100)+'% DAMAGE'):inPit?'PIT LANE':player?.drs?'AERO / OVERTAKE':entry.team+' · #'+entry.number;
   const roleTag=isYourCar?'YOUR CAR':solo&&entry.seat?(entry.seat==='a'?'YOUR CAR':'AI'):entry.seat?'PLAYER '+entry.seat.toUpperCase():entry.code;
   const rowClass=`timing-row${i===0?' is-leader':''}${isPlayer?' is-player':''}${damage?' has-damage':''}${inPit?' in-pit':''}`;
   return `<div class="${rowClass}" style="--team:${stripe(entry)}"><span class="position">${i+1}</span><i class="team-colour"></i><span class="driver-cell"><b class="driver-name">${presentation.clean&&!fullGrid?entry.code:entry.name}</b><small class="row-detail${isAlert?' is-alert':''}">${detail}</small></span><span class="interval"><span class="gap-val">${presentation.clean&&damage&&x.finishTime===null?detail:status}</span><small>${roleTag}</small></span>${tyre}</div>`;
  }).join('');
  if(timingHtml!==lastTimingHtml){lastTimingHtml=timingHtml;el('timing-rows').innerHTML=timingHtml;}
  markers.forEach((dot,i)=>{const x=r.field?.[i];dot.style.display=x?'':'none';if(x){const p=pointAt(x.distance);moveMapDot(dot,p);}});
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
  if((shot==='tcam-a'||shot==='tcam-b')&&r.phase==='racing'&&waiting.hidden&&feedView==='3d'){
   const seat=shot==='tcam-a'?'a':'b',onboard=r.cars[seat];
   const place=order.findIndex(row=>row.entry.seat===seat);
   const seconds=onboard.finishTime!==null?onboard.lastLap:Math.max(0,r.time-onboard.lapStart);
   tcam.update(seat,onboard,order[place].entry,place+1,cornerName(onboard.distance),Math.min(r.laps,onboard.lap+1),seconds?timing(seconds):'0:00.000',timing(onboard.bestLap));
  }else tcam.hide();
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
  el('lights').hidden=r.phase!=='lights';for(let i=0;i<lightBulbs.length;i++)lightBulbs[i].classList.toggle('lit',5-r.countdown>=i);el('battle').hidden=gap>=1||r.phase!=='racing'||car.pit!=='none'||rival.pit!=='none';text('battle-gap',`${gap.toFixed(3)}s`);
  text('corner',cornerName(car.distance));text('map-lap',`${String(Math.min(r.laps,car.lap+1)).padStart(2,'0')}/${String(r.laps).padStart(2,'0')}`);for(const t of ['a','b'] as const){const p=pointAt(r.cars[t].distance);moveMapDot(el(`map-${t}`),p);}
  text('camera-name',replayActive?'REPLAY / 0.65×':feedView==='3d'?scene?.label??'LOADING':'CIRCUIT OVERVIEW');text('diagnostics',`${Math.round(fps)} FPS · ${c.latency} MS · 120 HZ`);
  text('speed-value',`${Math.round(car.speed*3.6).toString().padStart(3,'0')}`);text('speed-trap',`TRAP ${Math.round(speedTrap)}`);text('gear',String(car.gear));text('inputs',`THR ${Math.round(car.throttle*100)}% / BRK ${Math.round(car.brake*100)}%`);text('ers',`${Math.round(car.ers)}%`);text('ers-mode',car.instruction.ers.toUpperCase());gauge(4,car.ers/100);text('wear',`${Math.round((1-car.wear)*100)}%`);text('compound',car.compound.toUpperCase());text('tyre-temp',`${Math.round(car.temperature)}°C / ${car.tyreAge.toFixed(1)} L / ${car.fuel.toFixed(1)}KG`);text('last-lap',timing(car.lastLap));text('sector-label',`S${car.sector+1}`);for(let i=0;i<sectorBars.length;i++)sectorBars[i].style.borderColor=({purple:'#bd7bff',green:'#b8f56b',yellow:'#f6cb68'}[car.splitColours[i]]);
  gauge(0,car.rpm/12800);gauge(1,car.throttle);gauge(2,car.brake);gauge(3,1-car.wear);
  const modeBadge=el('ers-mode'),compoundBadge=el('compound');
  if(modeBadge.dataset.mode!==car.instruction.ers)modeBadge.dataset.mode=car.instruction.ers;
  if(compoundBadge.dataset.compound!==car.compound)compoundBadge.dataset.compound=car.compound;
  if(lastTick!==r.tick){
   graph.push(car.speed/102);if(graph.length>60)graph.shift();lastTick=r.tick;
   const line=graph.map((v,i)=>`${i?'L':'M'}${(i*160/59).toFixed(1)},${(33-v*30).toFixed(1)}`).join(' ');
   trace[0].setAttribute('d',line);trace[1].setAttribute('d',line+` L${(graph.length-1)*160/59},35 H0Z`);
  }
  text('dash-gear',String(car.gear));text('dash-speed',String(Math.round(car.speed*3.6)));text('dash-drs',car.drs?'AERO / OVERTAKE':car.eligible.some(Boolean)?'OVERTAKE READY':'AERO / CORNER');el('dash-drs').classList.toggle('drs-open',car.drs);text('dash-ers',`ERS ${Math.round(car.ers)}%`);
  const decision=s.decisions[focus],engine=s.players?.[focus]?.engine??'jev',name=engineLabel(engine);
  const source=decision?.source==='jev'?'JEV / SYSTEM ONE':decision?.source==='luna'?'LUNA / DECISIONS'
   :decision?.source==='fallback'?`${name} / FALLBACK`:`${name} / MOCK`;
  const stats=s.driverStats?.[focus]??{successes:0,attempts:0};
  el('mode').title=`${controlStyle?`${AI_CONTROL_LABELS[controlStyle]} (${AI_CONTROL_INFO[controlStyle].how}) · `:''}${source} · ${stats.successes} CONFIRMED / ${stats.attempts} ATTEMPTS${decision?.api?.status?' · HTTP '+decision.api.status:''}`;
  el('driver-warning').hidden=!decision?.warning;
  text('driver-warning',decision?.warning??'');
  const latest=r.events.filter(x=>['overtake','pit','lap','finish','incident','collision'].includes(x.kind)).at(-1);if(latest&&String(latest.id)!==lastEvent){lastEvent=String(latest.id);text('event-flash',latest.kind==='lap'&&r.fastest?.team===latest.team&&Math.abs(r.fastest.time-r.cars[latest.team].lastLap)<.01?'PURPLE LAP / '+latest.message:latest.message);el('event-flash').hidden=false;el('event-flash').style.setProperty('--flash-colour',latest.kind==='lap'?'#c399ff':PERSONAS[latest.team].colour);}if(latest&&r.time-latest.time>7)el('event-flash').hidden=true;
  const finished=order.filter(x=>x.car.finishTime!==null).length;
  const provisional=r.phase==='racing'&&finished>0&&!replayActive;
  const board=el('provisional') as HTMLDetailsElement;board.hidden=!provisional;
  if(provisional){
   text('provisional-summary',`Provisional · ${finished}/${order.length} finished · ${order.length-finished} running`);
   if(board.open){const provHtml=order.map(({entry,car},i)=>
    `<div><b>${i+1} · ${entry.name}</b><span>${car.finishTime===null?'On lap '+Math.min(r.laps,Math.max(1,Math.floor(car.distance/LENGTH)+1)):timing(car.finishTime)}</span></div>`).join('');if(provHtml!==lastProvisionalHtml){lastProvisionalHtml=provHtml;el('provisional-rows').innerHTML=provHtml;}}
  }else{board.open=false;lastProvisionalHtml='';}
  el('results').hidden=r.phase!=='finished'||replayActive;if(r.phase==='finished'){text('winner',order[0].entry.name+' wins.');const resHtml=order.map(({entry,car:x},i)=>`<div class="result-row" style="--team:${stripe(entry)}"><strong>${String(i+1).padStart(2,'0')}</strong><div><b>${entry.name}</b><span>${entry.team} · #${entry.number}${strategySeat===entry.seat&&strategySeat?' · YOUR CAR':solo&&entry.seat?(entry.seat==='a'?' · YOUR CAR':' · AI'):entry.seat?' · PLAYER '+entry.seat.toUpperCase():''}</span></div><div><b>${timing(x.finishTime??0)}</b></div></div>`).join('');if(resHtml!==lastResultsHtml){lastResultsHtml=resHtml;el('result-rows').innerHTML=resHtml;}}else if(lastResultsHtml)lastResultsHtml='';
 }
 const isPaused=()=>document.documentElement.dataset.mcpHidden==='true'||(embeddedFeed&&document.hidden);
 function scheduleFrame(){if(!disposed&&!frameId&&!isPaused())frameId=requestAnimationFrame(frame);}
 function stopFrame(){if(frameId){cancelAnimationFrame(frameId);frameId=0;}}
 function suspend3D(){
  if(!embeddedFeed||!scene)return;
  scene.dispose();scene=undefined;suspended3D=true;
  showFeed('loading');
 }
 function onVisibility(){
  if(disposed)return;
  if(isPaused())stopFrame();
  else{const now=performance.now();lastFrame=now;if(embeddedFeed&&feedView==='loading'&&scene&&!scene.ready)renderDeadline=Math.max(renderDeadline,now+12_000);scheduleFrame();}
 }
 document.addEventListener('visibilitychange',onVisibility);
 document.addEventListener('mcp-visibility',onVisibility);
 function frame(now:number){
  frameId=0;
  if(disposed||isPaused())return;
  fps=fps*.95+Math.min(120,1000/Math.max(1,now-lastFrame))*.05;
  lastFrame=now;
  const state=c.state;
  if(!state){text('connection',c.status);scheduleFrame();return;}
  if(!presented||(state.race.circuit??'monza')!==track.id||suspended3D){
   const circuitChanged=!presented||(state.race.circuit??'monza')!==track.id;
   suspended3D=false;
   scene?.dispose();scene=undefined;
   if(circuitChanged){
    track=getTrack(state.race.circuit);
    ({LENGTH,pointAt,cornerName,SECTORS,tangentAt}=track);
   }
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
   if(circuitChanged){endReplay();replay=[];lastEvent='';graph=[];updateCircuit();}
  }
  let race=interpolate(state,c.received,now);
  if(replayActive){
   const replayStep=replay.length>1?replay[1].time-replay[0].time:0;
   const replayFps=replayStep>.045&&replayStep<.2?1/replayStep:30;
   const position=Math.max(0,(now-replayStart)/1000*replayFps*.65),idx=Math.floor(position);
   if(idx>=replay.length)endReplay();
   else race=blendRace(replay[idx],replay[Math.min(idx+1,replay.length-1)],position-idx);
  }
  const focus:Team=camera.endsWith('-b')?'b':camera.endsWith('-a')?'a':race.cars.b.pit==='stopped'?'b':race.cars.a.pit==='stopped'?'a':race.leader;
  presentation.audio.update(race,focus,c.status==='CONNECTED'&&state.connected.a&&state.connected.b&&now-c.received<500);
  if(scene)try{
   scene.render(race,now);
  }catch(error){
   if(!embeddedFeed)throw error;
   renderFailed=true;
   scene.dispose();scene=undefined;
   console.warn('Could not draw the 3D race feed',error);
  }
  if(embeddedFeed){
   const lost=Boolean(scene?.contextLost);
   if(scene?.ready||lost)renderDeadline=now+12_000;
   const permanentFailure=renderFailed||(!lost&&Boolean(scene?.startupError))||(!scene?.ready&&!lost&&now>=renderDeadline);
   const next=scene?.ready?'3d':(lost||permanentFailure)?'map':'loading';
   if(permanentFailure&&scene){
    renderFailed=true;
    scene.dispose();scene=undefined;
   }
   if(next!==feedView)showFeed(next);
  }
  const shot=scene?.ready?scene.activeCamera:undefined;
  if(shot!==lastShot||now-lastUi>100){lastShot=shot;lastUi=now;ui(state,race,now,shot);}
  scheduleFrame();
 }
 scheduleFrame();
 return {connection:c,suspend3D,dispose:()=>{
  if(disposed)return;
  disposed=true;
  document.removeEventListener('visibilitychange',onVisibility);document.removeEventListener('mcp-visibility',onVisibility);
  eventLog.dispose();radio.dispose();driverRadio?.dispose();tcam.dispose();replay.length=0;
  Reflect.deleteProperty(window,'__raceState');Reflect.deleteProperty(window,'__renderStats');
  presentation.dispose();stopFrame();c.close();scene?.dispose();scene=undefined;el('app').replaceChildren();
 }};
}
