import {expect,test} from '@playwright/test';
import type {RaceState} from '../src/race/types';

for(const accepted of [false,true])test('matchup survives owner transport loss '+(accepted?'after':'before')+' server acceptance',async({browser,request,baseURL})=>{
 const links=await request.post('/api/rooms',{headers:{Origin:new URL(baseURL!).origin}}).then(r=>r.json());
 const owner=await browser.newPage(),seatContext=await browser.newContext();
 let seat=await seatContext.newPage();
 let lost=false,sent=0;
 await owner.routeWebSocket('**/ws',client=>{
  const server=client.connectToServer();
  if(accepted)server.onMessage(raw=>{
   const message=JSON.parse(String(raw));
   if(!lost&&sent===1&&message.type==='state'&&message.matchup==='jev-vs-luna'){
    lost=true;server.close();client.close({code:1001,reason:'Acknowledgement interrupted'});
   }else client.send(raw);
  });
  client.onMessage(raw=>{
   if(JSON.parse(String(raw)).type==='matchup'){
    sent++;
    if(!lost&&!accepted){
     lost=true;server.close();client.close({code:1001,reason:'Transport interrupted'});
     return;
    }
   }
   server.send(raw);
  });
 });
 try{
  await owner.goto(links.owner);await seat.goto(links.b);
  await expect.poll(()=>owner.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.connected.b)).toBe(true);
  await seat.close();
  await expect.poll(()=>owner.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.connected.b)).toBe(false);
  seat=await seatContext.newPage();await seat.goto(links.b);await expect.poll(()=>seat.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.connected.b)).toBe(true);
  const selector=owner.getByLabel('Driver matchup');await expect(selector).toBeEnabled();
  const choice=(await selector.inputValue())==='jev-vs-jev'?'jev-vs-luna':'jev-vs-jev';
  await selector.selectOption(choice);
  await expect.poll(()=>seat.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.matchup)).toBe(choice);
  await expect.poll(()=>owner.evaluate(()=>(window as Window&{__raceState?:RaceState}).__raceState?.matchup)).toBe(choice);
  expect(lost).toBe(true);expect(sent).toBe(accepted?1:2);await expect(seat.getByLabel('Driver matchup')).toBeDisabled();
 }finally{await owner.close();await seatContext.close();}
});
