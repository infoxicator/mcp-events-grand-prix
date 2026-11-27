export const AI_CONTROL_LABELS={
 tactical:'TACTICAL',
 raw:'EXP A · RAW',
 'step-locked':'EXP B · STEP-LOCK',
 'no-assist':'EXP C · NO-ASSIST',
} as const;

export type AiControlStyle=keyof typeof AI_CONTROL_LABELS;
export const AI_CONTROL_INFO:Record<AiControlStyle,{name:string;cadence:string;how:string}>={
 tactical:{
  name:'Tactical (Default)',
  cadence:'~600–800 ms · Track-assisted',
  how:'AI picks racing line, pace, braking aggression, ERS, and DRS. The 120 Hz track-follower handles steering, pedals, and traffic avoidance.',
 },
 raw:{
  name:'Exp A · Raw controls',
  cadence:'~140–250 ms · Real-time raw',
  how:'AI directly sets 7-step steering, throttle, brake, ERS, and DRS through the human physics path (pit assist only). Can miss corners, lock up, or crash.',
 },
 'step-locked':{
  name:'Exp B · Step-locked raw',
  cadence:'100 ms sim slice / call · Zero lag',
  how:'Same raw steering, throttle, and brake as Exp A, but physics advances 12 ticks (100 ms) per AI reply and pauses until the next decision arrives (3.5 s timeout fallback).',
 },
 'no-assist':{
  name:'Exp C · Hybrid no-assist',
  cadence:'~200–350 ms · Real-time no-assist',
  how:'Disables automatic traffic dodging. AI targets exact lanes (-5 m to +5 m, including kerbs) and pedal modes up to Overdrive (112% corner speed) — can divebomb, run wide, or collide.',
 },
};
export const isAiControlStyle=(value:unknown):value is AiControlStyle=>
 typeof value==='string'&&Object.hasOwn(AI_CONTROL_LABELS,value);

export const RAW_STEER={
 'hard-left':-1,left:-.6,'slight-left':-.25,straight:0,'slight-right':.25,right:.6,'hard-right':1,
} as const;
export const RAW_THROTTLE={none:0,half:.5,full:1} as const;
export const RAW_BRAKE={none:0,light:.45,hard:1} as const;
export const AI_LANES={'far-left':-5,left:-3,inside:-1.5,line:0,outside:1.5,right:3,'far-right':5} as const;
export const AI_PEDALS=['brake-hard','brake-light','coast','normal','push','overdrive'] as const;
export type AiPedal=typeof AI_PEDALS[number];

export type AiControl=
 |{style:'raw'|'step-locked';steer:keyof typeof RAW_STEER;throttle:keyof typeof RAW_THROTTLE;brake:keyof typeof RAW_BRAKE}
 |{style:'no-assist';lane:keyof typeof AI_LANES;pedal:AiPedal};
