import {playerEntry} from './grid';
import type {RadioSpeech} from './race-audio';
import {createRadioWave} from './radio-wave';
import {PERSONAS,type ChatStrategyRadio,type DriverConsultRadio,type Radio} from './types';

type Transmission=Radio&Partial<ChatStrategyRadio>;
type Speak=(message:string,speech:RadioSpeech)=>(()=>void)|undefined;
const holdMs=4320;
const entryMs=560;
const exitMs=160;
const captionLeadMs=0;
const captionCharacterMs=16;
const voiceLeadMs=0;
const clean=(line:string)=>line.trim().replace(/\s+/g,' ');
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});

export function radioLetterTime(offset:number,length:number){
 const duration=length*captionCharacterMs;
 const lead=Math.min(24,duration*.1);
 return offset*captionCharacterMs-lead*Math.sin(Math.PI*offset/length);
}

function playLine(transcript:HTMLElement,message:string,reducedMotion:boolean,speak:Speak,
 onVoice:(active:boolean)=>void,captions:HTMLElement,onComplete:()=>void){
 const words=`"${message}"`.split(' ').map(word=>Array.from(graphemes.segment(word),part=>part.segment));
 const length=words.reduce((sum,letters)=>sum+letters.length,words.length-1);
 const glyphs:{node:HTMLSpanElement;at:number}[]=[];
 let offset=0;
 for(const [index,letters] of words.entries()){
  const node=document.createElement('span');
  node.className='radio-word';
  for(const letter of letters){
   const glyph=document.createElement('span');
   glyph.className='radio-character';
   glyph.textContent=letter;
   node.append(glyph);
   glyphs.push({node:glyph,at:radioLetterTime(offset++,length)});
  }
  if(index)transcript.append(' ');
  transcript.append(node);
  offset++;
 }

 const duration=length*captionCharacterMs;
 const startsAt=performance.now()+captionLeadMs;
 let visible=0;
 let captionTimer:number|undefined;
 let stopSpeech:(()=>void)|undefined;
 let voiceTimer:number|undefined;
 const startVoice=()=>{
  stopSpeech=speak(message,{start:()=>onVoice(true),word:()=>onVoice(true),end:()=>onVoice(false)});
  if(!stopSpeech)onVoice(true);
 };
 const voiceDelay=reducedMotion?0:Math.max(0,captionLeadMs-voiceLeadMs);
 if(voiceDelay===0)startVoice();
 else voiceTimer=window.setTimeout(startVoice,voiceDelay);
 function reveal(elapsed:number){
  let last:HTMLElement|undefined;
  while(visible<glyphs.length&&glyphs[visible].at<=elapsed){
   last=glyphs[visible++].node;
   last.classList.add('radio-character-visible');
  }
  if(last&&!reducedMotion)followCaption(captions,last);
 }
 function typeNext(){
  const elapsed=performance.now()-startsAt;
  if(elapsed>=0&&transcript.hidden){
   transcript.hidden=false;
   const style=getComputedStyle(transcript);
   const firstLine=parseFloat(style.lineHeight)+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);
   const fullHeight=transcript.offsetHeight;
   if(fullHeight>firstLine&&captions.scrollHeight<=captions.clientHeight){
    transcript.animate([{height:`${firstLine}px`},{height:`${fullHeight}px`}],{duration:200,easing:'ease-out'});
   }
  }
  reveal(elapsed);
  if(elapsed>=duration){
   if(!stopSpeech)onVoice(false);
   onComplete();
   return;
  }
  const next=glyphs[visible]?.at??duration;
  captionTimer=window.setTimeout(typeNext,Math.ceil(next-elapsed));
 }
 if(reducedMotion){
  transcript.hidden=false;
  reveal(duration);
  onComplete();
 }else if(captionLeadMs===0)typeNext();
 else captionTimer=window.setTimeout(typeNext,captionLeadMs);
 return ()=>{clearTimeout(captionTimer);clearTimeout(voiceTimer);stopSpeech?.();onVoice(false);};
}

function followCaption(captions:HTMLElement,element:HTMLElement){
 if(captions.scrollHeight<=captions.clientHeight)return;
 const overflow=element.getBoundingClientRect().bottom-captions.getBoundingClientRect().bottom;
 if(overflow>0)captions.scrollTop+=Math.ceil(overflow);
}

export function radioOverlay(card:HTMLElement,announcement:HTMLElement,speak:Speak){
 let currentId='';
 let cancel=()=>{};
 const queue:DriverConsultRadio[]=[];
 let lastConsultationId=0;
 let playingConsultation=false;
 let latestOrder:Transmission|undefined;
 card.style.setProperty('--radio-entry',`${entryMs}ms`);
 card.style.setProperty('--radio-exit',`${exitMs}ms`);

 function display(order:Transmission|undefined,onDone?:()=>void){
  const id=order?`${order.team}:${order.id}`:'';
  if(id===currentId)return;
  currentId=id;
  cancel();
  card.classList.remove('radio-leaving');
  card.hidden=!order;
  if(!order){card.replaceChildren();announcement.textContent='';return;}

  const driver=playerEntry(order.team),surname=driver.name.split(' ').at(-1);
  const message=clean(order.submittedText??order.text);
  const raceControl=order.submittedText?`Race control · ${order.text}`:'';
  const speaker=order.consultation==='question'?'Driver':order.consultation==='answer'?'ChatGPT strategist':'';
  card.style.setProperty('--radio-team-colour',PERSONAS[order.team].colour);
  card.dataset.team=order.team;
  card.innerHTML=`<article class="radio-transmission">
   <header><canvas class="radio-wave" width="192" height="72" aria-hidden="true"></canvas>
   <h2>${surname}</h2><b class="radio-label">Radio</b>
   <b class="radio-number">${driver.number}</b><span class="radio-team" role="img" aria-label="${driver.team}"></span></header>
   <div class="radio-captions" aria-hidden="true">
    ${speaker?`<b class="radio-speaker">${speaker}</b>`:''}
    <p class="radio-transcript" hidden></p>
    <small class="radio-race-control" hidden></small>
   </div>
  </article>`;
  const captions=card.querySelector<HTMLElement>('.radio-captions')!;
  const transcript=card.querySelector<HTMLElement>('.radio-transcript')!;
  const note=card.querySelector<HTMLElement>('.radio-race-control')!;
  note.textContent=raceControl;

  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const waveform=createRadioWave(card.querySelector<HTMLCanvasElement>('.radio-wave')!,reducedMotion);
  let phaseTimer:number|undefined;
  // Sound and muted playback share the same waveform clock.
  waveform.open();
  const lap=order.lap===undefined?'':` Lap ${order.lap}.`;
  announcement.textContent=`${driver.name}, car ${driver.number}.${lap} ${speaker?`${speaker}. `:''}${message}${raceControl?` ${raceControl}`:''}`;
  const stopLine=playLine(transcript,message,reducedMotion,speak,waveform.speech,captions,()=>{
   note.hidden=!raceControl;
   if(raceControl&&!reducedMotion)followCaption(captions,note);
   phaseTimer=window.setTimeout(()=>{
    card.classList.add('radio-leaving');
    phaseTimer=window.setTimeout(()=>{card.hidden=true;stopLine();waveform.close();onDone?.();},exitMs);
   },holdMs);
  });
  cancel=()=>{clearTimeout(phaseTimer);stopLine();waveform.close();};
 }

 function nextConsultation(){
  const line=queue.shift();
  playingConsultation=Boolean(line);
  if(line)display(line,nextConsultation);
  else if(latestOrder&&latestOrder.id>lastConsultationId)display(latestOrder);
 }

 function show(order:Transmission|undefined,consultations:readonly DriverConsultRadio[]=[]){
  latestOrder=order;
  for(const line of consultations){
   if(line.id<=lastConsultationId)continue;
   queue.push(line);
   lastConsultationId=line.id;
  }
  if(playingConsultation)return;
  if(queue.length)nextConsultation();
  else if(!order||order.id>lastConsultationId)display(order);
 }

 return {show,dispose:()=>cancel()};
}
