import {getTrack} from '../src/race/track';
import {writeFileSync} from 'node:fs';
import monza from '../data/monza.json';import vegas from '../data/las-vegas.json';
for(const id of ['monza','las-vegas'] as const){const t=getTrack(id),origin=(id==='monza'?monza:vegas).features[0].geometry.coordinates[0];writeFileSync(`data/${id}-render-path.json`,JSON.stringify({id,length:t.LENGTH,origin,corners:t.CORNERS,sectors:t.SECTORS,pitEntry:t.PIT_ENTRY,pitExit:t.PIT_EXIT,pitWallStart:t.PIT_WALL_START,pitOpenings:t.pitOpenings,samples:Array.from({length:Math.ceil(t.LENGTH/2)+1},(_,i)=>{const d=Math.min(i*2,t.LENGTH),p=t.pointAt(d),v=t.tangentAt(d);return {d,...p,...{tx:v.x,tz:v.z},width:t.trackHalfWidth(d),line:t.racingLineOffset(d),pit:t.pitOffset(d)};})}));}
