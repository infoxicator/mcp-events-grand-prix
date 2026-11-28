// Geometry: bacinger/f1-circuits, MIT © 2019–2025 Tomislav Bacinger.
import monzaGeo from '../../data/monza.json' with {type:'json'};
import vegasGeo from '../../data/las-vegas.json' with {type:'json'};
export type CircuitId='monza'|'las-vegas';
export const isCircuit=(v:unknown):v is CircuitId=>v==='monza'||v==='las-vegas';
export const CIRCUITS={monza:{name:'Monza',grandPrix:'ITALIAN GRAND PRIX',country:'ITALY',corners:11,night:false,temperature:28,coordinates:'45.6189° N / 9.2812° E'},'las-vegas':{name:'Las Vegas',grandPrix:'LAS VEGAS GRAND PRIX',country:'NEVADA / USA',corners:17,night:true,temperature:18,coordinates:'36.1099° N / 115.1612° W'}} as const;
function buildTrack(id:CircuitId){
const geo=id==='monza'?monzaGeo:vegasGeo;
const OFFICIAL_LENGTH=id==='monza'?5793:6201;
const coordinates=geo.features[0].geometry.coordinates;
const origin=coordinates[0];
const centreline=coordinates.map(([lon,lat])=>({x:(lon-origin[0])*111320*Math.cos(origin[1]*Math.PI/180),z:-(lat-origin[1])*111320}));
const cumulative=[0];
for(let i=1;i<centreline.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(centreline[i].x-centreline[i-1].x,centreline[i].z-centreline[i-1].z));
const LENGTH=cumulative.at(-1)!;
// GeoJSON begins partway up the straight. Align the control line to the FIA map
// (approximately 310m before that vertex); layout/length are never scaled.
const START_OFFSET=id==='monza'?LENGTH-310:0;
const project=(lon:number,lat:number)=>({x:(lon-origin[0])*111320*Math.cos(origin[1]*Math.PI/180),z:-(lat-origin[1])*111320});
const wrap=(d:number)=>((d%LENGTH)+LENGTH)%LENGTH;
// C1 Hermite interpolation removes the polygonal yaw snaps in the source geometry.
// Stations remain the unscaled surveyed polyline distances; interpolation stays local.
const count=centreline.length-1;
const direction=centreline.slice(0,count).map((p,i)=>{const a=centreline[(i-1+count)%count],b=centreline[(i+1)%count],la=Math.hypot(p.x-a.x,p.z-a.z),lb=Math.hypot(b.x-p.x,b.z-p.z);const x=(p.x-a.x)/la+(b.x-p.x)/lb,z=(p.z-a.z)/la+(b.z-p.z)/lb,l=Math.hypot(x,z);return {x:x/l,z:z/l};});
function sourceSample(distance:number){
 const d=wrap(wrap(distance)+START_OFFSET);let lo=0,hi=count;while(lo+1<hi){const mid=(lo+hi)>>1;if(cumulative[mid]<=d)lo=mid;else hi=mid;}
 const a=centreline[lo],b=centreline[lo+1],length=cumulative[lo+1]-cumulative[lo],u=(d-cumulative[lo])/length,v=direction[lo],w=direction[(lo+1)%count];
 const h00=2*u**3-3*u*u+1,h10=u**3-2*u*u+u,h01=-2*u**3+3*u*u,h11=u**3-u*u;
 const dx=(6*u*u-6*u)*(a.x-b.x)/length+(3*u*u-4*u+1)*v.x+(3*u*u-2*u)*w.x;
 const dz=(6*u*u-6*u)*(a.z-b.z)/length+(3*u*u-4*u+1)*v.z+(3*u*u-2*u)*w.z,l=Math.hypot(dx,dz);
 return {x:h00*a.x+h10*length*v.x+h01*b.x+h11*length*w.x,z:h00*a.z+h10*length*v.z+h01*b.z+h11*length*w.z,tx:dx/l,tz:dz/l};
}
// Smooth digitisation noise over 8m, then resample at 2m with Catmull interpolation.
// This stays within the tarmac while removing sub-car-length curvature spikes.
const smoothCount=Math.ceil(LENGTH/2),smoothStep=LENGTH/smoothCount;
const rawPath=Array.from({length:smoothCount},(_,i)=>sourceSample(i*smoothStep));
const smoothing=Array.from({length:21},(_,i)=>Math.exp(-.5*((i-10)*smoothStep/8)**2));
const smoothPath=rawPath.map((_,i)=>{let x=0,z=0,total=0;for(let j=-10;j<=10;j++){const w=smoothing[j+10],p=rawPath[(i+j+smoothCount)%smoothCount];x+=p.x*w;z+=p.z*w;total+=w;}return {x:x/total,z:z/total};});
function sample(distance:number,out={x:0,z:0,tx:0,tz:0}){const u=wrap(distance)/smoothStep,i=Math.floor(u),t=u-i;
 const a=smoothPath[(i-1+smoothCount)%smoothCount],b=smoothPath[i],c=smoothPath[(i+1)%smoothCount],d=smoothPath[(i+2)%smoothCount];
 const interp=(a:number,b:number,c:number,d:number)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
 const derivative=(a:number,b:number,c:number,d:number)=>.5*((-a+c)+2*(2*a-5*b+4*c-d)*t+3*(-a+3*b-3*c+d)*t*t);
 const dx=derivative(a.x,b.x,c.x,d.x),dz=derivative(a.z,b.z,c.z,d.z),l=Math.hypot(dx,dz);
 out.x=interp(a.x,b.x,c.x,d.x);out.z=interp(a.z,b.z,c.z,d.z);out.tx=dx/l;out.tz=dz/l;return out;
}
// Rendering often requests a position followed immediately by its track tangent.
const sampled={x:0,z:0,tx:0,tz:0};let lastStation=NaN;
function trackFrame(d:number){
 if(d!==lastStation){sample(d,sampled);lastStation=d;}
 return sampled;
}
function pointAt(distance:number,offset=0,out={x:0,z:0}){
 const p=trackFrame(distance);out.x=p.x-p.tz*offset;out.z=p.z+p.tx*offset;return out;
}
function tangentAt(distance:number,out={x:0,z:0}){
 const p=trackFrame(distance);out.x=p.tx;out.z=p.tz;return out;
}
function signedCurvatureAt(d:number){
 const a=trackFrame(d-6),x=a.tx,z=a.tz,b=trackFrame(d+6);
 return Math.atan2(x*b.tz-z*b.tx,x*b.tx+z*b.tz)/12;
}
function curvatureAt(d:number){return Math.abs(signedCurvatureAt(d));}
function trackHalfWidth(d:number){const straight=Math.min(wrap(d),LENGTH-wrap(d));return 6+1.5*Math.max(0,1-straight/450);}
// Bounded minimum-curvature line, relaxed in the local track normal. Agents choose
// an offset from this path; the controller still has room to race side by side.
const lineCount=Math.ceil(LENGTH/3),lineStep=LENGTH/lineCount,lineOffsets=new Float64Array(lineCount);
const lineBase=Array.from({length:lineCount},(_,i)=>sample(i*lineStep));
// Projected gradient of squared second differences (curvature), at several
// spatial scales. Minimising path length instead would hug the inside and
// tighten each apex, the opposite of a useful racing line.
const curvatureWeights=[1,-4,6,-4,1];
// The centreline and its normals remain fixed through all 250 relaxation passes.
const neighbours=new Uint32Array(lineCount*5),coupling=new Float64Array(lineCount*5),baseForce=new Float64Array(lineCount);
for(const stride of [8,4,2,1]){
 for(let i=0;i<lineCount;i++){
  const p=lineBase[i];let gx=0,gz=0;
  for(let k=0;k<5;k++){
   const j=(i+(k-2)*stride+lineCount)%lineCount,q=lineBase[j],weight=curvatureWeights[k];
   neighbours[5*i+k]=j;coupling[5*i+k]=weight*(p.tx*q.tx+p.tz*q.tz);
   gx+=weight*q.x;gz+=weight*q.z;
  }
  baseForce[i]=-p.tz*gx+p.tx*gz;
 }
 for(let pass=0;pass<250;pass++)for(let i=0;i<lineCount;i++){
  let force=baseForce[i];
  for(let k=5*i;k<5*i+5;k++)force+=coupling[k]*lineOffsets[neighbours[k]];
  lineOffsets[i]=Math.max(-3.8,Math.min(3.8,lineOffsets[i]-.06*force));
 }
}
// Fair the constrained path to avoid steering discontinuities at the lateral bounds.
const fairOffsets=new Float64Array(lineCount);for(let i=0;i<lineCount;i++){let sum=0,weight=0;for(let j=-8;j<=8;j++){const w=Math.exp(-.5*(j/3)**2);sum+=lineOffsets[(i+j+lineCount)%lineCount]*w;weight+=w;}fairOffsets[i]=sum/weight;}lineOffsets.set(fairOffsets);
function racingLineOffset(d:number){const u=wrap(d)/lineStep,i=Math.floor(u),t=u-i;return lineOffsets[i]*(1-t)+lineOffsets[(i+1)%lineCount]*t;}
function racingCurvature(d:number){const a=pointAt(d-6,racingLineOffset(d-6)),b=pointAt(d,racingLineOffset(d)),c=pointAt(d+6,racingLineOffset(d+6));const ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),ac=Math.hypot(c.x-a.x,c.z-a.z);return 2*((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/Math.max(.01,ab*bc*ac);}
// Corner/sector positions digitized against the 2025 FIA Monza map.
// FIA offsets: S1 233m before T4; S2 215m before T8; DRS1 -95/+170m at T7;
// DRS2 detection 20m after T11 exit, activation 12m after the control line.
const station=(raw:number)=>wrap(raw-START_OFFSET);
const CORNERS=id==='las-vegas'?[[134,'T1 / Grand Prix Plaza',23],[246,'T2',38],[391,'T3',37],[551,'T4 / Koval Lane',60],[1426,'T5 / Sphere entry',27],[1781,'T6 / Sphere',40],[1908,'T7',29],[1978,'T8 / Sphere chicane',29],[2097,'T9 / Sands Avenue',32],[2584,'T10',62],[2925,'T11 / Venetian',70],[3086,'T12 / The Strip',29],[3897,'T13 / Las Vegas Boulevard',85],[5052,'T14 / Heavy braking',25],[5093,'T15',30],[5204,'T16 / Harmon Avenue',43],[5990,'T17 / Final turn',65]].map(([d,name,speed])=>({d:Number(d),name:String(name),speed:Number(speed)})):[{d:station(640),name:'Rettifilo',speed:24},{d:station(1200),name:'Curva Grande',speed:78},{d:station(1860),name:'Roggia',speed:35},{d:station(2246),name:'Lesmo 1',speed:58.6},{d:station(2577),name:'Lesmo 2',speed:50.8},{d:station(3730),name:'Ascari',speed:57.2},{d:station(4969),name:'Parabolica',speed:65}];
const SECTORS=id==='las-vegas'?[0,1426+90,3086+140,LENGTH]:[0,station(1837-233),station(3646-215),LENGTH];
const SPEED_TRAP=id==='las-vegas'?5052-140:station(619-212);
const DRS_ZONES=id==='las-vegas'?[{detection:246+10,start:551+20,end:1426-60},{detection:3086+710,start:5052-870,end:5052-60}]:[{detection:station(2577-95),start:station(2598+170),end:station(3636-60)},{detection:station(5256+20),start:12,end:station(619-60)}];
function inZone(d:number,start:number,end:number){d=wrap(d);return start<end?d>=start&&d<end:d>=start||d<end;}
const isDrsZone=(d:number)=>DRS_ZONES.some(z=>inZone(d,z.start,z.end));
function cornerName(d:number){return CORNERS.reduce((a,b)=>Math.abs(wrap(b.d-d+LENGTH/2)-LENGTH/2)<Math.abs(wrap(a.d-d+LENGTH/2)-LENGTH/2)?b:a).name;}
const PIT_ENTRY=LENGTH-420,PIT_EXIT=id==='las-vegas'?480:300,PIT_STOP=LENGTH-180,PIT_LIMIT=80/3.6,PIT_STOP_SECONDS=2.6;
const PIT_WALL_START=PIT_ENTRY+108;
const pitOpenings=[[PIT_EXIT-90,PIT_EXIT-12],[PIT_ENTRY+12,PIT_ENTRY+90]] as const;
function pitOffset(d:number){if(!inZone(d,PIT_ENTRY,PIT_EXIT))return 0;const start=wrap(d-PIT_ENTRY),total=LENGTH-PIT_ENTRY+PIT_EXIT;const u=Math.min(1,start/90,(total-start)/90);return -18*u*u*(3-2*u);}

return {id,...CIRCUITS[id],OFFICIAL_LENGTH,LENGTH,centreline,cumulative,START_OFFSET,project,wrap,pointAt,tangentAt,signedCurvatureAt,curvatureAt,trackHalfWidth,racingLineOffset,racingCurvature,CORNERS,SECTORS,SPEED_TRAP,DRS_ZONES,inZone,isDrsZone,cornerName,PIT_ENTRY,PIT_EXIT,PIT_STOP,PIT_LIMIT,PIT_STOP_SECONDS,PIT_WALL_START,pitOpenings,pitOffset};
}
export type Track=ReturnType<typeof buildTrack>;
const cache=new Map<CircuitId,Track>();
export function getTrack(id:CircuitId='monza'):Track {let track=cache.get(id);if(!track){track=buildTrack(id);cache.set(id,track);}return track;}
