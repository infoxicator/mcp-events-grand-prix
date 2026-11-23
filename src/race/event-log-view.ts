import type {RaceLogEntry,RaceLogKind} from './event-log';
import {engineLabel} from './matchup';
import type {Connection} from './network';
import {PERSONAS} from './types';

const filters={all:'All',strategy:'Strategist',driver:'Driver',radio:'Radio'};
const strategyStages={requested:'Strategy requested',delivered:'Event delivered','delivery-failed':'Event delivery failed','telemetry-read':'Telemetry read'};
const lineNames={hold:'Hold line',left:'Move left',right:'Move right'};

function describe(entry:RaceLogEntry){
 const {data}=entry;
 switch(data.kind){
  case 'strategy':{
   const label=data.agent==='chatgpt'?`ChatGPT · ${strategyStages[data.stage]}`:'Pit wall · Telemetry';
   const telemetry=data.telemetry;
   const detail=telemetry?`P${telemetry.telemetry.position} · ${telemetry.telemetry.speedKph} km/h · ${telemetry.tyres.compound}`:'';
   return {label,title:data.reasons.join(' · '),detail};
  }
  case 'driver':
   return {label:engineLabel(data.engine),title:`${lineNames[data.intent.side]} · ERS ${data.intent.ers?'on':'off'} · DRS ${data.intent.drs?'on':'off'}`,
    detail:`${data.source} · ${data.responseMs} ms`};
  case 'radio':
   return {label:data.strategist==='chatgpt'?'ChatGPT radio':data.speaker==='ENGINEER'?'Pit wall radio':`${data.speaker} radio`,
    title:data.text,detail:`${data.source} · ${data.responseMs} ms`};
 }
}

function renderRow(entry:RaceLogEntry){
 const item=document.createElement('li');
 item.dataset.kind=entry.data.kind;
 const card=document.createElement('details');
 const summary=document.createElement('summary');
 const label=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');
 const event=describe(entry);
 const seconds=Math.floor(entry.time);
 const time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 label.textContent=`${time} · Lap ${entry.lap} · ${PERSONAS[entry.team].name} · ${event.label}`;
 title.textContent=event.title;
 detail.textContent=event.detail;
 detail.hidden=!event.detail;
 summary.append(label,title,detail);
 card.append(summary);
 card.addEventListener('toggle',()=>{
  if(!card.open||card.lastElementChild!==summary)return;
  const payload=document.createElement('pre');
  payload.textContent=JSON.stringify(entry.data,null,2);
  card.append(payload);
 });
 item.append(card);
 return item;
}

export function mountEventLog(panel:HTMLDetailsElement,connection:Connection){
 panel.innerHTML=`<summary>Event log</summary>
  <div class="event-log-filters" role="group" aria-label="Filter race events">
   ${Object.entries(filters).map(([key,label])=>`<button type="button" data-filter="${key}" aria-pressed="${key==='all'}">${label}</button>`).join('')}
  </div>
  <p class="event-log-empty">Waiting for race events.</p>
  <ol class="event-log-entries" aria-label="Recent race events"></ol>`;
 const list=panel.querySelector('ol')!,empty=panel.querySelector('p')!;
 const buttons=Array.from(panel.querySelectorAll('button'));
 const entries=new Map<number,RaceLogEntry>();
 const rows=new Map<number,HTMLLIElement>();
 let filter:RaceLogKind|'all'='all';
 const matches=(entry:RaceLogEntry)=>filter==='all'||entry.data.kind===filter;
 function addRow(entry:RaceLogEntry){
  const row=renderRow(entry);
  rows.set(entry.id,row);
  list.prepend(row);
 }
 function render(){
  rows.clear();
  list.replaceChildren();
  for(const entry of entries.values())if(matches(entry))addRow(entry);
  list.scrollTop=0;
  empty.hidden=rows.size>0;
 }
 for(const button of buttons)button.onclick=()=>{
  filter=button.dataset.filter as typeof filter;
  for(const option of buttons)option.setAttribute('aria-pressed',String(option===button));
  render();
 };
 const onToggle=()=>connection.subscribeEventLog(panel.open);
 panel.addEventListener('toggle',onToggle);
 connection.onEventLog=update=>{
  if(update.reset){
   entries.clear();
   for(const entry of update.entries)entries.set(entry.id,entry);
   render();
   return;
  }
  const follow=list.scrollTop===0;
  if(update.discarded!==undefined){
   entries.delete(update.discarded);
   rows.get(update.discarded)?.remove();
   rows.delete(update.discarded);
  }
  for(const entry of update.entries){
   if(entries.has(entry.id))continue;
   entries.set(entry.id,entry);
   if(matches(entry))addRow(entry);
  }
  if(follow)list.scrollTop=0;
  empty.hidden=rows.size>0;
 };
 return {dispose(){panel.removeEventListener('toggle',onToggle);connection.onEventLog=undefined;entries.clear();rows.clear();}};
}
