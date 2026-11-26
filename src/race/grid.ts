import type {Compound, Race, Team} from './types';

// Race entries for Las Vegas, 18 November 2026. Source: formula1.com/en/drivers.
// Starting positions are arranged for the game, independently of qualifying.
export const compoundColors:Record<string,string>={soft:'#d63532',medium:'#d9ae37',hard:'#c7c6ba',intermediate:'#479655',wet:'#3f78b2'};
export const constructors = {
 Ferrari:['#dc1029','#f2ece5'], Mercedes:['#a6b4bb','#00c9b4'], McLaren:['#ff8018','#25282b'],
 'Red Bull Racing':['#192746','#f2b52b'], 'Racing Bulls':['#f3f4fc','#2545bb'],
 Alpine:['#1688d3','#fa9cc2'], Haas:['#f0eeec','#bc1729'], Audi:['#babec1','#ff4525'],
 Williams:['#1940aa','#41b8f0'], 'Aston Martin':['#00685a','#c9df31'], Cadillac:['#34343c','#d7d6d3'],
} as const;
export interface GridEntry {code:string; name:string; number:number; team:keyof typeof constructors; seat?:Team}
export const grid:readonly GridEntry[] = [
 {code:'ANT',name:'Kimi Antonelli',number:12,team:'Mercedes'},
 {code:'LEC',name:'Charles Leclerc',number:16,team:'Ferrari'},
 {code:'VER',name:'Max Verstappen',number:3,team:'Red Bull Racing'},
 {code:'NOR',name:'Lando Norris',number:1,team:'McLaren'},
 {code:'PIA',name:'Oscar Piastri',number:81,team:'McLaren'},
 {code:'HAD',name:'Isack Hadjar',number:6,team:'Red Bull Racing'},
 {code:'HAM',name:'Lewis Hamilton',number:44,team:'Ferrari',seat:'a'},
 {code:'RUS',name:'George Russell',number:63,team:'Mercedes',seat:'b'},
 {code:'GAS',name:'Pierre Gasly',number:10,team:'Alpine'},
 {code:'SAI',name:'Carlos Sainz',number:55,team:'Williams'},
 {code:'ALB',name:'Alexander Albon',number:23,team:'Williams'},
 {code:'BEA',name:'Oliver Bearman',number:87,team:'Haas'},
 {code:'LAW',name:'Liam Lawson',number:30,team:'Racing Bulls'},
 {code:'HUL',name:'Nico Hülkenberg',number:27,team:'Audi'},
 {code:'ALO',name:'Fernando Alonso',number:14,team:'Aston Martin'},
 {code:'COL',name:'Franco Colapinto',number:43,team:'Alpine'},
 {code:'LIN',name:'Arvid Lindblad',number:41,team:'Racing Bulls'},
 {code:'BOR',name:'Gabriel Bortoleto',number:5,team:'Audi'},
 {code:'STR',name:'Lance Stroll',number:18,team:'Aston Martin'},
 {code:'CAM',name:'Rafael Câmara',number:51,team:'Haas'},
 {code:'PER',name:'Sergio Pérez',number:11,team:'Cadillac'},
 {code:'BOT',name:'Valtteri Bottas',number:77,team:'Cadillac'},
];
export const opponents=grid.filter(entry=>!entry.seat);
export const playerEntry=(seat:Team)=>grid.find(entry=>entry.seat===seat)!;
export function teammateEntry(seat:Team){
 const own=playerEntry(seat);
 const index=opponents.findIndex(entry=>entry.team===own.team);
 return index>=0?{entry:opponents[index],index}:null;
}
export const paints=(entry:GridEntry)=>constructors[entry.team];
export const gridSlot=(entry:GridEntry)=>{
 const slot=grid.indexOf(entry);
 // The baked transverse line is 8 m behind the previous box; leave the
 // front of the 5.62 m car just behind it.
 return {distance:-8-slot*8-3,offset:slot%2?3:-3};
};
export const FIELD_STEP_TICKS=4;
export interface FieldCar {lateralVelocity?:number;impactYaw?:number;lastImpact?:{source:string;time:number};damage?:import('./types').PanelDamage;distance:number;offset:number;speed:number;finishTime:number|null;pitHeading?:number;pit?:'none'|'entry'|'stopped'|'exit';service?:number;compound?:Compound;wear?:number;tyreAge?:number;stops?:number;lastLap?:number}
export interface OpponentCar extends FieldCar {service:number;lateralVelocity?:number;impactSideSpeed?:number;compound?:Compound;weatherPit?:number;wear?:number;tyreAge?:number;stops?:number;lap?:number;lapStart?:number;lastLap?:number;sector?:number;sectorStart?:number;splits?:number[];plannedStops?:number[];plannedCompounds?:Compound[]}

function opponentPlan(index:number,laps:number):{compound:Compound;plannedStops:number[];plannedCompounds:Compound[]}{
 if(laps<=4){
  const compound:Compound=index%3===0?'soft':index%3===1?'medium':'hard';
  const next:Compound=compound==='hard'?'medium':'hard';
  return {compound,plannedStops:laps>=3?[1+index%2]:[],plannedCompounds:laps>=3?[next]:[]};
 }
 // Realistic 1-stop and 2-stop stint diversity for longer strategy races (e.g. 20 laps).
 const variant=index%4;
 if(variant===0){
  // Aggressive 2-stop: Soft -> Medium -> Soft
  return {compound:'soft',plannedStops:[Math.round(laps*.28),Math.round(laps*.68)],plannedCompounds:['medium','soft']};
 }
 if(variant===1){
  // Classic 1-stop: Medium -> Hard
  return {compound:'medium',plannedStops:[Math.round(laps*.44)+(index%2)],plannedCompounds:['hard']};
 }
 if(variant===2){
  // Overcut 1-stop: Hard -> Medium
  return {compound:'hard',plannedStops:[Math.round(laps*.60)+(index%2)],plannedCompounds:['medium']};
 }
 // Balanced 2-stop: Medium -> Soft -> Medium
 return {compound:'medium',plannedStops:[Math.round(laps*.36),Math.round(laps*.72)],plannedCompounds:['soft','medium']};
}

export function startingField(laps=3):OpponentCar[]{
 return opponents.map((entry,index)=>{
  const plan=opponentPlan(index,laps);
  return {
   ...gridSlot(entry),speed:0,finishTime:null,service:0,
   compound:plan.compound,wear:0,tyreAge:0,stops:0,lap:0,lapStart:0,lastLap:0,sector:0,sectorStart:0,splits:[],
   plannedStops:plan.plannedStops,plannedCompounds:plan.plannedCompounds,
  };
 });
}
export function classification(race:Race){
 return grid.flatMap(entry=>{
  const car=entry.seat?race.cars[entry.seat]:race.field?.[opponents.indexOf(entry)];
  return car?[{entry,car}]:[];
 }).sort((a,b)=>(a.car.finishTime??Infinity)-(b.car.finishTime??Infinity)||b.car.distance-a.car.distance);
}

// At decision cadence select the next car on the racing surface. Across an
// empty stretch retain the other player as the long-range strategic rival.
export function nearbyRival(race:Race,seat:Team):FieldCar {
 const driver=race.cars[seat],player=race.cars[seat==='a'?'b':'a'];
 let rival:FieldCar=player;
 let gap=player.distance-driver.distance;
 if(gap<=0||gap>100||player.pit!=='none'||player.finishTime!==null)gap=100;
 for(const car of race.field){
  const delta=car.distance-driver.distance;
  if(delta>0&&delta<gap&&car.finishTime===null&&Math.abs(car.offset)<8){rival=car;gap=delta;}
 }
 return rival;
}

export const contactNames=[playerEntry('a').code,playerEntry('b').code,...opponents.map(entry=>entry.code)];
