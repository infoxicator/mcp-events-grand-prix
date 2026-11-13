// Geometry: bacinger/f1-circuits, MIT © 2019–2025 Tomislav Bacinger.
import geo from '../../data/monza.json';
export const OFFICIAL_LENGTH=5793;
const coordinates=geo.features[0].geometry.coordinates;
const origin=coordinates[0];
export const centreline=coordinates.map(([lon,lat])=>({x:(lon-origin[0])*111320*Math.cos(origin[1]*Math.PI/180),z:-(lat-origin[1])*111320}));
export const cumulative=[0];
for(let i=1;i<centreline.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(centreline[i].x-centreline[i-1].x,centreline[i].z-centreline[i-1].z));
export const LENGTH=cumulative.at(-1)!;
export const wrap=(d:number)=>((d%LENGTH)+LENGTH)%LENGTH;
export function pointAt(distance:number,offset=0){
 const d=wrap(distance);let i=1;while(i<cumulative.length-1&&cumulative[i]<d)i++;
 const a=centreline[i-1],b=centreline[i],t=(d-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);
 const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
 return {x:a.x+(b.x-a.x)*t-dz/len*offset,z:a.z+(b.z-a.z)*t+dx/len*offset};
}
export function tangentAt(d:number){const a=pointAt(d-8),b=pointAt(d+8),len=Math.hypot(b.x-a.x,b.z-a.z);return {x:(b.x-a.x)/len,z:(b.z-a.z)/len};}
export function curvatureAt(d:number){const a=tangentAt(d-16),b=tangentAt(d+16);return Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.z*b.z)))/32;}
export const CORNERS=[{d:640,name:'Rettifilo',speed:24},{d:1250,name:'Curva Grande',speed:78},{d:1860,name:'Roggia',speed:35},{d:2420,name:'Lesmo 1',speed:44},{d:2700,name:'Lesmo 2',speed:46},{d:3780,name:'Ascari',speed:44},{d:5000,name:'Parabolica',speed:49}];
// Metres from GeoJSON start: presentation annotations, not FIA surveyed boundaries.
export const SECTORS=[0,2000,3950,LENGTH];
export const DRS_ZONES=[{detection:2700,start:2850,end:3600},{detection:4900,start:5350,end:600}];
export function inZone(d:number,start:number,end:number){d=wrap(d);return start<end?d>=start&&d<end:d>=start||d<end;}
export const isDrsZone=(d:number)=>DRS_ZONES.some(z=>inZone(d,z.start,z.end));
export function cornerName(d:number){return CORNERS.reduce((a,b)=>Math.abs(wrap(b.d-d+LENGTH/2)-LENGTH/2)<Math.abs(wrap(a.d-d+LENGTH/2)-LENGTH/2)?b:a).name;}
export const PIT_ENTRY=LENGTH-600,PIT_EXIT=240,PIT_STOP=LENGTH-180,PIT_LIMIT=80/3.6,PIT_STOP_SECONDS=2.6;
export function pitOffset(d:number){if(!inZone(d,PIT_ENTRY,PIT_EXIT))return 0;const start=wrap(d-PIT_ENTRY),total=LENGTH-PIT_ENTRY+PIT_EXIT;return -18*Math.min(1,start/90,(total-start)/90);}
