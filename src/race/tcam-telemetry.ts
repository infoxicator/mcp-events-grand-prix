import type {Car, Team} from './types';
import type {GridEntry} from './grid';
import './tcam-telemetry.css';

// Coordinates are in vertical-FOV camera space (10 units = 1 cqh around viewport centre)
// fitted directly to the projected 3D halo silhouette from onboardLens(true).
export function mountTcamTelemetry(viewport:HTMLElement){
 const root=document.createElement('section');
 root.className='tcam-telemetry';
 root.setAttribute('aria-label','T-cam telemetry');
 root.hidden=true;
 const segmentBank=(name:string,x:number)=>`<g transform="translate(${x} 0)" class="pedals ${name}">
  ${Array.from({length:9},(_,i)=>`<rect x="-16" y="${(491-i*8.3).toFixed(1)}" width="32" height="5.6" rx="1.4"/>`).join('')}
  <text class="caption" y="513">${name.toUpperCase()}</text></g>`;
 root.innerHTML=`<svg class="halo-instruments" viewBox="-1000 0 2000 1000" aria-label="Onboard instruments" role="group">
  <defs><linearGradient id="tcam-glass" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#233046" stop-opacity=".86"/><stop offset="1" stop-color="#080d16" stop-opacity=".88"/></linearGradient></defs>
  <path class="glass full-wing-left" d="M-110 414 C-250 418 -362 522 -445 645 Q-454 657 -442 667 L-377 716 Q-366 724 -357 710 C-298 621 -215 516 -92 517 Z"/>
  <path class="glass full-wing-right" d="M200 414 C356 427 492 516 604 619 Q615 629 605 640 L549 701 Q539 711 528 700 C439 608 323 523 186 517 Z"/>
  <path class="glass compact-wing-left" d="M-110 414 C-171 422 -232 441 -283 476 Q-295 484 -287 496 L-245 562 Q-237 574 -225 566 C-188 536 -142 518 -92 517 Z"/>
  <path class="glass compact-wing-right" d="M200 414 C302 425 401 462 483 523 Q495 532 486 544 L438 607 Q429 618 417 609 C354 557 273 522 186 517 Z"/>
  <path class="glass stub-wing-right" d="M200 414 Q240 420 278 429 Q288 431 285 442 L266 520 Q263 530 253 528 Q219 521 186 517 Z"/>
  <g class="wing wing-driver" transform="translate(-342 602) rotate(-48)"><text class="caption" y="-12">ON BOARD</text><text class="wing-value" data-val="driver" y="21"></text></g>
  <g class="wing wing-location" transform="translate(-185 485) rotate(-20)"><text class="caption" y="-11">TRACK POSITION</text><text class="wing-value" data-val="corner" y="20"></text></g>
  <g class="wing wing-aero" transform="translate(284 484) rotate(16)"><text class="caption" y="-11">REAR WING</text><text class="wing-value" y="20" data-val="aero"></text></g>
  <g class="wing wing-gears" transform="translate(465 574) rotate(36)"><text class="caption" y="-22" data-val="rpm"></text>
   <g class="gears">${Array.from({length:8},(_,i)=>`<text x="${((i-3.5)*23).toFixed(1)}" y="11">${i+1}</text>`).join('')}</g>
   <path class="rpm-track" d="M-88 25h176"/><path data-meter="rpm" pathLength="1" d="M-88 25h176"/></g>
  <path class="glass" d="M-110 414 C-40 401 130 401 200 414 L186 517 Q115 556 45 558 Q-25 556 -92 517 Z"/>
  ${segmentBank('brake',-60)}${segmentBank('throttle',151)}
  <ellipse class="glass dial" cx="45" cy="468" rx="80" ry="82"/>
  <path d="M-22 426 Q-2 388 45 388 Q92 388 112 426" fill="none" stroke="var(--constructor)" stroke-width="4.5"/>
  <text class="caption" x="45" y="418">KM/H</text><text class="kph" x="45" y="464" data-val="kph"></text>
  <rect class="ers-box" x="-16" y="473" width="122" height="27" rx="6"/><text class="ers-label" x="45" y="492" data-val="energy"></text>
  <text class="mph" x="45" y="529" data-val="mph"></text><text class="caption" x="45" y="546">MPH</text>
  <g class="flow-badge" visibility="hidden"><rect x="-15" y="560" width="120" height="23" rx="5"/><text x="45" y="576.5" data-val="flow"></text></g>
 </svg>
 <div class="tcam-timing" aria-label="Onboard lap timing">
  <div class="tcam-driver"><b data-val="position"></b><strong data-val="surname"></strong><span data-val="tyre"></span></div>
  <div class="tcam-lap"><small data-val="lap"></small><b data-val="time"></b></div>
  <div class="tcam-best" hidden><small>PERSONAL BEST</small><b data-val="best"></b></div>
  <div class="tcam-sectors"><i>S1</i><i>S2</i><i>S3</i></div>
 </div>`;
 viewport.prepend(root);
 const values=new Map(Array.from(root.querySelectorAll('[data-val]'),node=>[node.getAttribute('data-val'),node]));
 const brakes=root.querySelectorAll('.brake rect'),throttle=root.querySelectorAll('.throttle rect');
 const gears=root.querySelectorAll('.gears text'),sectors=root.querySelectorAll<HTMLElement>('.tcam-sectors i');
 const best=root.querySelector<HTMLElement>('.tcam-best')!;
 const flow=root.querySelector('.flow-badge')!;
 const revs=root.querySelector('[data-meter="rpm"]')!;
 function set(name:string,value:string|number){const node=values.get(name)!;if(node.textContent!==String(value))node.textContent=String(value);}
 function pedals(bank:NodeListOf<Element>,amount:number){
  const lit=Math.round(amount*bank.length);bank.forEach((bar,i)=>bar.classList.toggle('lit',i<lit));
 }
 function update(seat:Team,car:Car,entry:GridEntry,place:number,corner:string,lap:number,lapTime:string,bestTime:string){
  root.hidden=false;root.dataset.seat=seat;
  set('kph',Math.round(car.speed*3.6));set('mph',Math.round(car.speed*2.2369363));
  set('energy',`ERS ${Math.round(car.ers)}%`);set('aero',car.drs?'DRS OPEN':'CLOSED');
  const power=car.ersPowerKw??0;
  flow.setAttribute('visibility',power?'visible':'hidden');
  flow.classList.toggle('deploy',power>0);set('flow',power>0?'BOOST':'RECHARGE');
  set('rpm',`${Math.round(car.rpm).toLocaleString('en-US')} RPM`);
  revs.setAttribute('stroke-dasharray',`${Math.min(1,Math.max(0,car.rpm/13000))} 1`);
  gears.forEach((digit,i)=>digit.classList.toggle('engaged',i+1===car.gear));
  pedals(brakes,car.brake);pedals(throttle,car.throttle);
  set('driver',`${entry.number}  ${entry.code}`);set('corner',corner.split(' / ')[0]);
  set('position','P'+place);set('surname',entry.name.split(' ').at(-1)!.toUpperCase());
  set('tyre',car.compound[0].toUpperCase());values.get('tyre')!.setAttribute('data-compound',car.compound);
  set('lap',car.finishTime!==null?'FINAL LAP':`LAP ${lap}`);set('time',lapTime);
  best.hidden=!car.bestLap;if(car.bestLap)set('best',bestTime);
  sectors.forEach((sector,i)=>{sector.dataset.state=car.finishTime!==null||i<car.sector?car.splitColours[i]:i===car.sector?'active':'pending';});
 }
 return {update,hide(){root.hidden=true;}};
}
