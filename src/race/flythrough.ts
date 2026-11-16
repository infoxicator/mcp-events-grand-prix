import {createScene} from './scene';
import {getTrack,isCircuit} from './track';
const requested=new URLSearchParams(location.search).get('circuit'),track=getTrack(isCircuit(requested)?requested:'monza');
document.body.innerHTML=`<div id="tour" style="position:fixed;inset:0"></div><div style="position:fixed;top:40px;left:40px;color:white;font:italic 700 54px sans-serif;text-shadow:0 2px 20px black">JEV GRAND PRIX<br><small style="font:16px sans-serif">${track.name.toUpperCase()} · ${(track.OFFICIAL_LENGTH/1000).toFixed(3)} KM · ${track.night?'NIGHT':'CIRCUIT'} TOUR</small></div>`;
const scene=createScene(document.querySelector('#tour')!,track);scene.setMode('flythrough');function frame(t:number){scene.render({cars:{a:{distance:t*.05,offset:0,speed:60},b:{distance:t*.05-20,offset:2,speed:60}},time:t/1000,phase:'tour'},t);requestAnimationFrame(frame);}requestAnimationFrame(frame);
