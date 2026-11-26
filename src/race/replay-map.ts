import type {ReplayDriver,ReplayPoint,ReplayTiming} from './replay';
import type {ReplayMotion} from './replay-motion';

export interface ReplayMap {
 draw(time:number,selected:number):void;
 dispose():void;
}

export function replayBounds(track:ReplayPoint[]){
 const bounds={left:Infinity,right:-Infinity,bottom:Infinity,top:-Infinity,base:Infinity};
 for(const [x,y,z] of track){
  bounds.left=Math.min(bounds.left,x);bounds.right=Math.max(bounds.right,x);
  bounds.bottom=Math.min(bounds.bottom,y);bounds.top=Math.max(bounds.top,y);bounds.base=Math.min(bounds.base,z);
 }
 return bounds;
}

export function activeReplayCars(race:ReplayTiming,positions:ReplayMotion,time:number,selected:number){
 const cars:{driver:ReplayDriver;point:ReplayPoint}[]=[];
 for(const driver of race.drivers){
  if(time>driver.end+(driver.out?2000:18_000))continue;
  const point=positions.point(driver.number,time);
  if(point)cars.push({driver,point});
 }
 return cars.sort((a,b)=>Number(a.driver.number===selected)-Number(b.driver.number===selected));
}

export function createReplayMap(canvas:HTMLCanvasElement,race:ReplayTiming,positions:ReplayMotion):ReplayMap{
 const context=canvas.getContext('2d')!;
 const {left,right,bottom,top}=replayBounds(positions.track);
 function draw(time:number,selected:number){
  const {clientWidth:w,clientHeight:h}=canvas;
  if(!w||!h)return;
  const ratio=Math.min(2,devicePixelRatio||1),width=Math.round(w*ratio),height=Math.round(h*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,w,h);
  const margin=Math.min(55,w*.12,h*.14);
  const trackWidth=right-left,trackHeight=top-bottom;
  const rotate=(w>=h)!==(trackWidth>=trackHeight);
  const scale=Math.min((w-margin*2)/(rotate?trackHeight:trackWidth),(h-margin*2)/(rotate?trackWidth:trackHeight));
  const screen=(x:number,y:number):[number,number]=>{
   const dx=(x-(left+right)/2)*scale,dy=(y-(bottom+top)/2)*scale;
   return rotate?[w/2+dy,h/2+dx]:[w/2+dx,h/2-dy];
  };
  context.beginPath();
  for(const [index,[x,y]] of positions.track.entries()){
   const point=screen(x,y);
   if(index===0)context.moveTo(...point);else context.lineTo(...point);
  }
  context.closePath();
  context.lineCap=context.lineJoin='round';
  for(const [color,width] of [['#4b5c62',15],['#292f35',12],['#81969a',1]] as const){
   context.strokeStyle=color;context.lineWidth=width;context.stroke();
  }
  const [startX,startY]=screen(positions.track[0][0],positions.track[0][1]);
  const [nextX,nextY]=screen(positions.track[1][0],positions.track[1][1]);
  context.save();
  context.translate(startX,startY);
  context.rotate(Math.atan2(nextY-startY,nextX-startX));
  context.fillStyle='#f1f7f8';context.fillRect(-2,-7,4,14);
  context.restore();
  for(const {driver,point:[x,y]} of activeReplayCars(race,positions,time,selected)){
   const focus=driver.number===selected,[atX,atY]=screen(x,y);
   context.beginPath();context.arc(atX,atY,focus?7:4.5,0,Math.PI*2);
   context.fillStyle=driver.color;context.fill();
   context.strokeStyle=focus?'#fff':'#131a20';context.lineWidth=focus?2:1;context.stroke();
   context.font=`${focus?'700 12':'600 10'}px system-ui`;
   context.strokeStyle='#11171c';context.lineWidth=3;
   context.strokeText(driver.code,atX+9,atY-5);
   context.fillStyle='#f3fafa';context.fillText(driver.code,atX+9,atY-5);
  }
 }
 return {draw,dispose:()=>context.clearRect(0,0,canvas.width,canvas.height)};
}
