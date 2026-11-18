import profiles from '../../data/pavement.json';
import type {Track} from './track';

/** Metres above the smoothed DEM. The first two bands and the patch crowns
 * are authored in the road mesh. The shortest band is tyre-scale corrugation. */
export function pavementHeight(track:Track,station:number,offset:number){
 const {waves,amplitudes,patches}=profiles[track.id];
 const d=track.wrap(station),a=d*2*Math.PI/track.LENGTH;
 let h=amplitudes[0]*Math.sin(a*waves[0])+
  amplitudes[1]*Math.sin(a*waves[1]+.6)+offset*.00011*Math.sin(a*waves[0]+.9)+
  amplitudes[2]*Math.sin(a*waves[2]+offset*.31);
 for(const [start,end,left,right,rise] of patches){
  if(d<start||d>end||offset<left||offset>right)continue;
  const edge=Math.min(d-start,end-d,offset-left,right-offset);
  const t=Math.min(1,edge/.40);
  h+=.0015+rise*t*t*(3-2*t)+.0022*Math.exp(-((edge-.09)**2)/.0025);
 }
 return h;
}
