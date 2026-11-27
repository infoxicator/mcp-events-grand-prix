import type {RaceLogEntry,RaceLogKind} from './event-log';
import type {Connection} from './network';
import {PERSONAS} from './types';

type VisibleLogKind=Exclude<RaceLogKind,'driver'>;
type VisibleLogEntry=RaceLogEntry&{data:Extract<RaceLogEntry['data'],{kind:VisibleLogKind}>};
type FilterKey='all'|VisibleLogKind;

const filters:Record<FilterKey,string>={all:'All',strategy:'Strategist',radio:'Radio'};
const strategyStages={requested:'Strategy requested',delivered:'Event delivered','delivery-failed':'Event delivery failed','telemetry-read':'Telemetry read',rejected:'Radio rejected'};
const chevronSvg='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>';

function isVisible(entry:RaceLogEntry):entry is VisibleLogEntry{
 return entry.data.kind!=='driver';
}

function formatClock(secondsTotal:number){
 const seconds=Math.max(0,Math.floor(secondsTotal));
 return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

function describe(entry:VisibleLogEntry){
 const {data}=entry;
 if(data.kind==='strategy'){
  const actor=data.agent==='chatgpt'?`ChatGPT · ${strategyStages[data.stage]}`:'Pit wall · Telemetry';
  const chips:string[]=[];
  if(data.telemetry){
   chips.push(`P${data.telemetry.telemetry.position}`,`${Math.round(data.telemetry.telemetry.speedKph)} km/h`,data.telemetry.tyres.compound.toUpperCase());
   if(typeof data.telemetry.lapsRemaining==='number')chips.push(`${data.telemetry.lapsRemaining} laps left`);
  }else if(data.summary){
   chips.push(`P${data.summary.position}`,`${Math.round(data.summary.speedKph)} km/h`);
   if(data.summary.flag==='safety-car')chips.push('SAFETY CAR');
   else if(data.summary.flag==='yellow')chips.push('YELLOW');
   if(data.summary.rain!=='dry')chips.push(`RAIN ${data.summary.rain.toUpperCase()}`);
  }
  return {
   kindLabel:'Strategist',
   actor,
   title:data.reasons.length?data.reasons.join(' · '):strategyStages[data.stage],
   chips,
   stage:data.stage,
  };
 }
 const actor=data.strategist==='chatgpt'?'ChatGPT radio':data.speaker==='ENGINEER'?'Pit wall radio':`${data.speaker} radio`;
 const chips:string[]=[];
 if(data.instruction){
  if(data.instruction.box)chips.push(`BOX · ${data.instruction.tyre.toUpperCase()}`);
  chips.push(`PACE ${data.instruction.pace.toUpperCase()}`);
  if(data.instruction.ers!=='balanced')chips.push(`ERS ${data.instruction.ers.toUpperCase()}`);
 }
 chips.push(data.responseMs>0?`${data.source} · ${data.responseMs} ms`:data.source);
 return {
  kindLabel:'Radio',
  actor,
  title:data.text,
  chips,
  stage:data.source,
 };
}

async function copyPayloadText(text:string){
 try{
  if(navigator.clipboard?.writeText){
   await navigator.clipboard.writeText(text);
   return true;
  }
 }catch{}
 try{
  const field=document.createElement('textarea');
  field.value=text;
  field.setAttribute('readonly','');
  field.style.position='fixed';
  field.style.opacity='0';
  document.body.append(field);
  field.select();
  const ok=document.execCommand('copy');
  field.remove();
  return ok;
 }catch{
  return false;
 }
}

function renderRow(entry:VisibleLogEntry,onHeightChange:()=>void,onCopy:(button:HTMLButtonElement,json:string)=>void){
 const item=document.createElement('li');
 item.className='event-log-row';
 item.dataset.kind=entry.data.kind;
 item.dataset.team=entry.team;
 const event=describe(entry);
 item.dataset.stage=event.stage;

 const card=document.createElement('details');
 card.className='event-log-card';
 const summary=document.createElement('summary');
 summary.className='event-log-summary';

 const timeRail=document.createElement('div');
 timeRail.className='event-log-time';
 const clock=document.createElement('time');
 clock.textContent=formatClock(entry.time);
 const lap=document.createElement('span');
 lap.className='event-log-lap';
 lap.textContent=`L${entry.lap}`;
 timeRail.append(clock,lap);

 const main=document.createElement('div');
 main.className='event-log-main';

 const meta=document.createElement('div');
 meta.className='event-log-meta';
 const kind=document.createElement('span');
 kind.className='event-log-kind';
 kind.textContent=event.kindLabel;
 const team=document.createElement('span');
 team.className='event-log-team';
 const teamDot=document.createElement('i');
 teamDot.setAttribute('aria-hidden','true');
 team.append(teamDot,document.createTextNode(PERSONAS[entry.team].name));
 const actor=document.createElement('span');
 actor.className='event-log-actor';
 actor.textContent=event.actor;
 meta.append(kind,team,actor);

 const title=document.createElement('strong');
 title.className='event-log-title';
 title.textContent=event.title;

 main.append(meta,title);
 if(event.chips.length){
  const chips=document.createElement('div');
  chips.className='event-log-chips';
  for(const chipText of event.chips){
   const chip=document.createElement('span');
   chip.textContent=chipText;
   chips.append(chip);
  }
  main.append(chips);
 }

 const chevron=document.createElement('span');
 chevron.className='event-log-chevron';
 chevron.setAttribute('aria-hidden','true');
 chevron.innerHTML=chevronSvg;

 summary.append(timeRail,main,chevron);
 card.append(summary);

 card.addEventListener('toggle',()=>{
  if(card.open&&card.lastElementChild===summary){
   const drawer=document.createElement('div');
   drawer.className='event-log-drawer';
   const bar=document.createElement('div');
   bar.className='event-log-drawer-bar';
   const heading=document.createElement('span');
   heading.textContent='Event payload · JSON';
   const copyBtn=document.createElement('button');
   copyBtn.type='button';
   copyBtn.className='event-log-copy';
   copyBtn.textContent='Copy JSON';
   const json=JSON.stringify(entry.data,null,2);
   copyBtn.onclick=()=>onCopy(copyBtn,json);
   bar.append(heading,copyBtn);
   const payload=document.createElement('pre');
   payload.className='event-log-payload';
   payload.textContent=json;
   drawer.append(bar,payload);
   card.append(drawer);
  }
  onHeightChange();
 });

 item.append(card);
 return item;
}

export function mountEventLog(panel:HTMLElement,connection:Connection){
 panel.innerHTML=`<header class="event-log-head">
   <div class="event-log-title-wrap">
    <span class="event-log-dot" aria-hidden="true"></span>
    <h2 id="event-log-title">Event log</h2>
    <span class="event-log-total" aria-live="polite">0 events</span>
   </div>
   <div class="event-log-controls">
    <button type="button" class="event-log-jump" hidden>↑ Latest</button>
    <div class="event-log-filters" role="group" aria-label="Filter race events">
     ${(Object.entries(filters) as [FilterKey,string][]).map(([key,label])=>`<button type="button" data-filter="${key}" aria-pressed="${key==='all'}"><span class="event-log-filter-label">${label}</span><span class="event-log-filter-count" aria-hidden="true">0</span></button>`).join('')}
    </div>
   </div>
  </header>
  <div class="event-log-body" data-scrolled="false" data-more="false">
   <div class="event-log-empty">
    <strong>Waiting for strategist and radio events</strong>
    <span>Pit wall calls, strategy telemetry, and team radio will stream here live.</span>
   </div>
   <ol class="event-log-entries" aria-label="Recent race events"></ol>
  </div>`;

 const totalEl=panel.querySelector<HTMLElement>('.event-log-total')!;
 const jumpBtn=panel.querySelector<HTMLButtonElement>('.event-log-jump')!;
 const body=panel.querySelector<HTMLElement>('.event-log-body')!;
 const list=panel.querySelector<HTMLOListElement>('.event-log-entries')!;
 const empty=panel.querySelector<HTMLElement>('.event-log-empty')!;
 const emptyTitle=empty.querySelector('strong')!;
 const emptySubtitle=empty.querySelector('span')!;
 const buttons=Array.from(panel.querySelectorAll<HTMLButtonElement>('.event-log-filters button'));
 const countEls=new Map<FilterKey,HTMLElement>();
 for(const button of buttons){
  const key=button.dataset.filter as FilterKey;
  countEls.set(key,button.querySelector<HTMLElement>('.event-log-filter-count')!);
 }

 const entries=new Map<number,VisibleLogEntry>();
 const rows=new Map<number,HTMLLIElement>();
 let filter:FilterKey='all';
 let unseen=0;

 const matches=(entry:VisibleLogEntry)=>filter==='all'||entry.data.kind===filter;
 const isAtTop=()=>list.scrollTop<=4;

 function syncScrollState(){
  const scrolled=list.scrollTop>4;
  const more=list.scrollHeight-list.clientHeight-list.scrollTop>8;
  body.dataset.scrolled=String(scrolled);
  body.dataset.more=String(more);
  if(!scrolled)unseen=0;
  if(unseen>0){
   jumpBtn.hidden=false;
   jumpBtn.dataset.unread='true';
   jumpBtn.textContent=`↑ ${unseen} new`;
  }else if(list.scrollTop>48){
   jumpBtn.hidden=false;
   jumpBtn.dataset.unread='false';
   jumpBtn.textContent='↑ Latest';
  }else{
   jumpBtn.hidden=true;
   jumpBtn.dataset.unread='false';
  }
 }

 function updateCountsAndEmpty(){
  let strategyCount=0,radioCount=0;
  for(const entry of entries.values()){
   if(entry.data.kind==='strategy')strategyCount++;
   else radioCount++;
  }
  const allCount=strategyCount+radioCount;
  countEls.get('all')!.textContent=String(allCount);
  countEls.get('strategy')!.textContent=String(strategyCount);
  countEls.get('radio')!.textContent=String(radioCount);
  totalEl.textContent=allCount===1?'1 event':`${allCount} events`;

  const hasRows=rows.size>0;
  empty.hidden=hasRows;
  list.hidden=!hasRows;
  if(!hasRows){
   if(allCount===0){
    emptyTitle.textContent='Waiting for strategist and radio events';
    emptySubtitle.textContent='Pit wall calls, strategy telemetry, and team radio will stream here live.';
   }else if(filter==='strategy'){
    emptyTitle.textContent='No strategist events yet';
    emptySubtitle.textContent='Switch to All or wait for the next pit wall strategy trigger.';
   }else{
    emptyTitle.textContent='No radio events yet';
    emptySubtitle.textContent='Switch to All or wait for the next team radio transmission.';
   }
  }
 }

 const resets=new Map<HTMLButtonElement,ReturnType<typeof setTimeout>>();
 let disposed=false;
 async function onCopy(button:HTMLButtonElement,json:string){
  const copied=await copyPayloadText(json);
  if(disposed||!panel.contains(button))return;
  button.textContent=copied?'Copied':'Copy failed';
  clearTimeout(resets.get(button));
  resets.set(button,setTimeout(()=>{resets.delete(button);button.textContent='Copy JSON';},1400));
 }
 function addRow(entry:VisibleLogEntry){
  const row=renderRow(entry,syncScrollState,onCopy);
  rows.set(entry.id,row);
  list.prepend(row);
 }

 function render(){
  rows.clear();
  list.replaceChildren();
  unseen=0;
  for(const entry of entries.values())if(matches(entry))addRow(entry);
  list.scrollTop=0;
  updateCountsAndEmpty();
  syncScrollState();
 }

 for(const button of buttons)button.onclick=()=>{
  filter=button.dataset.filter as FilterKey;
  for(const option of buttons)option.setAttribute('aria-pressed',String(option===button));
  render();
 };

 jumpBtn.onclick=()=>{
  unseen=0;
  list.scrollTo({top:0,behavior:'smooth'});
  syncScrollState();
 };

 const onScroll=()=>syncScrollState();
 list.addEventListener('scroll',onScroll,{passive:true});

 const resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>syncScrollState()):null;
 resizeObserver?.observe(list);

 connection.onEventLog=update=>{
  if(update.reset){
   entries.clear();
   for(const entry of update.entries)if(isVisible(entry))entries.set(entry.id,entry);
   render();
   return;
  }
  const follow=isAtTop();
  const prevHeight=list.scrollHeight;
  const prevTop=list.scrollTop;
  let changed=false;
  let added=0;

  if(update.discarded!==undefined&&entries.has(update.discarded)){
   entries.delete(update.discarded);
   rows.get(update.discarded)?.remove();
   rows.delete(update.discarded);
   changed=true;
  }
  for(const entry of update.entries){
   if(!isVisible(entry)||entries.has(entry.id))continue;
   entries.set(entry.id,entry);
   changed=true;
   if(matches(entry)){
    addRow(entry);
    added++;
   }
  }
  if(!changed)return;
  if(added>0){
   if(follow)list.scrollTop=0;
   else{
    list.scrollTop=prevTop+Math.max(0,list.scrollHeight-prevHeight);
    unseen+=added;
   }
  }
  updateCountsAndEmpty();
  syncScrollState();
 };

 connection.subscribeEventLog(true);
 updateCountsAndEmpty();
 syncScrollState();

 return {
  dispose(){
   disposed=true;for(const timer of resets.values())clearTimeout(timer);resets.clear();
   list.removeEventListener('scroll',onScroll);
   resizeObserver?.disconnect();
   connection.subscribeEventLog(false);
   connection.onEventLog=undefined;
   entries.clear();
   rows.clear();
  },
 };
}
