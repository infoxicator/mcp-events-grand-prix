export const OWNER_LIVE_PATH = '/owner/live';
export const LIVE_PAIR_PATH = '/api/live-pair';
export const PAIR_TTL_MS = 5 * 60_000;
export const LIVE_TIME_MS = 5 * 60_000;
export const CHAT_STRATEGY_LAPS = 10;
export const CHAT_STRATEGY_MAX_LAPS = 20;
export const CHAT_STRATEGY_TIME_MS = 25 * 60_000;
export const strategyTimeBudgetMs = (laps: number) => Math.min(60 * 60_000, Math.max(CHAT_STRATEGY_TIME_MS, Math.ceil(laps * 2.5) * 60_000));
export const LIVE_CALL_LIMIT = 240;
export const LIVE_DRIVER_INTERVAL_MS = 1200;
export const ROOM_EXPIRED_CLOSE_CODE = 4410;
export const FINISHED_GRACE_MS = 5 * 60_000;
export const STRATEGY_LOBBY_TTL_MS = 15 * 60_000;
export const STRATEGY_IDLE_STOP_MS = 3 * 60_000;
export const STRATEGY_MAX_CONSECUTIVE_FAILURES = 3;

export type LivePhase = 'running' | 'finished' | 'stopped' | 'time-limit' | 'call-limit' | 'interrupted';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const isRoomId = (id: unknown): id is string => typeof id === 'string' && uuid.test(id);
export const isLiveKey = (key: unknown): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
export const newLiveKey = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export async function pairingChallenge(key: string) {
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))));
}

export interface LiveInvitation { room: string; key: string }
export const liveInvitation = ({room,key}: LiveInvitation) => `jev-live:${room}:${key}`;
export const strategySeatInvitation = ({room,key}: LiveInvitation) => `jev-strategy:${room}:${key}`;
export function parseStrategySeatInvitation(value:string):LiveInvitation|null{
 const text=value.trim().replace(/^`([^`]+)`$/,'$1');
 if(!text.startsWith('jev-strategy:'))return null;
 const [,room,key,extra]=text.split(':');
 if(!isRoomId(room)||!isLiveKey(key)||extra!==undefined)throw new Error('Use a complete Mercedes strategy invitation.');
 return {room,key};
}
export const ownerRaceURL = (origin: string, room: string) => `${origin}${OWNER_LIVE_PATH}?pair=${room}`;
export const liveSpectatorURL = (origin: string, {room,key}: LiveInvitation) => `${origin}/?live=${room}#token=${key}`;

export function parseLiveInvitation(value: string, origin: string): LiveInvitation | null {
 const text = value.trim().replace(/^`([^`]+)`$/, '$1');
 if (text.startsWith('jev-live:')) {
  const [,room,key,extra] = text.split(':');
  if (!isRoomId(room) || !isLiveKey(key) || extra !== undefined) throw new Error('Use a complete live race invitation.');
  return {room,key};
 }
 if (!URL.canParse(text)) return null;
 const url = new URL(text), room = url.searchParams.get('live');
 if (room === null) return null;
 const key = new URLSearchParams(url.hash.slice(1)).get('token');
 if (url.origin !== origin || url.pathname !== '/' || url.username || url.password || !isRoomId(room) || !isLiveKey(key)) {
  throw new Error('Use a live spectator link from this server.');
 }
 return {room,key};
}

export const liveLabel: Record<LivePhase,string> = {
 running:'Private live race · Spectator',
 finished:'Live race finished',
 stopped:'Live race stopped by owner',
 'time-limit':'Live race time limit reached',
 'call-limit':'Live race call limit reached',
 interrupted:'Live race interrupted',
};

export function raceSessionLabel(phase:LivePhase,strategyPractice?:boolean,guest=false){
 if(!strategyPractice)return liveLabel[phase];
 if(phase==='running')return guest?'ChatGPT strategy · Ferrari & Mercedes':'ChatGPT strategy · Solo Ferrari';
 if(phase==='stopped')return 'ChatGPT strategy race stopped';
 return liveLabel[phase];
}
