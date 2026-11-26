import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import sharp from 'sharp';
import type {ChatStrategyRadio,ClientMessage,DriverConsultRadio,RaceState} from '../src/race/types';

async function raceFeed(page:Page,request:APIRequestContext){
 const {room}=await request.get('/api/default').then(response=>response.json());
 const state:RaceState=await request.get(`/api/rooms/${room}/status`).then(response=>response.json());
 state.race.phase='racing';
 state.connected={a:true,b:true};
 let send=()=>{};
 await page.routeWebSocket('**/api/rooms/*/ws',socket=>{
  socket.onMessage(raw=>{
   const message=JSON.parse(String(raw));
   if(message.type==='join'){
    socket.send(JSON.stringify({type:'joined',team:null,canReset:false}));
    send=()=>socket.send(JSON.stringify(state));
    send();
   }
   if(message.type==='audio')socket.send(JSON.stringify({type:'audio',granted:message.claim}));
  });
 });
 await page.goto('/?spectate&view=telemetry');
 await page.waitForFunction(()=>Boolean((window as Window&{__raceState?:RaceState}).__raceState));
 return (order?:ChatStrategyRadio,consultations?:DriverConsultRadio[])=>{
  if(order)(state.latestChatRadio??={})[order.team]=order;
  if(consultations)state.driverConsultRadio={a:consultations};
  send();
 };
}

const order=(id:number,team:'a'|'b',text:string):ChatStrategyRadio=>
 ({id,team,text,time:0,speaker:'ENGINEER',source:'live',strategist:'chatgpt',responseMs:1,lap:1});
const consultation=(id:number,kind:DriverConsultRadio['consultation'],text:string):DriverConsultRadio=>({
 id,team:'a',text,time:0,speaker:kind==='question'?'DRIVER':'ENGINEER',source:'live',responseMs:0,
 consultation:kind,consultationId:'consultation-1',...(kind==='answer'?{strategist:'chatgpt'}:{}),
});
const visibleWords='.radio-word:has(.radio-character-visible)';

test('live driver can send a question and read a fast reply in team radio',async({page,request})=>{
 const {room}=await request.get('/api/default').then(response=>response.json());
 const state:RaceState=await request.get(`/api/rooms/${room}/status`).then(response=>response.json());
 Object.assign(state,{live:'running',strategyPractice:true,chatStrategy:{state:'applied',team:'a'},
  connected:{a:true,b:true},driverMode:{a:'human',b:'autopilot'}});
 state.race.phase='lobby';
 const questions:string[]=[];
 const messages:ClientMessage[]=[];
 let send=()=>{};
 await page.routeWebSocket('**/api/rooms/*/ws',socket=>{
  socket.onMessage(raw=>{
   const message=JSON.parse(String(raw)) as ClientMessage;
   messages.push(message);
   if(message.type==='join'){
    socket.send(JSON.stringify({type:'joined',team:message.team,role:message.role,canReset:false}));
    send=()=>socket.send(JSON.stringify(state));
    send();
   }
   if(message.type==='strategy-question'){
    questions.push(message.text);
    if(questions.length===1){
     state.driverConsultRadio={a:[consultation(20,'question',message.text),consultation(21,'answer','Your tyres can finish the race.')]};
     send();
    }else{
     socket.send(JSON.stringify({type:'error',code:'strategy-question',message:'A question is already awaiting a reply.'}));
    }
   }
  });
 });
 await page.goto(`/?drive&live=${room}&team=a#token=${'c'.repeat(64)}`);
 const radio=page.getByRole('region',{name:'Team radio'});
 const question=page.getByRole('textbox',{name:'Ask the strategist'});
 await expect(page.locator('body')).toHaveAttribute('data-phase','lobby');
 await expect(question).toBeHidden();
 state.race.phase='racing';
 send();
 await expect(question).toBeVisible();
 await expect(question).toHaveAttribute('maxlength','180');
 const submit=radio.getByRole('button',{name:'Send',exact:true});
 await expect(submit).toBeDisabled();
 await question.fill('   ');
 await expect(submit).toBeDisabled();
 await question.pressSequentially('What grip can I expect?');
 await question.press('Enter');
 const log=radio.getByRole('log');
 await expect(log.locator('.drive-team-radio-message')).toHaveText([
  'DriverWhat grip can I expect?','ChatGPT strategistYour tyres can finish the race.',
 ]);
 await expect(question).toHaveValue('');
 await expect(question).not.toBeFocused();
 expect(questions).toEqual(['What grip can I expect?']);
 expect(messages.filter(message=>message.type==='driver-mode'||message.type==='radio')).toEqual([]);

 await question.fill('Is the pit lane clear?');
 await submit.click();
 await expect(radio.getByRole('status')).toHaveText('A question is already awaiting a reply.');
 await expect(question).toHaveValue('Is the pit lane clear?');
 await expect(submit).toBeEnabled();
 state.race.cars.a.finishTime=65;
 send();
 await expect(question).toBeHidden();
 await expect(log.locator('.drive-team-radio-message')).toHaveCount(2);
});

test('the broadcast delivers a driver question before a reply received in the same snapshot',async({page,request})=>{
 const send=await raceFeed(page,request);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const question=consultation(20,'question','How are my tyres?');
 const answer=consultation(21,'answer','You can stay out for another lap.');
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 const announcement=page.locator('#radio-announcement');
 send(undefined,[question,answer]);
 await expect(radio.getByText('Driver',{exact:true})).toBeVisible();
 await expect(radio.locator('.radio-transcript')).toHaveText(`"${question.text}"`);
 await expect(announcement).toContainText(`Driver. ${question.text}`);
 await page.clock.runFor(4_500);
 await expect(radio.getByText('ChatGPT strategist',{exact:true})).toBeVisible();
 await expect(radio.locator('.radio-transcript')).toHaveText(`"${answer.text}"`);
 await expect(announcement).toContainText(`ChatGPT strategist. ${answer.text}`);
 await page.clock.runFor(4_500);
 send();
 await expect(radio).toBeHidden();
 await expect(page.getByRole('textbox',{name:'Ask the strategist'})).toHaveCount(0);
});

const waveform=(page:Page)=>page.locator('.radio-wave').evaluate(element=>{
 const canvas=element as HTMLCanvasElement;
 const {width,height}=canvas;
 const pixels=canvas.getContext('2d')!.getImageData(0,0,width,height).data;
 for(let row=0;row<height;row++)for(let column=0;column<width;column++){
  if(pixels[(row*width+column)*4+3]>20)return (height-row)/2;
 }
 return 0;
});

test('radio appears above the minimap, reveals words and clears without replaying the same message',async({page,request})=>{
 await page.setViewportSize({width:420,height:840});
 const send=await raceFeed(page,request);
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 const map=page.locator('.minimap');
 await expect(radio).toBeHidden();
 send(order(1,'a','Save the tyres now and push down the next straight.'));
 await expect(radio.getByRole('heading',{name:'Hamilton'})).toBeVisible();
 await expect(radio.getByText('44',{exact:true})).toBeVisible();
 await expect(radio.getByRole('img',{name:'Ferrari'})).toBeVisible();
 await expect(radio.getByText('Radio',{exact:true})).toBeVisible();
 await expect(radio.getByText(/ChatGPT/)).toHaveCount(0);
 const [card,track,feed]=await Promise.all([radio.boundingBox(),map.boundingBox(),page.locator('#viewport').boundingBox()]);
 expect(card!.y+card!.height).toBeLessThan(track!.y);
 expect(card!.x+card!.width).toBeCloseTo(track!.x+track!.width,0);
 expect(card!.y).toBeGreaterThan(feed!.y);
 const transcript=radio.locator('.radio-transcript').first();
 await expect(transcript).toBeVisible();
 await expect(radio.locator(visibleWords)).toHaveCount(1);
 await expect(transcript).toHaveCSS('text-align','start');
 const firstLetter=transcript.getByText('S',{exact:true});
 await expect(firstLetter).toHaveCSS('visibility','hidden');
 await page.clock.runFor(25);
 await expect(firstLetter).toHaveCSS('visibility','visible');
 await page.clock.runFor(875);
 await expect(radio.locator(visibleWords)).toHaveCount(10);
 expect(await waveform(page)).toBeGreaterThan(8);
 await expect(transcript).toHaveText('"Save the tyres now and push down the next straight."');
 await page.clock.runFor(4290);
 await expect(radio.locator('article')).toHaveCSS('animation-name','radio-out');
 await page.clock.runFor(170);
 await expect(radio).toBeHidden();
 send();
 await page.clock.runFor(150);
 await expect(radio).toBeHidden();
 send(order(2,'b','Box at the end of this lap.'));
 await expect(radio.getByRole('heading',{name:'Russell'})).toBeVisible();
 await expect(radio.getByText('63',{exact:true})).toBeVisible();
 await expect(radio.getByRole('img',{name:'Mercedes'})).toBeVisible();
 await expect(radio.getByRole('heading',{name:'Russell'})).toHaveCSS('color','rgb(48, 185, 173)');
 await page.emulateMedia({reducedMotion:'reduce'});
 send(order(3,'b','Clear pit exit.'));
 await expect(radio.locator(visibleWords)).toHaveCount(3);
 await expect(radio.locator('article')).toHaveCSS('animation-name','none');
});

test('long radio calls reveal an unbroken prefix and scroll the latest caption into view',async({page,request})=>{
 await page.setViewportSize({width:420,height:840});
 const send=await raceFeed(page,request);
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const text='Box this lap for hards. Look after the softs on the in-lap and keep the engine cool. '+
  'Leave a gap to the car ahead, watch the cafe\u0301 marker and confirm the pit limiter.';
 send(order(1,'a',text));
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 const header=radio.locator('header');
 const captions=radio.locator('.radio-captions');
 const letters=radio.locator('.radio-transcript').first().locator('.radio-character');
 await expect(header).toBeVisible();
 await radio.locator('article').evaluate(el=>el.getAnimations().forEach(animation=>animation.finish()));
 const nameplate=await header.boundingBox();
 await page.clock.runFor(40);
 expect(await captions.evaluate(el=>el.scrollTop)).toBe(0);
 await page.clock.runFor(2040);
 const visibility=await letters.evaluateAll(elements=>elements.map(el=>getComputedStyle(el).visibility==='visible'));
 const firstHidden=visibility.indexOf(false);
 expect(firstHidden).toBeGreaterThan(100);
 expect(visibility.slice(firstHidden)).not.toContain(true);
 await expect(letters.filter({hasText:'e\u0301'})).toHaveCount(1);
 expect(await captions.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await page.clock.runFor(1000);
 await expect(radio.locator('.radio-transcript').first()).toHaveText(`"${text}"`);
 expect(await letters.evaluateAll(elements=>elements.every(el=>getComputedStyle(el).visibility==='visible'))).toBe(true);
 const [captionBox,lastLetter,mapBox]=await Promise.all([
  captions.boundingBox(),letters.last().boundingBox(),page.locator('.minimap').boundingBox(),
 ]);
 expect(lastLetter!.y).toBeGreaterThanOrEqual(captionBox!.y);
 expect(lastLetter!.y+lastLetter!.height).toBeLessThanOrEqual(captionBox!.y+captionBox!.height+1);
 expect(captionBox!.y+captionBox!.height).toBeLessThan(mapBox!.y);
 expect(await header.boundingBox()).toEqual(nameplate);
 await page.mouse.move(captionBox!.x+10,captionBox!.y+5);
 await page.mouse.wheel(0,-1000);
 await expect.poll(()=>captions.evaluate(el=>el.scrollTop)).toBe(0);
 expect((await letters.first().boundingBox())!.y).toBeGreaterThanOrEqual(captionBox!.y);
 expect(await header.boundingBox()).toEqual(nameplate);
 await page.emulateMedia({reducedMotion:'reduce'});
 send(order(2,'a',`Copy. ${text}`));
 await expect(radio.locator('.radio-transcript').first()).toHaveText(`"Copy. ${text}"`);
 await expect(radio.locator('article')).toHaveCSS('animation-name','none');
 expect(await captions.evaluate(el=>el.scrollTop)).toBe(0);
});

test('the wide-feed nameplate holds its measured position through the wipe and fade',async({page,request})=>{
 const send=await raceFeed(page,request);
 const feed=page.locator('#viewport');
 await feed.evaluate(el=>{el.style.width='1280px';el.style.height='720px';});
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 send(order(1,'a','Keep pushing.'));
 const article=page.getByRole('region',{name:'ChatGPT radio'}).locator('article');
 await expect(article).toHaveCSS('animation-duration','0.56s');
 const [nameplate,viewport]=await Promise.all([article.locator('header').boundingBox(),feed.boundingBox()]);
 expect(nameplate!.x-viewport!.x).toBeCloseTo(1055,0);
 expect(nameplate!.y-viewport!.y).toBeCloseTo(310,0);
 expect(nameplate!.width).toBeCloseTo(165,0);
 expect(nameplate!.height).toBeCloseTo(88,0);
 await expect(article.getByRole('heading',{name:'Hamilton'})).toHaveCSS('color','rgb(214, 49, 41)');
 await expect(article.locator('.radio-number')).toHaveCSS('color','rgb(173, 54, 75)');
 await expect(article.locator('.radio-label')).toHaveCSS('color','rgb(242, 245, 247)');
 await expect(article.getByRole('img',{name:'Ferrari'})).toBeVisible();
 const keyframes=()=>article.evaluate(element=>element.getAnimations().flatMap(animation=>
  (animation.effect as KeyframeEffect).getKeyframes()));
 const entry=await keyframes();
 expect(entry[0].clipPath).toBe('polygon(77% 0px, 77% 0px, 77% 0px, 23% 100%, 23% 100%, 23% 100%)');
 expect(entry[2]).toMatchObject({offset:.28571,opacity:'0.29'});
 expect(entry.every(frame=>frame.transform===undefined)).toBe(true);
 await page.clock.runFor(4580);
 await expect(article).toHaveCSS('animation-name','radio-out');
 await expect(article).toHaveCSS('animation-duration','0.16s');
 const exit=await keyframes();
 expect(exit.map(frame=>frame.opacity)).toEqual(['1','0.68','0.37','0.08','0']);
 expect(exit.every(frame=>frame.transform===undefined&&frame.clipPath===undefined)).toBe(true);
});

test('the spectator feed reserves room for the caption above the minimap',async({page,request})=>{
 await page.setViewportSize({width:1440,height:1060});
 const send=await raceFeed(page,request);
 await page.emulateMedia({reducedMotion:'reduce'});
 send(order(1,'a','Safety car out. Hold position.'));
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 await expect(radio.locator('.radio-transcript')).toBeVisible();
 await page.evaluate(()=>document.fonts.ready.then(()=>true));
 const captions=radio.locator('.radio-captions');
 expect(await captions.evaluate(el=>el.clientHeight)).toBeGreaterThanOrEqual(50);
 expect(await captions.evaluate(el=>el.scrollHeight-el.clientHeight)).toBe(0);
 const [box,map]=await Promise.all([radio.boundingBox(),page.locator('.minimap').boundingBox()]);
 expect(box!.y+box!.height).toBeLessThan(map!.y);
});

test('the caption keeps its broadcast wrapping and ignores a later driver reply',async({page,request})=>{
 const send=await raceFeed(page,request);
 await page.locator('#viewport').evaluate(el=>{el.style.width='1280px';el.style.height='720px';});
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 const call=order(20,'a','We are swapping cars in turn 14');
 const reply={id:22,team:'a',speaker:'JEV',text:"When he's closer, yeah",responseMs:20,time:1,source:'live'} as const;
 send(call);
 const engineer=radio.locator('.radio-transcript');
 await expect(radio.locator('.radio-wave')).toHaveAttribute('width','192');
 await expect(engineer).toBeVisible();
 await page.clock.runFor(590);
 await expect(engineer).toHaveText('"We are swapping cars in turn 14"');
 await expect(engineer).toHaveCSS('font-family',/Oxanium/);
 await expect(engineer).toHaveCSS('font-weight','525');
 await expect(engineer).toHaveCSS('-webkit-text-stroke-width','0.39px');
 await page.evaluate(()=>document.fonts.ready.then(()=>true));
 const lines=await engineer.locator(visibleWords).evaluateAll(words=>{
  const rows=new Map<number,string[]>();
  for(const word of words){
   const top=word.getBoundingClientRect().top;
   (rows.get(top)??rows.set(top,[]).get(top)!).push(word.textContent!);
  }
  return Array.from(rows.values(),row=>row.join(' '));
 });
 expect(lines).toEqual(['"We are','swapping cars in','turn 14"']);
 send({...call,reply});
 await expect.poll(()=>page.evaluate(()=>{
  const {__raceState}=window as Window&{__raceState?:RaceState};
  return __raceState?.latestChatRadio?.a?.reply?.id;
 })).toBe(reply.id);
 await page.clock.runFor(2400);
 await expect(engineer).toBeVisible();
 await expect(radio).not.toContainText(reply.text);
 await expect(page.locator('#radio-announcement')).toHaveText(`Lewis Hamilton, car 44. Lap 1. ${call.text}`);
 await page.clock.runFor(2100);
 await expect(radio).toBeHidden();
 send({...call,reply});
 await expect(radio).toBeHidden();
});

test('painted Shanghai waveform heights match at 720p within one raster row',async({page,request})=>{
 const send=await raceFeed(page,request);
 await page.locator('#viewport').evaluate(el=>{el.style.width='1280px';el.style.height='720px';});
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 send(order(1,'a','We are swapping cars in turn 14'));
 const article=radio.locator('article');
 await article.evaluate(el=>{el.style.animation='none';});
 const offsets=[1640,2080,2120,2280,3320,3560,3680];
 const scores:number[]=[];
 let elapsed=0;
 for(const offset of offsets){
  await page.clock.runFor(offset-elapsed);
  elapsed=offset;
  const feed=await page.locator('#viewport').screenshot();
  const pixels=await sharp(feed).extract({left:1116,top:362,width:66,height:36}).removeAlpha().raw().toBuffer();
  const columns=Array.from({length:66},(_,x)=>{
   for(let y=0;y<36;y++){
    const index=(y*66+x)*3;
    const [red,green,blue]=pixels.subarray(index,index+3);
    if(red>85&&red-green>40&&red-blue>15)return 36-y;
   }
   return 0;
  }).sort((a,b)=>a-b);
  scores.push(Math.floor(columns[55]*.75+columns[56]*.25));
 }
 // Compositing can round a partially covered row differently at each height.
 const reference=[6,10,18,28,24,16,6];
 for(const [index,score] of scores.entries()){
  expect(Math.abs(score-reference[index]),`Waveform at ${offsets[index]} ms`).toBeLessThanOrEqual(1);
 }
});

test('voice events preserve the same waveform phase and caption clock as muted playback',async({page,request})=>{
 await page.addInitScript(()=>{
  let current:SpeechSynthesisUtterance|undefined;
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(readonly text:string){}}});
  Object.defineProperty(window,'speechSynthesis',{value:{
   getVoices:()=>[{lang:'en-GB',localService:true}],
   speak:(utterance:SpeechSynthesisUtterance)=>{current=utterance;},
   cancel:()=>{current=undefined;},
  }});
  window.addEventListener('test-radio-progress',event=>{
   if(!current)throw Error('No narration was queued');
   const step=(event as CustomEvent<'start'|number|'end'>).detail;
   if(step==='start')current.onstart?.(new Event('start') as SpeechSynthesisEvent);
   else if(step==='end')current.onend?.(new Event('end') as SpeechSynthesisEvent);
   else current.onboundary?.({name:'word',charIndex:step} as SpeechSynthesisEvent);
  });
 });
 const send=await raceFeed(page,request);
 await page.clock.install();
 await page.clock.pauseAt(new Date(Date.now()+1000));
 const line='Keep the tyres cool.';
 const radio=page.getByRole('region',{name:'ChatGPT radio'});
 send(order(1,'a',line));
 await expect(radio).toBeVisible();
 await page.clock.runFor(280);
 const peak=await waveform(page);
 expect(peak).toBeGreaterThanOrEqual(25);
 await page.clock.runFor(1360);
 const quiet=await waveform(page);
 expect(quiet).toBeLessThan(8);
 await page.getByRole('button',{name:'Enable sound'}).click();
 await expect(page.getByRole('button',{name:'Mute sound'})).toBeVisible();
 send(order(2,'a',line));
 await expect(radio.locator('.radio-transcript').first()).toBeVisible();
 await expect(radio.locator(visibleWords)).toHaveCount(1);
 const progress=(detail:'start'|number|'end')=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('test-radio-progress',{detail})),detail);
 await progress('start');
 await progress(0);
 await page.clock.runFor(280);
 expect(await waveform(page)).toBe(peak);
 await progress('end');
 await page.clock.runFor(100);
 await expect(radio.locator(visibleWords)).toHaveCount(4);
 await page.clock.runFor(1260);
 expect(await waveform(page)).toBe(quiet);
 await page.clock.runFor(3500);
 await expect(radio).toBeHidden();
 expect(await waveform(page)).toBe(2);
});
