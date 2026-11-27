import type {Connection} from './network';
import type {Race,Team} from './types';
import {getTrack} from './track';
import {kerbHeight} from './suspension';

export interface RadioSpeech {start:()=>void;word:(charIndex:number)=>void;end:()=>void}

/** One audible feed per origin. Unlock and ownership both require a user gesture. */
export function raceAudio(button:HTMLButtonElement,level:HTMLInputElement,connection:Connection){
 let context:AudioContext|undefined,output:GainNode|undefined,engine:OscillatorNode|undefined,
     engineGain:GainNode|undefined,engineFilter:BiquadFilterNode|undefined,noise:AudioBuffer|undefined;
 let opening:AudioContext|undefined;
 let release:(()=>void)|undefined,active=false,pending=false,disposed=false,gear=0,service=-1,lastFx=0,lastDistance=NaN;
 let radio:{utterance:SpeechSynthesisUtterance;end:()=>void}|undefined;
 const heard:Record<Team,number>={a:-1,b:-1};
 const read=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};
 const save=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{/* Embedded view without storage. */}};
 let volume=Number(read('jev-volume')??.42);
 if(!Number.isFinite(volume))volume=.42;volume=Math.min(1,Math.max(0,volume));level.value=String(volume);
 const label=()=>{button.textContent=active?'Mute sound':read('jev-muted')==='0'?'Resume sound':'Enable sound';button.setAttribute('aria-pressed',String(active));};
 function quiet(){if(context&&engineGain)engineGain.gain.setTargetAtTime(0,context.currentTime,.025);gear=0;service=-1;lastDistance=NaN;}
 function stopRadio(){
  if(!radio)return;
  const {end}=radio;
  radio=undefined;
  speechSynthesis.cancel();
  end();
 }
 function stop(){if(opening){void opening.close().catch(()=>{});opening=undefined;}if(active)connection.releaseAudio();active=false;stopRadio();release?.();release=undefined;quiet();if(context){void context.close().catch(()=>{});context=undefined;}engine=undefined;output=engineGain=undefined;engineFilter=undefined;noise=undefined;label();}
 function speakRadio(line:string,speech:RadioSpeech){
  if(!active||volume===0||document.hidden||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;
  const voice=speechSynthesis.getVoices().find(v=>v.localService&&v.lang.startsWith('en'));
  if(!voice)return;
  stopRadio();
  const utterance=new SpeechSynthesisUtterance(line);
  utterance.voice=voice;utterance.volume=volume;utterance.rate=1.14;
  const current=radio={utterance,end:speech.end};
  const finish=()=>{if(radio===current){radio=undefined;speech.end();}};
  utterance.onstart=()=>{if(radio===current)speech.start();};
  utterance.onboundary=event=>{if(radio===current&&event.name==='word')speech.word(event.charIndex);};
  utterance.onend=finish;utterance.onerror=finish;
  try{speechSynthesis.speak(utterance);}catch{radio=undefined;return;}
  return ()=>{if(radio===current){radio=undefined;speechSynthesis.cancel();}};
 }
 button.onclick=async()=>{
  if(active){save('jev-muted','1');stop();return;}if(pending)return;
  if(!navigator.locks){button.textContent='Audio unavailable';return;}
  pending=true;
  window.speechSynthesis?.getVoices();
  const a=opening=new AudioContext();const resumed=a.resume().catch(()=>{}); // inside trusted click
  try{await navigator.locks.request('jev-broadcast-audio',{ifAvailable:true},async lock=>{
   if(!lock||disposed){if(a.state!=='closed')await a.close();if(!disposed)button.textContent='Sound in another tab';return;}
   if(!await connection.claimAudio()){if(a.state!=='closed')await a.close();if(!disposed)button.textContent='Sound in another window';return;}
   await resumed;
   if(disposed||opening!==a){connection.releaseAudio();if(a.state!=='closed')await a.close();return;}
   opening=undefined;context=a;output=a.createGain();output.gain.value=volume*.52;output.connect(a.destination);
   engine=a.createOscillator();engine.type='sawtooth';engineFilter=a.createBiquadFilter();engineFilter.type='lowpass';
   engineGain=a.createGain();engineGain.gain.value=0;engine.connect(engineFilter).connect(engineGain).connect(output);engine.start();
   noise=a.createBuffer(1,a.sampleRate*.32,a.sampleRate);const data=noise.getChannelData(0);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
   active=true;save('jev-muted','0');label();await new Promise<void>(resolve=>{release=resolve;});
  });}finally{if(opening===a){opening=undefined;if(a.state!=='closed')void a.close().catch(()=>{});}pending=false;}
 };
 level.oninput=()=>{volume=Number(level.value);save('jev-volume',String(volume));if(context&&output)output.gain.setTargetAtTime(volume*.52,context.currentTime,.025);};
 function cue(hz:number,end:number,duration:number,loudness:number,rough:boolean,delay=0,pan=0){
  const a=context!,now=a.currentTime+delay,g=a.createGain(),filter=a.createBiquadFilter();filter.type='bandpass';filter.Q.value=rough?.95:2.1;
  filter.frequency.setValueAtTime(hz,now);filter.frequency.exponentialRampToValueAtTime(end,now+duration);
  const src=rough?a.createBufferSource():a.createOscillator();
  if(src instanceof AudioBufferSourceNode){src.buffer=noise!;src.loop=true;}else{src.type='sawtooth';src.frequency.setValueAtTime(hz,now);src.frequency.exponentialRampToValueAtTime(end,now+duration);}
  g.gain.setValueAtTime(.001,now);g.gain.exponentialRampToValueAtTime(loudness,now+.012);g.gain.exponentialRampToValueAtTime(.001,now+duration);
  const stereo=a.createStereoPanner();stereo.pan.value=pan;src.connect(filter).connect(g).connect(stereo).connect(output!);src.start(now);src.stop(now+duration+.012);
  src.onended=()=>{src.disconnect();filter.disconnect();g.disconnect();stereo.disconnect();};
 }
 function update(r:Race,team:Team,connected:boolean){
  if(!context||!active)return;
  if(!connected||document.hidden||r.phase!=='racing'){quiet();return;}
  const car=r.cars[team],t=context.currentTime,load=Math.max(.08,car.throttle);
  engine!.frequency.setTargetAtTime(Math.max(45,car.rpm/60*1.5),t,.027);
  engineFilter!.frequency.setTargetAtTime(410+load*1700,t,.05);
  engineGain!.gain.setTargetAtTime(car.pit==='stopped'?.014:gear&&car.gear!==gear?.02:.055+.075*load,t,.025);
  gear=car.gear;
  // An impact takes the transient slot over kerb chatter and passing engines.
  const phase=car.pit==='stopped'?(car.pitTime<.38?0:car.pitTime<1.57?1:car.pitTime<2.15?2:3):-1;
  const impact=car.lastImpact?.time??-1,age=r.time-impact;
  if(impact>=0&&impact!==heard[team]&&age>=0&&age<.17&&gear){
   cue(820,82,.20,.47,true);lastFx=t;
  }else if(phase>=0&&phase!==service){if(phase===1||phase===2){for(let corner=0;corner<4;corner++)cue(1900+corner*80,770,.12,.16,true,corner*.039,corner%2?.68:-.68);}else cue(570,160,.105,.29,true);lastFx=t;}
  else if(phase<0&&car.speed>15&&t-lastFx>.38){
   const track=getTrack(r.circuit);
   if(kerbHeight(track,car.distance,car.offset+.81)+kerbHeight(track,car.distance,car.offset-.81)>.019||Math.abs(car.lateralG)>3.9){
    cue(1300,740,.13,.085,true);lastFx=t;
   }else{
    let nearest=Math.abs(r.cars[team==='a'?'b':'a'].distance-car.distance);
    for(const other of r.field)nearest=Math.min(nearest,Math.abs(other.distance-car.distance));
    if(nearest<5&&lastDistance>=5){cue(405,153,.48,.14,false);lastFx=t;}lastDistance=nearest;
   }
  }
  heard[team]=impact;service=phase;
 }
 connection.onAudioLost=stop;
 const visibility=()=>{if(document.hidden||document.documentElement.dataset.mcpHidden==='true'){quiet();stopRadio();}};
 document.addEventListener('visibilitychange',visibility);document.addEventListener('mcp-visibility',visibility);
 label();return {update,speakRadio,dispose(){disposed=true;document.removeEventListener('visibilitychange',visibility);document.removeEventListener('mcp-visibility',visibility);button.onclick=level.oninput=null;connection.onAudioLost=undefined;stop();}};
}
