import type {Race, Team} from './types';

// Race entries for Las Vegas, 18 November 2026. Source: formula1.com/en/drivers.
// Starting positions are arranged for the game, independently of qualifying.
const constructors = {
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
export const paints=(entry:GridEntry)=>constructors[entry.team];
export const gridSlot=(entry:GridEntry)=>{
 const slot=grid.indexOf(entry);
 // The baked transverse line is 8 m behind the previous box; leave the
 // front of the 5.62 m car just behind it.
 return {distance:-8-slot*8-3,offset:slot%2?3:-3};
};
export interface FieldCar {distance:number;offset:number;speed:number;finishTime:number|null}
export interface OpponentCar extends FieldCar {service:number}
export function startingField():OpponentCar[]{
 return opponents.map(entry=>({...gridSlot(entry),speed:0,finishTime:null,service:0}));
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
