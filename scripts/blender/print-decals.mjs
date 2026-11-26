// Vector master artwork; transparent printed-ink sheets retain their original aspect ratios.
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('./textures/',import.meta.url));
const text=(x,y,size,label,extra='')=>`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="bold" fill="white" ${extra}>${label}</text>`;
// Rectified outlines from the approved wing print. The wing and brow have
// separate measured registrations because their projected panels are tapered.
const outlines=JSON.parse(await readFile(directory+'wing-bank-contours.json','utf8'));
function bank(brow){
 const place=([x,y])=>{
  const u=(x-17)/300,v=(y-5)/72;
  const px=brow?96+350*u:41+429*u;
  const top=brow?13+8*u:32-16*u,bottom=brow?61+10*u:114-6*u;
  return [px,top+v*(bottom-top)];
 };
 return outlines.map((contours,i)=>{
  const d=contours.map(points=>{
   const p=points.map(place);
   const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2].map(n=>n.toFixed(2)).join(' ');
   let curve='M'+midpoint(p.at(-1),p[0]);
   p.forEach((a,k)=>{curve+='Q'+a.map(n=>n.toFixed(2)).join(' ')+' '+midpoint(a,p[(k+1)%p.length]);});
   return curve+'Z';
  }).join(' ');
  return `<path fill="${['#f3f1e9','#111214','#ba1530'][i]}" fill-rule="evenodd" d="${d}"/>`;
 }).join('');
}
const shell='<path d="M6 24Q3 11 13 6Q24 -2 35 7Q42 13 40 24L30 29L17 29Z" fill="#ffc32c" stroke="#d41d29" stroke-width="3"/><path d="M22 25L12 10M23 25L19 6M24 25V5M25 25L30 7M26 25L36 11" stroke="#e53b24" fill="none"/>';
const ink={
 'front-bank-ink':[520,144,bank(false)],'steering-bank-ink':[500,120,bank(true)],
 'front-foil-ink':[103,104,`<g transform="translate(4,88) rotate(-40)">${text(0,0,25,'Ray-Ban','font-style="italic"')}</g>`],
 'front-flap-print':[128,64,`<circle cx="32" cy="32" r="19" fill="#168fc3"/>${text(20,39,19,'hp','font-style="italic"')}${text(96,37,14,'V-Power','text-anchor="middle" font-style="italic"')}`],
 'nose-side-badge':[43,24,`<g transform="scale(.92,.76)">${shell}</g>`],
 'rear-fence-ink':[320,164,`<g transform="translate(7,5) scale(1.35)">${shell}</g>${text(68,48,43,'V-Power','font-style="italic"')}${text(70,105,39,'PERONI')}${text(100,140,25,'0.0%')}`],
 'nose-print':[256,672,`<g text-anchor="middle" stroke="#641222" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${[['IBM',72,69],['BingX',168,64],['YAHOO!',264,57],['PIRELLI',360,55],['brembo',456,53],['Ray-Ban',552,52]].map(([n,y,k])=>text(128,y,k,n,'font-style="italic"')).join('')}<path d="M98 583h60v43l-30 26-30-26z" fill="#edbd35" stroke="white" stroke-width="4"/>${text(128,622,25,'SF','style="fill:#151519"')}</g>`]
};
for(const [name,[w,h,content]] of Object.entries(ink)){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${content}</svg>`;
 await sharp(Buffer.from(svg),{density:216}).png().toFile(directory+name+'.png');
}
