import {expect,test,type WebSocketRoute} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {createRace,DT,stepRace} from '../src/race/physics';
import {getTrack} from '../src/race/track';
import type {Race,RaceState} from '../src/race/types';

test('a front wing carries impact damage through snapshots and returns after service',async({page,request})=>{
 const {room}=await request.get('/api/default').then(r=>r.json());
 const fixture:RaceState=await request.get(`/api/rooms/${room}/status`).then(r=>r.json());
 const race=createRace();race.phase='racing';race.time=44;
 Object.assign(race.cars.a,{distance:839,speed:80,offset:0});
 Object.assign(race.cars.b,{distance:720,speed:50});
 Object.assign(race.field[0],{distance:844.75,speed:22,offset:.6});
 const before=structuredClone(race);
 stepRace(race);
 expect(race.cars.a.damage?.[0]).toBeGreaterThan(.9);
 const impact=structuredClone(race);
 Object.assign(race.cars.a,{pit:'stopped',speed:0,pitTime:0});
 for(let n=0;n<Math.round(getTrack().PIT_STOP_SECONDS/DT);n++)stepRace(race);
 expect(race.cars.a.damage).toBeUndefined();
 // Hold the same car pose and camera for all three photographs. Damage,
 // repair, race time and broadcast messages come from the integrator.
 function view(state:Race){
  const shot=structuredClone(before);
  Object.assign(shot,{time:state.time,tick:state.tick,events:state.events});
  Object.assign(shot.cars.a,{damage:state.cars.a.damage,lastImpact:state.cars.a.lastImpact});
  shot.field[0].distance=1000;
  fixture.race=shot;fixture.connected={a:true,b:true};
 }
 let feed:WebSocketRoute;
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 view(before);
 await page.routeWebSocket('**/api/rooms/*/ws',ws=>ws.onMessage(raw=>{
  const message=JSON.parse(String(raw));
  if(message.type==='join'){feed=ws;ws.send(JSON.stringify({type:'joined',team:null,canReset:true}));ws.send(JSON.stringify(fixture));}
  if(message.type==='ping')ws.send(JSON.stringify({type:'pong',sent:message.sent}));
 }));
 await page.setViewportSize({width:1280,height:800});
 await page.goto('/?spectate&camera=detail&subject=a&angle=front');
 await page.waitForFunction(()=>!!(window as any).__renderStats?.modelsReady);
 await page.keyboard.press('b');
 await expect(page.locator('body')).toHaveClass(/clean-feed/);
 await mkdir('artifacts/crashes',{recursive:true});
 await page.screenshot({path:'artifacts/crashes/before.png'});
 view(impact);feed!.send(JSON.stringify(fixture));
 await expect(page.locator('#timing-rows')).toContainText('100% DAMAGE');
 await expect(page.locator('#event-flash')).toContainText('ANT CONTACT');
 await page.screenshot({path:'artifacts/crashes/impact.png'});
 view(race);feed!.send(JSON.stringify(fixture));
 await expect(page.locator('#event-flash')).toContainText('DAMAGE REPAIRED');
 await expect(page.locator('#timing-rows')).not.toContainText('% DAMAGE');
 await page.screenshot({path:'artifacts/crashes/repaired.png'});
 expect(errors).toEqual([]);
});
