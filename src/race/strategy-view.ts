import {pitStrategyReplay} from './pit-strategy-replay';
import {strategyScenarios} from './strategy-scenarios';
import {batteryReleaseState, batteryReplay, batterySeeds, batteryState, cornerReplay} from './strategy-benchmarks';
import './strategy.css';

type LiveCorner = {model:string;runs:ReturnType<typeof cornerReplay>[]};
type BatteryVariant = {closing:number;responseMs?:number;pairs:(readonly [ReturnType<typeof batteryReplay>,ReturnType<typeof batteryReplay>])[]};
type LiveBattery = {model:string;variants:BatteryVariant[]};
type LivePit = {model:string;variants:{rearGap:number;call:{priority:'box'|'extend';radio:string};responseMs:number;run:ReturnType<typeof pitStrategyReplay>}[]};
const escapeText = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const seconds = (value: number) => value.toFixed(2) + ' s';
const chart = (label: string, series: {name: string; points: [number, number][]; mark?: [number, number]}[], zero = false) => {
 const all = series.flatMap(line => line.points);
 const limits = (axis: 0 | 1) => [Math.min(...all.map(p => p[axis]), ...(zero && axis === 1 ? [0] : [])), Math.max(...all.map(p => p[axis]), ...(zero && axis === 1 ? [0] : []))];
 const [left, right] = limits(0), [bottom, top] = limits(1);
 const xy = ([x, y]: [number, number]) => [24 + 552 * (x - left) / Math.max(.01, right - left), 155 - 135 * (y - bottom) / Math.max(.01, top - bottom)];
 const colors = ['#60e5c1', '#ffb466', '#90aaff', '#ed9df0'];
 return `<figure><svg viewBox="0 0 600 175" role="img" aria-label="${label}">${zero ? `<line x1="24" x2="576" y1="${xy([left,0])[1]}" y2="${xy([left,0])[1]}" stroke="#7b8799" stroke-dasharray="5 5"/>` : ''}${series.map((line, i) => {
  const [x,y] = line.mark ? xy(line.mark) : [0,0];
  return `<polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${line.points.map(p => xy(p).join(',')).join(' ')}"/>${line.mark ? `<circle cx="${x}" cy="${y}" r="5" fill="${colors[i]}" />` : ''}`;
 }).join('')}</svg><figcaption>${label} · ${series.map((line,i) => `<span style="color:${colors[i]}">${line.name}</span>`).join(' / ')}</figcaption></figure>`;
};

function corner(live?: LiveCorner) {
 const runs = live?.runs ?? [cornerReplay(false, 'adaptive'), cornerReplay(true, 'adaptive'), cornerReplay(false, 'reference'), cornerReplay(true, 'reference')];
 const name = (r: typeof runs[number]) => `${r.controller === 'adaptive' ? live ? 'Jev' : 'Local driver' : 'Reference'} · ${r.inside ? 'inside occupied' : 'inside clear'}`;
 return `<h2>Driver judgement</h2><p>Monza · Rettifilo · Same speed, tyres, grip and push call. Dots mark first braking.</p>${live ? `<p>Jev · ${escapeText(live.model)} · 200 ms per decision. The local driver supplies controls when a response is late or unavailable.</p>` : ''}${chart('Track distance × lateral offset', runs.map(r => ({name:name(r),points:r.path.map(p=>[p.distance,p.offset]),mark:r.firstBrake === null ? undefined : [r.firstBrake.distance,r.firstBrake.offset]})))}<table><thead><tr><th>Run</th><th>Brake at</th><th>Contact</th><th>Limits / off-track time</th><th>Deadlines missed</th>${live ? '<th>Jev controls applied</th><th>Responses unavailable</th>' : ''}<th>Time to marker</th></tr></thead><tbody>${runs.map(r=>`<tr><td>${name(r)}</td><td>${r.firstBrake?.distance.toFixed(0)??'—'} m</td><td>${r.contacts}</td><td>${r.limits} / ${seconds(r.secondsOutside)}</td><td>${r.missed}</td>${live ? `<td>${r.applied}</td><td>${r.unavailable}</td>` : ''}<td>${r.finished ? seconds(r.time) : 'Incomplete'}</td></tr>`).join('')}</tbody></table>`;
}

function battery(live?: LiveBattery) {
 const release=batteryReplay(batteryReleaseState(),17,'defend');
 const variants: BatteryVariant[] = live?.variants ?? [1,8].map(closing => {
  const state = batteryState(closing);
  return {closing,pairs:batterySeeds.map(seed => {
   const selected = batteryReplay(state,seed,undefined,undefined,true);
   return [selected,batteryReplay(state,seed,selected.call.priority==='attack'?'defend':'attack',undefined,true)] as const;
  })};
 });
 return `<h2>One boost, two rivals</h2><p>Two laps remaining · 1 boost available · 0.16 boost projected recharge</p>${live ? `<p>ChatGPT · ${escapeText(live.model)} · same local driver and seed in each pair</p>` : ''}${variants.map(({closing,pairs,responseMs})=>{
  const [selected, alternate] = pairs[0];
  const differentPlace = pairs.filter(([a,b]) => a.place !== b.place);
  const positionWins = differentPlace.filter(([a,b]) => a.place < b.place).length;
  const gapWins = pairs.filter(([a,b]) => a.place === b.place && a.finishGap < b.finishGap).length;
  return `<article><h3>Fourth closing at ${closing} m/s</h3><blockquote>${escapeText(selected.call.message)}</blockquote>${responseMs===undefined ? '' : `<p>Call recorded before deployment · ${responseMs} ms</p>`}<p>Budget ${selected.call.energy} boost · target sector ${(selected.call.sector??0)+1} · valid through lap ${selected.call.expiresLap}. Reassess if ${escapeText(selected.call.revisit.toLowerCase())}.</p><p>Alternative radio · ${alternate.call.message}</p><p>Selected call improved position in ${positionWins} of ${pairs.length} pairs and improved the gap to the starting P2 car in ${gapWins} of ${pairs.length - differentPlace.length} equal-place pairs.</p>${chart('Gap in seconds · three prior sectors, then six replay sectors · seed ' + selected.seed, [selected,alternate].flatMap(r=>['ahead','behind'].map(key=>({name:r.call.priority+' '+key,points:r.gaps.map((p,i)=>[i,p[key as 'ahead'|'behind']] as [number,number])}))),true)}<table><thead><tr><th>Seed</th><th>Call</th><th>Deployment</th><th>Finish</th><th>Gap to starting P2 / P4</th></tr></thead><tbody>${pairs.flatMap(pair=>pair.map(r=>`<tr><td>${r.seed}</td><td>${r.call.priority}</td><td>${r.deployment ? 'L'+r.deployment.lap+' · S'+r.deployment.sector+' · '+r.deployment.metres+' m' : 'Held'}</td><td>P${r.place}</td><td>${seconds(r.finishGap)} / ${seconds(r.rearGap)}</td></tr>`)).join('')}</tbody></table></article>`;
 }).join('')}${live?'':`<article><h3>Fourth drops out of range</h3><blockquote>${release.call.message}</blockquote><p>Lap ${release.revision?.lap}, sector ${release.revision?.sector} · ${release.calls[1]?.message}</p><p>${release.deployment ? `Deployed at ${release.deployment.metres} m in sector ${release.deployment.sector} · P${release.place}` : 'Boost held'}</p></article>`}`;
}

function pitReplay(live?: LivePit) {
 return `<h2>Pit strategy benchmark</h2><p>Same tyre age and pace. Rear gap changes the traffic at pit exit. Elapsed times are compared at the start of sector three after the rival and Jev have both stopped.</p>${live ? `<p>ChatGPT · ${escapeText(live.model)}</p>` : ''}${[26,15].map(gap=>{
  const now=pitStrategyReplay(gap,'box');
  const later=pitStrategyReplay(gap,'extend');
  const late=pitStrategyReplay(gap,'box',true);
  const decision=live?.variants.find(result=>result.rearGap===gap);
  return `<article><h3>Rear gap ${gap} s</h3><blockquote>${escapeText(decision?.call.radio??now.recommendation.message)}</blockquote>${decision ? `<p>Selected ${decision.call.priority} · ${decision.responseMs} ms · received at ${decision.run.receivedAt.toFixed(0)} m</p>` : ''}
  <figure><svg viewBox="0 0 600 100" role="img" aria-label="Approach to pit entry with radio delivery before and after the commitment marker">
  <path d="M40 48H560 M450 48Q480 62 560 76" stroke="#7b8799" fill="none"/>
  <path d="M300 32V64" stroke="#ffb466" stroke-width="3"/>
  <circle cx="245" cy="48" r="5" fill="#60e5c1"/><circle cx="355" cy="48" r="5" fill="#ed9df0"/>
  <text x="300" y="23" text-anchor="middle" fill="#ffb466">Commitment · ${now.entry.commitment.toFixed(0)} m</text>
  <text x="560" y="94" text-anchor="end" fill="#edf3fb">Pit lane</text></svg>
  <figcaption><span style="color:#60e5c1">On-time radio ${now.receivedAt.toFixed(0)} m</span> / <span style="color:#ed9df0">Late radio ${late.receivedAt.toFixed(0)} m</span></figcaption></figure>
  <table><thead><tr><th>Plan</th><th>Before commitment</th><th>Before pit entry</th><th>Stop</th><th>Rejoin</th><th>Elapsed</th></tr></thead><tbody>
  ${(decision?[now,later,late,decision.run]:[now,later,late]).map(r=>`<tr><td>${r===decision?.run?'Live · ':''}${r.plan}${r.entry.inTime?'':' (late)'}</td><td>${r.entry.inTime?'Yes':'No'}</td><td>${r.entry.beforeEntry?'Yes':'No'}</td><td>Lap ${r.stopLap}</td><td>${r.splits.some(lap=>lap.traffic)?'Traffic':'Clear air'} · ${seconds(r.splits[r.stopLap-1].rejoinGap??0)} gap</td><td>${seconds(r.elapsed)}</td></tr>`).join('')}
  </tbody></table><p>Rejoin gap is negative when Jev merges behind the rival.</p><p>Boxing now is ${seconds(Math.abs(now.elapsed-later.elapsed))} ${now.elapsed<later.elapsed?'faster':'slower'} than extending.</p></article>`;
 }).join('')}`;
}

export function mountStrategy() {
 const app = document.querySelector<HTMLElement>('#app')!;
 const options = Object.entries(strategyScenarios).map(([id,s]) => `<option value="${id}">${s.name}</option>`).join('');
 app.innerHTML = '<main class="strategy"><a href="/">MCP Grand Prix</a><h1>Race strategy replays</h1><p><a href="/?replay">Historical races</a></p><label>Scenario <select><option value="corner">Corner judgement</option><option value="battery">One boost, two rivals</option><option value="pit-replay">Pit strategy benchmark</option>'+options+'</select></label> <button type="button" id="live-strategy" hidden></button> <button type="button" id="cancel-strategy" hidden>Cancel benchmark</button><p role="status" hidden></p><section></section></main>';
 const select = app.querySelector('select')!;
 const panel = app.querySelector('section')!;
 const liveButton=app.querySelector<HTMLButtonElement>('#live-strategy')!;
 const cancel=app.querySelector<HTMLButtonElement>('#cancel-strategy')!;
 const status=app.querySelector<HTMLElement>('[role="status"]')!;
 let models:{jev:string|null;chatgpt:string|null}|undefined;
 let running:AbortController|undefined;
 function updateActions(){
  const isJev=select.value==='corner';
  const isBenchmark=isJev||select.value==='battery'||select.value==='pit-replay';
  liveButton.hidden=!isBenchmark||!models||!!running;
  liveButton.textContent=isJev?'Run live Jev benchmark':'Run live ChatGPT benchmark';
  liveButton.disabled=!(isJev?models?.jev:models?.chatgpt);
  liveButton.title=liveButton.disabled?'Configure the live provider in the local game server.':'';
  cancel.hidden=!running;
 }
 const render = () => {
  const scenario = strategyScenarios[select.value as keyof typeof strategyScenarios];
  panel.innerHTML = scenario ? `<h2>${scenario.name}</h2>${scenario.cases().map(result => `<article><h3>${result.name}</h3><blockquote>${result.call.message}</blockquote><p>${result.outcome}</p><p>Reassess when ${result.call.revisit.toLowerCase()}.</p></article>`).join('')}` : select.value === 'pit-replay' ? pitReplay() : select.value === 'battery' ? battery() : corner();
 };
 select.addEventListener('change', () => {
  running?.abort();
  running=undefined;
  status.hidden=true;
  render();
  updateActions();
 });
 cancel.onclick=()=>running?.abort();
 liveButton.onclick=async()=>{
  const benchmark=select.value;
  const request=new AbortController();
  running=request;
  status.hidden=false;
  status.textContent=benchmark==='corner'?'Running both corner approaches. Jev receives a decision window every 200 ms.':'Waiting for ChatGPT’s calls.';
  updateActions();
  try {
   const response=await fetch('/api/strategy/live?benchmark='+encodeURIComponent(benchmark),{method:'POST',signal:request.signal});
   if(!response.ok)throw new Error('Live benchmark failed. Check the local provider configuration and try again.');
   const data=await response.json();
   if(running!==request)return;
   panel.innerHTML=benchmark==='corner'?corner(data):benchmark==='battery'?battery(data):pitReplay(data);
   status.textContent='Live benchmark complete.';
  } catch(error) {
   if(running===request)status.textContent=request.signal.aborted?'Benchmark cancelled.':error instanceof Error?error.message:'Live benchmark failed.';
  } finally {
   if(running===request){running=undefined;updateActions();}
  }
 };
 window.addEventListener('pagehide',()=>running?.abort(),{once:true});
 void fetch('/api/strategy/models').then(async response=>{
  if(response.ok)models=await response.json();
  updateActions();
 }).catch(()=>{});
 render();
}
