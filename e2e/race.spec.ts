import {test,expect,type Page} from '@playwright/test';
import type {RaceState} from '../src/race/types';
function telemetry(link:string,spectate=false){
 const url=new URL(link);
 url.searchParams.set('view','telemetry');
 if(spectate)url.searchParams.set('spectate','');
 return url.href;
}
const state=(p:Page)=>p.evaluate(()=>(window as unknown as {__raceState:RaceState}).__raceState);
for(const [circuit,matchup] of [['monza','jev-vs-jev'],['monza','jev-vs-luna'],['las-vegas','jev-vs-luna']] as const)test(`three independent WebSocket contexts race from lights out to results with radio and a pit stop (${circuit}, ${matchup})`,async({browser,request})=>{
 const errors:string[]=[];const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1440,height:980}}))),pages=await Promise.all(contexts.map(c=>c.newPage()));pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));const [a,b,spectator]=pages;
 try{
  const links=await request.get('/api/default').then(r=>r.json());await spectator.goto(telemetry(links.owner,true));await spectator.bringToFront();await expect(spectator.locator('#matchup-select')).toBeEnabled({timeout:15000});await spectator.getByLabel('Circuit',{exact:true}).selectOption(circuit);await expect.poll(async()=>(await state(spectator))?.race.circuit).toBe(circuit);await spectator.getByLabel('Driver matchup').selectOption(matchup);await expect.poll(async()=>(await state(spectator))?.matchup).toBe(matchup);await Promise.all(pages.map((p,i)=>p.goto([telemetry(links.a),telemetry(links.b),telemetry(links.owner,true)][i])));
  await spectator.bringToFront();
  await expect.poll(async()=>(await state(spectator))?.connected).toEqual({a:true,b:true});
  expect((await state(spectator)).race).toMatchObject({phase:'lobby',tick:0});
  await spectator.getByRole('button',{name:'Start race',exact:true}).click();
  await expect.poll(async()=>(await state(spectator))?.race.phase).toBe('racing');await expect.poll(async()=>(await state(spectator))?.intents.a).toBeGreaterThan(2);await expect.poll(async()=>(await state(spectator))?.intents.b).toBeGreaterThan(2);
  expect((await state(spectator)).players.b.engine).toBe(matchup==='jev-vs-luna'?'luna':'jev');await expect(b.locator('#mode')).toHaveAttribute('title',matchup==='jev-vs-luna'?/LUNA \/ MOCK/:/JEV \/ MOCK/);const first=await state(spectator);await expect.poll(async()=>(await state(spectator)).race.cars.a.distance).toBeGreaterThan(first.race.cars.a.distance+50);await expect.poll(async()=>(await state(spectator)).engineerCalls.a).toBeGreaterThan(0);
  expect(first.race.field).toHaveLength(20);
  await expect(spectator.locator('#map-commitment')).toHaveAttribute('cx', /-?\d/);
  await spectator.getByRole('button',{name:'Full grid'}).click();await expect(spectator.locator('#timing-rows .timing-row')).toHaveCount(22);
  await expect(spectator.locator('#timing-rows')).toContainText('Lewis Hamilton');await expect(spectator.locator('#timing-rows')).toContainText('George Russell');
  await spectator.getByRole('button',{name:'Player cars'}).click();
  await expect(a.locator('.race-controls, #pit-commitment, #tick, #race-speed')).toHaveCount(0);
  await expect(a.getByRole('button',{name:'Instant replay'})).toBeVisible();
  await expect.poll(async()=>(await state(spectator)).race.cars.a.stops,{timeout:60000}).toBeGreaterThanOrEqual(1);await expect.poll(async()=>(await state(spectator)).race.cars.b.stops,{timeout:60000}).toBeGreaterThanOrEqual(1);await expect.poll(async()=>(await state(spectator)).race.phase,{timeout:90000}).toBe('finished');
  await expect(spectator.locator('#results')).toBeVisible();await expect(spectator.locator('#result-rows .result-row')).toHaveCount(22);const result=await state(spectator);expect(result.race.field.every(car=>car.finishTime!==null)).toBe(true);expect(result.race.cars.a.lapTimes).toHaveLength(3);expect(result.race.cars.b.lapTimes).toHaveLength(3);expect(result.race.winner).toBeTruthy();expect(result.paidCalls).toBe(0);expect((await state(a)).room).toBe((await state(b)).room);
  await spectator.getByRole('button',{name:'Replay the battle'}).click();await expect(spectator.locator('body')).toHaveAttribute('data-replay','true');await expect(spectator.locator('#results')).toBeHidden();await spectator.getByRole('button',{name:/Back to live/}).click();await expect(spectator.locator('#results')).toBeVisible();
  await b.close();await expect.poll(async()=>(await state(spectator)).connected.b).toBe(false);const replacement=await contexts[1].newPage();await replacement.goto(telemetry(links.b));await expect.poll(async()=>(await state(spectator)).connected.b).toBe(true);expect((await state(replacement)).race.cars.b.stops).toBe(result.race.cars.b.stops);
  await spectator.bringToFront();
  await spectator.getByRole('button',{name:'Race again'}).click();
  await expect.poll(async()=>(await state(spectator)).race.phase).toBe('lobby');
  await spectator.getByRole('button',{name:'Title sequence'}).click();await expect(spectator.locator('#title-card')).toBeVisible();await spectator.getByRole('button',{name:'Continue to race'}).click();
  expect((await state(spectator)).race).toMatchObject({phase:'lobby',tick:0});
  await spectator.getByRole('button',{name:'Start race',exact:true}).click();
  await expect.poll(async()=>(await state(spectator)).race.phase).toBe('racing');
  await a.setViewportSize({width:480,height:1000});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const alternate=matchup==='jev-vs-luna'?'jev-vs-jev':'jev-vs-luna';const requestedAt=Date.now();await spectator.getByLabel('Driver matchup').selectOption(alternate);
  // Verify the owner request at the server and the replacement seat’s snapshot.
  await expect.poll(async()=>request.get('/api/rooms/'+links.room+'/status').then(r=>r.json()).then(s=>s.matchup)).toBe(alternate);
  const acceptedMs=Date.now()-requestedAt;
  await expect.poll(()=>replacement.evaluate(()=>(window as unknown as {__raceState:RaceState}).__raceState.matchup)).toBe(alternate);
  expect((await state(replacement)).race).toMatchObject({phase:'lobby',tick:0});
  await test.info().attach('matchup-reconnect',{contentType:'application/json',body:JSON.stringify({circuit,matchup,alternate,acceptedMs,replacementConfirmedMs:Date.now()-requestedAt})});
  await spectator.getByLabel('Driver matchup').selectOption(matchup);await expect.poll(async()=>(await state(a)).matchup).toBe(matchup);await expect(replacement.getByLabel('Driver matchup')).toBeDisabled();await expect(replacement.getByLabel('Circuit',{exact:true})).toBeDisabled();const health=await request.get('/health');expect(health.ok()).toBe(true);expect(errors).toEqual([]);
  console.log(JSON.stringify({race:result.room,circuit,matchup,winner:result.race.winner,lapTimes:{a:result.race.cars.a.lapTimes,b:result.race.cars.b.lapTimes},stops:{a:result.race.cars.a.stops,b:result.race.cars.b.stops},intents:result.intents,engineerCalls:result.engineerCalls,paidCalls:result.paidCalls,errors},null,2));
 }finally{await Promise.all(contexts.map(c=>c.close()));}
});
