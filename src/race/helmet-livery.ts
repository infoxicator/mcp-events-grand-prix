import * as T from 'three';
import type {Team} from './types';

export function helmetLivery(team:Team){
 const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;
 const ctx=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;
 const base=team==='a'?'#d9a845':'#cbd4d8',accent=team==='a'?'#95232e':'#007d7d';
 ctx.fillStyle=base;ctx.fillRect(0,0,w,h);
 function ribbon(level:number,width:number,colour:string){
  ctx.beginPath();
  for(let x=0;x<=w;x+=4){
   const a=2*Math.PI*x/w,y=h*(level+.12*Math.cos(2*a)-.06*Math.cos(a));
   if(x)ctx.lineTo(x,y);else ctx.moveTo(x,y);
  }
  ctx.strokeStyle=colour;ctx.lineWidth=h*width;ctx.stroke();
 }
 ribbon(.10,.105,'#344051');ribbon(.105,.059,accent);ribbon(.15,.011,'#ebe7d7');
 ribbon(.30,.145,'#222a39');ribbon(.30,.095,accent);ribbon(.24,.012,'#f2eee3');
 ribbon(.72,.078,'#273041');ribbon(.69,.018,'#efebe0');ribbon(.75,.025,accent);
 ctx.fillStyle='#f9f3e6';ctx.textAlign='center';ctx.font='italic 800 86px Arial';
 for(const x of [.22,.78])ctx.fillText(team==='a'?'44':'63',w*x,h*.57);
 // A separate planar island keeps the number legible over the compound curve.
 const atlas=document.createElement('canvas');atlas.width=atlas.height=w;
 const crown=atlas.getContext('2d')!;
 crown.fillStyle=base;crown.fillRect(0,0,w,h);crown.drawImage(canvas,0,h);
 crown.translate(w/2,h/2);
 for(const s of [-1,1]){
  crown.save();crown.scale(s,1);
  crown.beginPath();crown.moveTo(380,-526);crown.bezierCurveTo(135,-260,225,270,386,528);
  crown.lineWidth=65;crown.strokeStyle='#243041';crown.stroke();
  crown.lineWidth=38;crown.strokeStyle=accent;crown.stroke();crown.restore();
 }
 // The rear T-cam looks along +Z, so image-right points toward local -X.
 crown.scale(-1,1);crown.textAlign='center';crown.textBaseline='middle';crown.font='italic 900 316px Arial';
 crown.lineJoin='round';crown.strokeStyle='#eee8d9';crown.lineWidth=24;
 const number=team==='a'?'44':'63';crown.strokeText(number,0,0);
 crown.fillStyle='#202c39';crown.fillText(number,0,0);
 const tex=new T.CanvasTexture(atlas);tex.flipY=false;tex.wrapS=T.RepeatWrapping;
 tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=import.meta.env.MCP_APP==='true'?4:8;return tex;
}
