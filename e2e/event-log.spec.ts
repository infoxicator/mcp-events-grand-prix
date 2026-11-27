import {expect,test} from '@playwright/test';
import type {RaceLogEntry,RaceLogUpdate} from '../src/race/event-log';
import type {RaceState} from '../src/race/types';

test('event log opens by default, hides driver events, filters cleanly, and preserves scroll position',async({page,request})=>{
 const {room}=await request.get('/api/default').then(response=>response.json());
 const state:RaceState=await request.get(`/api/rooms/${room}/status`).then(response=>response.json());
 state.race.phase='racing';
 state.connected={a:true,b:true};

 let subscribed=false;
 let pushLog:(update:RaceLogUpdate)=>void=()=>{};

 const initialEntries:RaceLogEntry[]=[
  {
   id:1,time:12,lap:1,team:'a',
   data:{kind:'driver',engine:'jev',source:'mock',responseMs:8,sequence:1,intent:{offset:0,speedBias:1,brakeAggression:.5,side:'hold',ers:true,drs:false}},
  },
  {
   id:2,time:15,lap:1,team:'a',
   data:{
    kind:'strategy',agent:'chatgpt',stage:'requested',reasons:['Opening strategy'],
    summary:{speedKph:312,position:1,lapsRemaining:5,compound:'medium',tyreWear:98,availableSets:{soft:2,medium:2,hard:1,intermediate:2,wet:1},chargeKJ:3200,projectedFuelKg:18,marginAboveFuelSampleKg:17,gapAheadSeconds:null,gapBehindSeconds:1.2,damage:false,pitPhase:'none',plannedCompound:null,distanceToPitCommitmentM:400,estimatedRejoinPosition:1,teammateInPitLane:false,dryCompoundRuleSatisfied:false,flag:'green',speedLimitKph:null,safetyCarScheduledLap:null,safetyCarInLap:null,rain:'dry',wetness:0,sectorWetness:[0,0,0],wetGripByCompound:{soft:1,medium:1,hard:1,intermediate:.9,wet:.8}},
   },
  },
  {
   id:3,time:22,lap:1,team:'b',
   data:{
    kind:'radio',speaker:'ENGINEER',source:'live',strategist:'chatgpt',responseMs:240,
    text:'Manage the front left through Ascari and hold track position.',
    instruction:{pace:'manage',ers:'harvest',box:false,tyre:'medium',tactic:'hold',line:'Manage the front left through Ascari.'},
   },
  },
 ];

 // Add enough extra entries so the list overflows and exercises scrolling.
 for(let i=4;i<=16;i++){
  initialEntries.push({
   id:i,time:22+i*5,lap:Math.min(5,1+Math.floor(i/4)),team:i%2===0?'a':'b',
   data:i%2===0
    ?{kind:'strategy',agent:'chatgpt',stage:'delivered',reasons:[`Stint checkpoint ${i}`]}
    :{kind:'radio',speaker:'ENGINEER',source:'live',responseMs:110+i,text:`Pit wall update #${i}: keep tyres in the window.`},
  });
 }

 await page.routeWebSocket('**/api/rooms/*/ws',socket=>{
  socket.onMessage(raw=>{
   const message=JSON.parse(String(raw));
   if(message.type==='join'){
    socket.send(JSON.stringify({type:'joined',team:null,canReset:false}));
    socket.send(JSON.stringify(state));
   }
   if(message.type==='event-log'&&message.subscribe){
    subscribed=true;
    pushLog=update=>socket.send(JSON.stringify(update));
    pushLog({type:'event-log',reset:true,entries:initialEntries});
   }
  });
 });

 await page.goto('/?spectate&view=telemetry');
 await page.waitForFunction(()=>Boolean((window as Window&{__raceState?:RaceState}).__raceState));

 const log=page.locator('#race-event-log');
 const list=log.locator('ol.event-log-entries');

 // Open by default and auto-subscribed without clicking any expand button.
 await expect.poll(()=>subscribed).toBe(true);
 await expect(list).toBeVisible();

 // Driver filter and driver events are completely removed from the UI.
 await expect(log.getByRole('button',{name:'Driver',exact:true})).toHaveCount(0);
 await expect(log.locator('li[data-kind="driver"]')).toHaveCount(0);
 await expect(log.locator('li.event-log-row')).toHaveCount(15);
 await expect(log.locator('.event-log-total')).toHaveText('15 events');

 // Scroll container does not trap parent scrolling.
 await expect(list).toHaveCSS('overscroll-behavior-y','auto');

 // Filter buttons work and keep clean accessible names.
 await log.getByRole('button',{name:'Strategist',exact:true}).click();
 await expect(log.locator('li[data-kind="radio"]')).toHaveCount(0);
 await expect(log.locator('li[data-kind="strategy"]')).toHaveCount(8);

 // Expand a strategy entry and verify payload inspection drawer.
 const opening=log.locator('li').filter({hasText:'Opening strategy'});
 await opening.locator('summary').click();
 await expect(opening.locator('pre')).toContainText('"speedKph": 312');
 await expect(opening.getByRole('button',{name:'Copy JSON'})).toBeVisible();

 await log.getByRole('button',{name:'Radio',exact:true}).click();
 await expect(log.locator('li[data-kind="strategy"]')).toHaveCount(0);
 await expect(log.getByText('Manage the front left through Ascari and hold track position.',{exact:true})).toBeVisible();

 // Switch back to All and test scroll preservation when new events arrive.
 await log.getByRole('button',{name:'All',exact:true}).click();
 await expect(log.locator('li.event-log-row')).toHaveCount(15);

 const scrolledBefore=await list.evaluate(el=>{
  el.scrollTop=180;
  el.dispatchEvent(new Event('scroll'));
  return el.scrollTop;
 });
 expect(scrolledBefore).toBeGreaterThan(100);

 // Incoming mock/fallback events must be ignored and not trigger unread badge.
 pushLog({
  type:'event-log',
  entries:[
   {
    id:100,time:120,lap:6,team:'a',
    data:{kind:'driver',engine:'jev',source:'mock',responseMs:5,sequence:99,intent:{offset:0,speedBias:1,brakeAggression:.5,side:'left',ers:false,drs:false}},
   },
   {
    id:1001,time:121,lap:6,team:'a',
    data:{kind:'driver',engine:'jev',source:'fallback',warning:'Fallback',responseMs:5,sequence:100,intent:{offset:0,speedBias:1,brakeAggression:.5,side:'left',ers:false,drs:false}},
   },
   {
    id:1002,time:122,lap:6,team:'a',
    data:{kind:'radio',speaker:'ENGINEER',source:'mock',responseMs:1,text:'Mock pit wall radio should stay hidden.'},
   },
   {
    id:1004,time:122.5,lap:6,team:'a',
    data:{kind:'radio',speaker:'JEV',source:'live',responseMs:140,text:'Copy. Setting up the pass.'},
   },
   {
    id:1005,time:122.8,lap:6,team:'b',
    data:{kind:'radio',speaker:'LUNA',source:'live',responseMs:140,text:'Fronts are graining.'},
   },
   {
    id:1003,time:123,lap:6,team:'a',
    data:{kind:'strategy',agent:'pit-wall',stage:'requested',source:'mock',reasons:['Mock pit wall telemetry']},
   },
  ],
 });
 await expect(log.locator('li[data-kind="driver"]')).toHaveCount(0);
 await expect(log.locator('li.event-log-row')).toHaveCount(15);
 await expect(log.locator('.event-log-jump')).toHaveText('↑ Latest');

 // Incoming radio event while scrolled down preserves viewport offset and surfaces "↑ 1 new".
 const scrollHeightBefore=await list.evaluate(el=>el.scrollHeight);
 pushLog({
  type:'event-log',
  entries:[{
   id:101,time:125,lap:6,team:'a',
   data:{kind:'radio',speaker:'ENGINEER',source:'live',strategist:'chatgpt',responseMs:190,text:'Box this lap for fresh mediums.'},
  }],
 });
 await expect(log.locator('li.event-log-row')).toHaveCount(16);
 await expect(log.locator('.event-log-jump')).toHaveText('↑ 1 new');

 const {scrollTopAfter,scrollHeightAfter}=await list.evaluate(el=>({scrollTopAfter:el.scrollTop,scrollHeightAfter:el.scrollHeight}));
 expect(scrollTopAfter).toBeGreaterThan(scrolledBefore);
 expect(Math.abs((scrollTopAfter-scrolledBefore)-(scrollHeightAfter-scrollHeightBefore))).toBeLessThanOrEqual(4);

 // Clicking the jump pill scrolls back to latest and hides itself.
 await log.locator('.event-log-jump').click();
 await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeLessThanOrEqual(4);
 await expect(log.locator('.event-log-jump')).toBeHidden();

 // Live AI driver decisions (Jev System 1 / Luna) appear with their changes and unlock the Driver filter.
 pushLog({
  type:'event-log',
  entries:[{
   id:102,time:130,lap:6,team:'a',
   data:{
    kind:'driver',engine:'jev',source:'jev',model:'jev-latest',provider:'typesafe',responseMs:142,sequence:2,
    changed:['Line → LEFT','Pace → ATTACK','ERS → DEPLOY'],
    intent:{offset:-3,speedBias:2,brakeAggression:.9,side:'left',ers:true,drs:true},
   },
  }],
 });
 await expect(log.locator('li[data-kind="driver"]')).toHaveCount(1);
 await expect(log.locator('li[data-kind="driver"]')).toContainText('Line → LEFT · Pace → ATTACK · ERS → DEPLOY');
 await expect(log.locator('li[data-kind="driver"]')).toContainText('LIVE · 142 ms');
 const driverFilter=log.getByRole('button',{name:'Driver',exact:true});
 await expect(driverFilter).toBeVisible();
 await driverFilter.click();
 await expect(log.locator('li.event-log-row')).toHaveCount(1);
 await expect(log.locator('li[data-kind="driver"]')).toHaveCount(1);

 const intent={offset:0,speedBias:0,brakeAggression:.55,side:'hold' as const,ers:false,drs:false};
 pushLog({type:'event-log',entries:[
  {id:103,time:131,lap:6,team:'a',data:{
   kind:'driver',engine:'jev',source:'jev',responseMs:130,sequence:3,controlStyle:'raw',
   control:{style:'raw',steer:'slight-left',throttle:'half',brake:'light'},intent,
   changed:['Steer → SLIGHT-LEFT','Thr → HALF','Brk → LIGHT'],
  }},
  {id:104,time:132,lap:6,team:'a',data:{
   kind:'driver',engine:'jev',source:'jev',responseMs:130,sequence:1,controlStyle:'step-locked',
   control:{style:'step-locked',steer:'straight',throttle:'full',brake:'none'},intent,
  }},
  {id:105,time:133,lap:6,team:'b',data:{
   kind:'driver',engine:'luna',source:'luna',responseMs:210,sequence:2,controlStyle:'no-assist',
   control:{style:'no-assist',lane:'far-right',pedal:'overdrive'},intent,
   changed:['Lane → FAR-RIGHT','Pedal → OVERDRIVE'],
  }},
 ]});
 await expect(log.locator('li[data-kind="driver"]')).toHaveCount(4);
 const raw=log.locator('li').filter({hasText:'EXP A · RAW'});
 await expect(raw).toContainText('Steer → SLIGHT-LEFT · Thr → HALF · Brk → LIGHT');
 await expect(raw).toContainText('BRK LIGHT');
 await expect(log.locator('li').filter({hasText:'EXP B · STEP-LOCK'})).toContainText('THR FULL');
 const hybrid=log.locator('li').filter({hasText:'EXP C · NO-ASSIST'});
 await expect(hybrid).toContainText('Lane → FAR-RIGHT · Pedal → OVERDRIVE');
 await expect(hybrid).toContainText('PEDAL OVERDRIVE');

 // Resetting back to a session without an active AI driver hides the Driver tab again.
 pushLog({type:'event-log',reset:true,entries:initialEntries});
 await expect(log.getByRole('button',{name:'Driver',exact:true})).toHaveCount(0);
 await expect(log.locator('li[data-kind="driver"]')).toHaveCount(0);
 await expect(log.locator('li.event-log-row')).toHaveCount(15);
});
