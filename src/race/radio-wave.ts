// The World Feed repeats a 51-frame, 25 fps meter while the radio channel is open.
// These heights sample its unoccluded centre. The game draws the teeth procedurally.
// Median heights for eleven 6 px bands in the unobstructed 66 px lane.
// Arrays are consecutive 40 ms frames from the quiet point of the cycle.
const profiles=[
 [2,2,4,5,5,6,7,6,6,6,6],
 [2,2,4,5,5,6,7,6,6,6,6],
 [6,6,7,7,7,8,9,8,8,8,8],
 [6,8,12,12,12,10,10,10,10,8,8],
 [4,6,14,16,16,14,14,14,6,6,6],
 [4,6,10,10,11,14,14,14,4,2,1],
 [6,6,6,6,6,8,8,8,8,8,8],
 [6,6,6,6,6,6,6,6,8,9,9],
 [6,6,6,6,6,6,6,6,8,9,9],
 [4,6,6,6,6,6,6,6,6,7,6],
 [4,5,7,8,8,6,6,6,6,6,6],
 [6,6,8,8,8,10,10,10,10,8,8],
 [10,10,6,6,6,18,18,18,14,14,14],
 [8,8,6,6,6,20,20,20,16,16,16],
 [6,8,10,10,10,21,20,20,18,18,18],
 [8,8,14,14,14,24,25,24,14,14,14],
 [8,8,18,19,20,29,29,28,14,12,12],
 [10,10,20,20,20,27,26,26,14,14,14],
 [10,10,20,20,20,27,26,26,14,14,14],
 [12,12,19,19,20,27,27,26,14,14,14],
 [14,14,18,18,18,27,28,26,14,14,14],
 [18,18,19,20,20,28,28,26,15,15,14],
 [20,20,24,25,26,27,28,26,16,16,16],
 [20,20,27,27,26,26,27,26,22,21,22],
 [18,20,26,27,26,26,26,26,23,24,24],
 [18,18,26,26,26,27,26,26,22,22,22],
 [14,14,24,24,25,27,26,26,18,18,18],
 [10,10,22,22,23,27,27,26,15,14,14],
 [12,12,20,22,22,27,27,26,17,16,16],
 [14,14,22,22,22,27,27,26,17,16,17],
 [16,18,24,24,24,27,27,26,18,18,18],
 [18,18,24,24,24,26,24,24,18,18,18],
 [18,19,20,20,20,22,22,22,20,20,20],
 [20,20,18,18,18,24,24,24,20,20,20],
 [20,20,14,14,15,26,26,26,20,18,18],
 [19,18,12,12,12,24,24,24,20,20,20],
 [18,18,11,12,12,23,22,23,21,20,20],
 [14,14,10,12,12,22,22,22,20,20,20],
 [12,12,10,11,12,20,20,20,18,18,18],
 [14,14,10,10,10,19,18,18,16,14,14],
 [16,15,9,10,10,14,14,14,12,12,12],
 [14,13,8,8,8,22,23,23,10,8,8],
 [6,6,6,6,6,24,24,24,10,8,8],
 [9,8,6,6,6,18,19,19,10,8,8],
 [12,12,10,10,11,17,16,16,7,6,6],
 [18,16,12,12,12,18,18,18,5,5,5],
 [16,16,16,17,18,19,18,18,4,4,4],
 [14,15,18,19,19,19,18,18,4,4,4],
 [8,10,13,13,14,16,16,16,6,6,6],
 [4,6,10,10,10,13,13,13,6,6,6],
 [4,6,7,7,8,8,9,9,6,6,6],
];
const frameMs=40;
const firstPhaseMs=400;
const carrierRiseMs=120;
const idle=2;
const barCount=96;

export function radioWaveSample(elapsedMs:number){
 const frame=Math.floor((Math.max(0,elapsedMs)+firstPhaseMs)/frameMs)%profiles.length;
 const signal=Math.min(1,Math.max(0,(elapsedMs-carrierRiseMs)/carrierRiseMs))**2;
 return {profile:profiles[frame],signal};
}

export function createRadioWave(canvas:HTMLCanvasElement,reducedMotion:boolean){
 const context=canvas.getContext('2d')!;
 context.fillStyle=getComputedStyle(canvas).color;
 const pitch=canvas.width/barCount;
 let timer:number|undefined;
 let origin:number|undefined;
 let speaking=false;

 function draw(elapsed:number){
  const {profile,signal}=radioWaveSample(reducedMotion?0:elapsed);
  context.clearRect(0,0,canvas.width,canvas.height);
  context.globalAlpha=speaking&&!reducedMotion?1:.94;
  context.beginPath();
  for(let index=0;index<barCount;index++){
   // At 720p the clean sample starts 61 px into the 165 px card. Fill the
   // regions under the number and crest from the closest measured band.
   const position=(index+.5)*165/barCount;
   const band=Math.floor((position-61)/6);
   const height=profile[Math.min(profile.length-1,Math.max(0,band))];
   const rim=position<61?(position<22?.45:.83):position>139?.5:1;
   const tooth=index%3===0?.94:1;
   // Allow for the last partially covered pixel painted at the band edge.
   const pixels=2*(idle+Math.max(0,height-idle-1)*signal*rim*tooth);
   context.rect(index*pitch,canvas.height-pixels,pitch*.86,pixels);
  }
  context.fill();
 }
 function tick(){
  if(origin===undefined)return;
  const elapsed=performance.now()-origin;
  draw(elapsed);
  timer=window.setTimeout(tick,frameMs-elapsed%frameMs);
 }
 function open(){
  if(origin!==undefined||reducedMotion)return;
  origin=performance.now();
  tick();
 }
 function close(){
  clearTimeout(timer);
  origin=undefined;
  speaking=false;
  draw(0);
 }
 draw(0);
 return {open,close,speech(active:boolean){speaking=active;}};
}
