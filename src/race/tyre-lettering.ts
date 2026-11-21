import * as T from 'three';

// A circular sidewall print rotates in wheel space. Progressive exposure
// averaging keeps the characters legible at a stop and softens them at speed.
export function sidewallInk(opaque=false){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=384;
 const c=canvas.getContext('2d')!;
 if(opaque){c.fillStyle='#272628';c.fillRect(0,0,384,384);}
 c.translate(192,192);
 function arc(text:string,angle:number,size:number,ink:string){
  c.font='italic 900 '+size+'px Arial';c.fillStyle=ink;c.textAlign='center';
  const widths=[...text].map(ch=>c.measureText(ch).width+1),radius=148;
  let a=angle-widths.reduce((sum,w)=>sum+w,0)/(2*radius);
  for(const [i,ch] of [...text].entries()){
   c.save();c.rotate(a+widths[i]/(2*radius));c.fillText(ch,0,-radius+size*.35);c.restore();a+=widths[i]/radius;
  }
 }
 arc('P ZERO',0,22,'#e7e2d9');arc('PIRELLI',Math.PI,20,'#dbd8d2');
 arc('FORMULA 1',1.59,8,'#989692');arc('RADIAL',4.68,8,'#989692');
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=8;return map;
}
