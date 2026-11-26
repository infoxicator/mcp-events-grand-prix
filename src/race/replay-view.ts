import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/space-mono/400.css';
import {createReplayMap,type ReplayMap} from './replay-map';
import {isArchiveReplay,replayCatalog,replayAt,replayDriverAt,replayFlag,replayRaceName,replayStandings,replayWeather,type ReplayPositions,type ReplayRace,type ReplayTiming} from './replay';
import {copyInvitation} from '../clipboard';
import {archiveMotion,bundledMotion,type ReplayMotion} from './replay-motion';
import type {ReplayBenchmarkState} from '../../server/replay-benchmark';
import './replay.css';

const formatTime=(ms:number)=>{
 const seconds=Math.floor(ms/1000);
 return [Math.floor(seconds/3600),Math.floor((seconds%3600)/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
};
const lapTime=(s:number|null)=>s===null?'—':Math.floor(s/60)+':'+(s%60).toFixed(3).padStart(6,'0');
const gap=(value:number|string|null)=>typeof value==='number'?(value===0?'LEAD':'+'+value.toFixed(3)):String(value??'—');
const option=(label:string,value:string)=>new Option(label,value);
const tyres={soft:'S',medium:'M',hard:'H',intermediate:'I',wet:'W'} as const;
const capitalize=(name:string)=>name.charAt(0).toUpperCase()+name.slice(1);

async function json<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,init);
 if(!response.ok){
  const body=await response.json().catch(()=>null);
  throw new Error(body?.error??'Could not load the historical replay.');
 }
 return response.json();
}

export function mountReplay(params:URLSearchParams){
 const app=document.getElementById('app')!;
 app.className='history-app';
 const benchmark=params.get('benchmark');
 const key=new URLSearchParams(location.hash.slice(1)).get('key');
 const auth={Authorization:'Bearer '+(key??'')};
 const path=(action:string)=>'/api/replay-benchmarks/'+encodeURIComponent(benchmark??'')+'/'+action;
 let view=params.get('view')==='3d'?'3d':params.get('view')==='telemetry'||benchmark?'telemetry':'3d';
 document.title='Historical race replay · MCP Grand Prix';
 app.innerHTML=`
  <header class="history-header"><a class="history-home" href="/"><i aria-hidden="true"></i>MCP <b>Grand Prix</b></a>
   <nav aria-label="Race modes"><a href="/?watch">Broadcast</a><a href="/?strategy">Strategy replays</a><a href="/?replay" aria-current="page">Historical races</a></nav>
  </header>
  <main class="history-main">
   <div class="history-heading"><div><p id="replay-circuit">FORMULA ONE</p><h1 id="replay-title">Historical race replay</h1></div>
    <label for="replay-race">Race<select id="replay-race" aria-label="Race" disabled></select></label>
   </div>
   <p id="replay-message" role="status">Loading race catalogue…</p>
   <div id="replay-content" hidden>
    <div class="history-grid">
     <section class="history-panel history-track" aria-label="Replay track">
      <div class="history-track-header"><div class="history-status"><strong id="replay-lap"></strong><span id="replay-flag"></span><span id="replay-weather"></span></div>
       <div class="history-toggle" role="group" aria-label="Track view"><button type="button" id="replay-3d">3D track</button><button type="button" id="replay-2d">2D telemetry</button></div>
      </div>
      <div class="history-canvas"><div id="replay-canvas"></div><p id="replay-map-status" role="status" hidden></p></div>
      <div class="history-controls" id="replay-controls">
       <div class="history-progress"><time id="replay-elapsed"></time><input id="replay-seek" type="range" min="0" step="1" aria-label="Race time"><time id="replay-duration"></time></div>
       <div class="history-buttons"><button type="button" id="replay-reset" aria-label="Restart playback">↺</button><button type="button" id="replay-back" aria-label="Back 30 seconds">−30s</button>
        <button type="button" id="replay-play" class="history-primary">Play</button><button type="button" id="replay-forward" aria-label="Forward 30 seconds">+30s</button>
        <label for="replay-speed">Speed <select id="replay-speed" aria-label="Playback speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option><option value="16">16×</option><option value="32">32×</option><option value="64">64×</option></select></label>
        <label for="replay-lap-select">Go to <select id="replay-lap-select" aria-label="Go to lap"></select></label>
       </div>
      </div>
     </section>
     <section class="history-panel history-timing"><h2>Timing tower</h2><div class="history-scroll">
      <table><thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col">Interval</th><th scope="col">Tyre</th></tr></thead><tbody id="replay-standings"></tbody></table>
     </div></section>
     <section class="history-panel history-driver">
      <div class="history-driver-title"><div><p>DRIVER TELEMETRY</p><h2 id="replay-driver-name"></h2></div><label for="replay-driver">Driver <select id="replay-driver" aria-label="Driver telemetry"></select></label></div>
      <dl class="history-readings">
       <div><dt>Speed</dt><dd id="replay-driver-speed"></dd></div><div><dt>Gear</dt><dd id="replay-gear"></dd></div>
       <div><dt>Throttle</dt><dd id="replay-throttle"></dd></div><div><dt>Brake</dt><dd id="replay-brake"></dd></div>
       <div><dt>Compound</dt><dd id="replay-tyre"></dd></div><div><dt>Tyre age</dt><dd id="replay-age"></dd></div>
       <div><dt>Last lap</dt><dd id="replay-last-lap"></dd></div>
      </dl>
     </section>
     <section class="history-panel history-control"><h2>Race control</h2><ul id="replay-reports"></ul></section>
    </div>
    <section class="history-panel history-benchmark" aria-label="Model benchmark">
     <div class="history-benchmark-header"><div><h2>Model strategy benchmark</h2><p id="replay-benchmark-description">Compare pit timing, tyre choice and response time with a recorded race.</p></div>
      <button type="button" id="replay-next" class="history-primary" hidden>Start benchmark</button>
     </div>
     <details id="replay-setup"><summary>Connect a model</summary><p>In a chat with this MCP server connected, run the prompt below. Open the benchmark link after the model subscribes.</p>
      <div class="history-prompt"><input id="replay-prompt" type="text" aria-label="Model benchmark prompt" readonly><button type="button" id="replay-copy">Copy prompt</button></div>
     </details>
     <div id="replay-benchmark-run" hidden>
      <p id="replay-benchmark-status" role="status"></p>
      <div id="replay-benchmark-results" hidden><p id="replay-score"></p>
       <div class="history-result-scroll"><table><thead><tr><th>Lap</th><th>Model call</th><th>Recorded call</th><th>Pit timing</th><th>Compound</th><th>Response</th></tr></thead><tbody id="replay-results"></tbody></table></div>
       <button type="button" id="replay-export">Download results</button>
      </div>
     </div>
    </section>
    <footer>Historical data from <a href="https://f1archive.org/" target="_blank" rel="noreferrer">F1Archive</a> and <a href="https://openf1.org/" target="_blank" rel="noreferrer">OpenF1</a></footer>
   </div>
  </main>`;
 const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById('replay-'+id)! as T;
 const label=(id:string,value:string)=>{const node=element(id);if(node.textContent!==value)node.textContent=value;};
 const raceSelect=element<HTMLSelectElement>('race'),driverSelect=element<HTMLSelectElement>('driver'),lapSelect=element<HTMLSelectElement>('lap-select');
 const slider=element<HTMLInputElement>('seek'),speed=element<HTMLSelectElement>('speed');
 const button2d=element<HTMLButtonElement>('2d'),button3d=element<HTMLButtonElement>('3d'),next=element<HTMLButtonElement>('next');
 const standings=element<HTMLTableSectionElement>('standings');
 const rows=new Map<number,{row:HTMLTableRowElement;position:HTMLTableCellElement;driver:HTMLButtonElement;interval:HTMLTableCellElement;tyre:HTMLTableCellElement}>();
 let timing:ReplayTiming|undefined,positions:ReplayMotion|undefined,map:ReplayMap|undefined;
 let time=0,selected=0,playing=false,frame=0,lastFrame=0,lastTable=0,loadVersion=0,mapVersion=0;
 let loadAbort:AbortController|undefined,bench:ReplayBenchmarkState|undefined,benchBusy=false,benchError='',benchTimer:number|undefined;
 let resultCount=-1,disposed=false,benchRevision=0;
 const resize=new ResizeObserver(()=>map?.draw(time,selected));
 resize.observe(element('canvas'));

 function updateURL(){
  const url=new URL(location.href);
  url.searchParams.set('replay',raceSelect.value);
  url.searchParams.set('view',view);
  history.replaceState(null,'',url);
 }
 function message(text:string){label('message',text);element('message').hidden=!text;}
 function mountCanvas(){
  if(!timing||!positions)return;
  const revision=++mapVersion;
  map?.dispose();map=undefined;
  button2d.disabled=button3d.disabled=!positions.track.length;
  element('canvas').replaceChildren();
  if(!positions.track.length)return;
  button2d.setAttribute('aria-pressed',String(view==='telemetry'));
  button3d.setAttribute('aria-pressed',String(view==='3d'));
  const canvas=document.createElement('canvas');
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label',view==='3d'?'3D view of recorded race positions':'2D track map of recorded race positions');
  element('canvas').replaceChildren(canvas);
  if(view==='telemetry'){
   map=createReplayMap(canvas,timing,positions);
   map.draw(time,selected);
   return;
  }
  const race=timing,data=positions;
  void import('./replay-three').then(({createReplayScene})=>{
   if(revision!==mapVersion||disposed)return;
   map=createReplayScene(canvas,race,data);
   map.draw(time,selected);
  }).catch(()=>{
   if(revision!==mapVersion||disposed)return;
   view='telemetry';updateURL();mountCanvas();
   message('3D is unavailable on this device. Showing the 2D race map.');
  });
 }
 function select(number:number){
  selected=number;driverSelect.value=String(number);draw(true);
 }
 function setTime(value:number){
  if(!timing||benchmark)return;
  time=Math.min(timing.duration,Math.max(0,value));
  draw(true);
 }
 function play(active:boolean){
  playing=active;lastFrame=0;
  if(frame)cancelAnimationFrame(frame);
  frame=active?requestAnimationFrame(tick):0;
  label('play',playing?'Pause':'Play');
 }
 function tick(now:number){
  if(!timing||!playing)return;
  if(lastFrame)time=Math.min(timing.duration,time+(now-lastFrame)*Number(speed.value));
  lastFrame=now;
  draw(now-lastTable>200);
  if(time<timing.duration)frame=requestAnimationFrame(tick);
  else{play(false);draw(true);}
 }
 function makeRows(race:ReplayTiming){
  rows.clear();standings.replaceChildren();
  for(const driver of race.drivers){
   const row=standings.insertRow(),position=row.insertCell(),driverCell=row.insertCell(),interval=row.insertCell(),tyre=row.insertCell();
   const control=document.createElement('button');
   control.type='button';control.style.setProperty('--driver-color',driver.color);
   control.textContent=driver.code;control.title=driver.name;control.setAttribute('aria-label',driver.name);
   control.addEventListener('click',()=>select(driver.number));
   driverCell.append(control);
   rows.set(driver.number,{row,position,driver:control,interval,tyre});
  }
 }
 const put=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};
 function draw(updateTable=false){
  if(!timing||!positions)return;
  positions.prepare(time,selected);
  const status=positions.loading(time);
  label('map-status',status);element('map-status').hidden=!status;
  map?.draw(time,selected);
  label('elapsed',formatTime(time));
  if(!benchmark)slider.value=String(Math.round(time));
  if(!updateTable)return;
  lastTable=performance.now();
  const ordered=replayStandings(timing,time);
  const lap=Math.max(1,...ordered.map(driver=>driver.lap));
  label('lap','Lap '+lap+' / '+timing.laps);
  lapSelect.value=String(lap);
  const flag=replayFlag(timing,time),weather=replayWeather(timing,time);
  label('flag',flag);element('flag').dataset.flag=flag;
  label('weather',weather?(weather.rain?'Rain':'No rain')+(weather.trackC===null?'':' · '+weather.trackC.toFixed(0)+'°C track'):'Weather unavailable');
  for(const [index,driver] of ordered.entries()){
   const row=rows.get(driver.number)!;
   if(standings.rows[index]!==row.row)standings.insertBefore(row.row,standings.rows[index]??null);
   row.driver.setAttribute('aria-pressed',String(selected===driver.number));
   row.row.classList.toggle('selected',selected===driver.number);
   put(row.position,driver.position===null?'—':String(driver.position));
   put(row.interval,driver.status==='out'?'OUT':driver.inPit?'PIT':gap(driver.interval));
   put(row.tyre,driver.compound?tyres[driver.compound]:'—');
   row.tyre.dataset.tyre=driver.compound??'';
   row.tyre.title=driver.compound?capitalize(driver.compound):'Unknown tyre';
  }
  const driver=ordered.find(d=>d.number===selected)!;
  const input=driver.status==='running'?positions.telemetry(selected,time):null;
  label('driver-name',driver.name+' · '+driver.team);
  label('driver-speed',input?input.speed+' km/h':'—');
  label('gear',input?(input.gear===0?'N':String(input.gear)):'—');
  label('throttle',input?input.throttle+'%':'—');
  label('brake',input?(input.brake>0?'On':'Off'):'—');
  label('tyre',driver.compound?capitalize(driver.compound):'—');
  label('age',driver.tyreAge===null?'—':driver.tyreAge+' laps');
  label('last-lap',lapTime(driver.lastLap));
  const reportIndex=replayAt(timing.control,time),report=element('reports');
  if(report.dataset.index!==String(reportIndex)){
   report.dataset.index=String(reportIndex);
   report.replaceChildren(...timing.control.slice(Math.max(0,reportIndex-3),reportIndex+1).reverse().map(([ms,message])=>{
    const entry=document.createElement('li'),clock=document.createElement('time');
    clock.textContent=formatTime(ms);entry.append(clock,document.createTextNode(message));return entry;
   }));
   if(reportIndex===-1){
    const entry=document.createElement('li');entry.textContent='No race control messages yet.';report.append(entry);
   }
  }
  element<HTMLInputElement>('prompt').value=`Open a historical race strategy benchmark with open_grand_prix_replay for race ${timing.id}, driver ${selected}. Subscribe to grand_prix.strategy_required using the returned event_filter and give me the viewer link.`;
 }
 async function load(id:string){
  const version=++loadVersion;
  loadAbort?.abort();positions?.dispose();
  const abort=loadAbort=new AbortController();
  play(false);
  element('content').hidden=true;
  message('Loading race timing and car positions…');
  try{
   const archived=isArchiveReplay(id);
   const [race,bundled]=await Promise.all([
    json<ReplayTiming>(archived?'/api/replays/'+encodeURIComponent(id)+'/timing':'/replays/'+encodeURIComponent(id)+'.json',{signal:abort.signal}),
    archived?undefined:json<ReplayPositions>('/replays/'+encodeURIComponent(id)+'-positions.json',{signal:abort.signal}),
   ]);
   const data=bundled?bundledMotion(bundled):await archiveMotion(race,abort.signal,()=>draw(true));
   if(version!==loadVersion||disposed)return;
   timing=race;positions=data;time=bench?.time??0;
   selected=bench?.driver??race.drivers.find(driver=>driver.finish===1)?.number??race.drivers[0].number;
   raceSelect.value=id;
   label('title',replayRaceName(race));
   label('circuit',race.circuit.toUpperCase()+'  /  '+race.date);
   label('duration',formatTime(race.duration));
   driverSelect.replaceChildren(...race.drivers.map(driver=>option(driver.code+' · '+driver.name,String(driver.number))));
   driverSelect.value=String(selected);
   lapSelect.replaceChildren(...Array.from({length:race.laps},(_,i)=>option('Lap '+(i+1),String(i+1))));
   slider.max=String(race.duration);
   delete element('reports').dataset.index;
   makeRows(race);
   message('');element('content').hidden=false;
   updateURL();mountCanvas();draw(true);
   if(bench){
    const modelDriver=race.drivers.find(driver=>driver.number===bench!.driver)!;
    label('benchmark-description','Pit strategy for '+modelDriver.name+'. Compare pit timing, tyre choice and response time with the historical record.');
    renderBenchmark(bench);
   }
  }catch(error){
   if(abort.signal.aborted||disposed)return;
   message((error as Error).message);
  }
 }
 function renderBenchmark(state:ReplayBenchmarkState){
  bench=state;time=state.time;
  const results=state.results;
  next.disabled=benchBusy||!state.connected||Boolean(state.window)||state.done;
  next.hidden=state.done;
  next.textContent=results.length?'Next decision':'Start benchmark';
  let status=state.connected?'Model connected. Advance when ready.':'Waiting for the model to subscribe.';
  if(state.window){
   const remaining=Math.max(0,Math.ceil((state.window.expiresAt-Date.now())/1000));
   const delivery=state.window.delivery==='failed'?'Delivery failed':state.window.delivery==='sending'?'Sending event':'Awaiting model radio';
   status=`Decision ${results.length+1} of ${state.total} · Lap ${state.window.lap} · ${state.window.reasons.join(' / ')} · ${delivery} · ${remaining}s remaining`;
  }else if(state.done)status='Benchmark complete.';
  else if(results.length&&state.connected)status=`${results.length} of ${state.total} decisions recorded.`;
  label('benchmark-status',benchError||status);
  if(resultCount!==results.length){
   resultCount=results.length;
   const answered=results.filter(result=>result.responseMs!==null),matched=answered.filter(result=>result.timingMatch);
   const stops=results.filter(result=>result.historical.action==='box'),called=stops.filter(result=>result.timingMatch);
   label('score',`${answered.length} of ${results.length} answered · ${matched.length} of ${answered.length} matched recorded pit timing · ${called.length} of ${stops.length} recorded stops called`);
   const body=element<HTMLTableSectionElement>('results');
   body.replaceChildren();
   for(const result of [...results].reverse()){
    const row=body.insertRow();
    const model=result.action?(result.boxThisLap?'Box'+(result.tyre?' · '+capitalize(result.tyre):''):'Stay out')+' — '+result.radio:'Timed out';
    const historical=result.historical.action==='box'?'Box'+(result.historical.compound?' · '+capitalize(result.historical.compound):''):'Stay out';
    const match=(value:boolean|null)=>value===null?'—':value?'Match':'Different';
    for(const value of [String(result.lap),model,historical,match(result.timingMatch),match(result.compoundMatch),result.responseMs===null?'—':(result.responseMs/1000).toFixed(2)+'s']){
     row.insertCell().textContent=value;
    }
   }
   element('benchmark-results').hidden=!results.length;
  }
  draw(true);
 }
 async function refreshBenchmark(){
  if(benchBusy||disposed)return;
  const revision=++benchRevision;
  try{
   const state=await json<ReplayBenchmarkState>(path('status'),{headers:auth});
   if(!disposed&&revision===benchRevision){benchError='';renderBenchmark(state);}
  }catch(error){
   if(disposed||revision!==benchRevision)return;
   benchError=(error as Error).message;
   label('benchmark-status',benchError);next.disabled=true;
  }
 }

 raceSelect.addEventListener('change',()=>{if(raceSelect.value)void load(raceSelect.value);});
 driverSelect.addEventListener('change',()=>select(Number(driverSelect.value)));
 button2d.addEventListener('click',()=>{if(view==='telemetry')return;view='telemetry';message('');updateURL();mountCanvas();});
 button3d.addEventListener('click',()=>{if(view==='3d')return;view='3d';message('');updateURL();mountCanvas();});
 slider.addEventListener('input',()=>setTime(Number(slider.value)));
 element('reset').addEventListener('click',()=>{play(false);setTime(0);});
 element('back').addEventListener('click',()=>setTime(time-30_000));
 element('forward').addEventListener('click',()=>setTime(time+30_000));
 element('play').addEventListener('click',()=>{
  if(benchmark||!timing)return;
  if(time>=timing.duration)setTime(0);
  play(!playing);
 });
 lapSelect.addEventListener('change',()=>{
  if(!timing)return;
  const lap=Number(lapSelect.value);
  const starts=timing.drivers.flatMap(driver=>driver.laps.filter(row=>row[1]===lap).map(row=>row[0]));
  if(starts.length)setTime(Math.min(...starts));
 });
 next.addEventListener('click',async()=>{
  if(benchBusy)return;
  benchRevision++;benchBusy=true;next.disabled=true;benchError='';
  try{bench=await json<ReplayBenchmarkState>(path('next'),{method:'POST',headers:auth});}
  catch(error){benchError=(error as Error).message;}
  finally{benchBusy=false;if(bench)renderBenchmark(bench);}
 });
 element('export').addEventListener('click',()=>{
  if(!bench||!timing)return;
  const URLObject=URL.createObjectURL(new Blob([JSON.stringify({raceName:replayRaceName(timing),...bench},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=URLObject;link.download='grand-prix-'+timing.id+'-benchmark.json';link.click();
  window.setTimeout(()=>URL.revokeObjectURL(URLObject),1000);
 });
 element('copy').addEventListener('click',async()=>{
  try{label('copy',await copyInvitation(element<HTMLInputElement>('prompt'))?'Copied':'Select and copy the prompt');}
  catch{label('copy','Select and copy the prompt');}
 });
 async function start(){
  try{
   const [bundled,archive]=await Promise.all([json<ReplayRace[]>('/replays/index.json'),json<ReplayRace[]>('/replays/archive.json').catch(()=>[])]);
   const catalog=replayCatalog(bundled,archive);
   if(disposed)return;
   if(!catalog.length)throw new Error('There are no historical races in the catalogue.');
   const seasons=new Map<number,HTMLOptGroupElement>();
   for(const race of catalog){
    const group=seasons.get(race.year)??document.createElement('optgroup');
    group.label=String(race.year);group.append(option(replayRaceName(race),race.id));seasons.set(race.year,group);
   }
   raceSelect.replaceChildren(...seasons.values());
   if(benchmark){
    bench=await json<ReplayBenchmarkState>(path('status'),{headers:auth});
    if(disposed)return;
    element('controls').hidden=true;element('setup').hidden=true;element('benchmark-run').hidden=false;
    await load(bench.race);
    if(!disposed)benchTimer=window.setInterval(()=>void refreshBenchmark(),1000);
   }else{
    raceSelect.disabled=false;
    const id=params.get('replay');
    if(id&&!catalog.some(race=>race.id===id)){
     const placeholder=option('Choose a race','');
     placeholder.disabled=true;
     raceSelect.prepend(placeholder);raceSelect.value='';
     message('This race is unavailable. Choose a race from the catalogue.');
     return;
    }
    await load(id||catalog[0].id);
   }
  }catch(error){if(!disposed)message((error as Error).message);}
 }
 void start();
 return ()=>{
  disposed=true;mapVersion++;loadAbort?.abort();play(false);map?.dispose();positions?.dispose();resize.disconnect();
  if(benchTimer)clearInterval(benchTimer);
 };
}
