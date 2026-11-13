// Geometry: bacinger/f1-circuits, MIT © 2019–2025 Tomislav Bacinger.
import geo from '../../data/monza.json';
export const OFFICIAL_LENGTH=5793;
const coordinates=geo.features[0].geometry.coordinates;
const origin=coordinates[0];
export const centreline=coordinates.map(([lon,lat])=>({x:(lon-origin[0])*111320*Math.cos(origin[1]*Math.PI/180),z:-(lat-origin[1])*111320}));
export const cumulative=[0];
for(let i=1;i<centreline.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(centreline[i].x-centreline[i-1].x,centreline[i].z-centreline[i-1].z));
export const LENGTH=cumulative.at(-1)!;
// GeoJSON begins partway up the straight. Align the control line to the FIA map
// (approximately 310m before that vertex); layout/length are never scaled.
export const START_OFFSET=LENGTH-310;
export const wrap=(d:number)=>((d%LENGTH)+LENGTH)%LENGTH;
export function pointAt(distance:number,offset=0){
 const d=wrap(wrap(distance)+START_OFFSET);let i=1;while(i<cumulative.length-1&&cumulative[i]<d)i++;
 const a=centreline[i-1],b=centreline[i],t=(d-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);
 const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
 return {x:a.x+(b.x-a.x)*t-dz/len*offset,z:a.z+(b.z-a.z)*t+dx/len*offset};
}
export function tangentAt(d:number){const a=pointAt(d-8),b=pointAt(d+8),len=Math.hypot(b.x-a.x,b.z-a.z);return {x:(b.x-a.x)/len,z:(b.z-a.z)/len};}
export function curvatureAt(d:number){const a=tangentAt(d-16),b=tangentAt(d+16);return Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.z*b.z)))/32;}
// Corner/sector positions digitized against the 2025 FIA Monza map.
// FIA offsets: S1 233m before T4; S2 215m before T8; DRS1 -95/+170m at T7;
// DRS2 detection 20m after T11 exit, activation 12m after the control line.
const station=(raw:number)=>wrap(raw-START_OFFSET);
export const CORNERS=[{d:station(640),name:'Rettifilo',speed:24},{d:station(1200),name:'Curva Grande',speed:78},{d:station(1860),name:'Roggia',speed:35},{d:station(2246),name:'Lesmo 1',speed:44},{d:station(2577),name:'Lesmo 2',speed:46},{d:station(3730),name:'Ascari',speed:44},{d:station(4969),name:'Parabolica',speed:49}];
export const SECTORS=[0,station(1837-233),station(3646-215),LENGTH];
export const SPEED_TRAP=station(619-212);
export const DRS_ZONES=[{detection:station(2577-95),start:station(2598+170),end:station(3636-60)},{detection:station(5256+20),start:12,end:station(619-60)}];
export function inZone(d:number,start:number,end:number){d=wrap(d);return start<end?d>=start&&d<end:d>=start||d<end;}
export const isDrsZone=(d:number)=>DRS_ZONES.some(z=>inZone(d,z.start,z.end));
export function cornerName(d:number){return CORNERS.reduce((a,b)=>Math.abs(wrap(b.d-d+LENGTH/2)-LENGTH/2)<Math.abs(wrap(a.d-d+LENGTH/2)-LENGTH/2)?b:a).name;}
export const PIT_ENTRY=LENGTH-420,PIT_EXIT=300,PIT_STOP=LENGTH-180,PIT_LIMIT=80/3.6,PIT_STOP_SECONDS=2.6;
export function pitOffset(d:number){if(!inZone(d,PIT_ENTRY,PIT_EXIT))return 0;const start=wrap(d-PIT_ENTRY),total=LENGTH-PIT_ENTRY+PIT_EXIT;return -18*Math.min(1,start/90,(total-start)/90);}
