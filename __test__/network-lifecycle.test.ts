import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {connect,DECIDE_INTERVAL_MS,FINISHED_IDLE_CLOSE_MS,HIDDEN_DISCONNECT_MS,MAX_HANDSHAKE_FAILURES,MAX_RECONNECT_ATTEMPTS,PING_INTERVAL_MS} from '../src/race/network';
import {ROOM_EXPIRED_CLOSE_CODE} from '../src/race/live';
import {createRace} from '../src/race/physics';
import type {HostedRoom,RaceState} from '../src/race/types';

vi.mock('cloudflare:workers',()=>({
 DurableObject:class {
  ctx:unknown;
  env:unknown;
  constructor(ctx:unknown,env:unknown){this.ctx=ctx;this.env=env;}
 },
}));

class FakeWebSocket {
 static readonly CONNECTING = 0;
 static readonly OPEN = 1;
 static readonly CLOSING = 2;
 static readonly CLOSED = 3;
 static instances: FakeWebSocket[] = [];

 readyState = FakeWebSocket.CONNECTING;
 sent: string[] = [];
 onopen: (() => void) | null = null;
 onmessage: ((ev: {data: string}) => void) | null = null;
 onclose: ((ev: {code: number; reason: string}) => void) | null = null;
 onerror: (() => void) | null = null;
 readonly url: string;

 constructor(url: URL | string) {
  this.url = String(url);
  FakeWebSocket.instances.push(this);
 }
 send(data: string) {
  this.sent.push(data);
 }
 open() {
  this.readyState = FakeWebSocket.OPEN;
  this.onopen?.();
 }
 receive(payload: unknown) {
  this.onmessage?.({data: JSON.stringify(payload)});
 }
 failHandshake() {
  this.onerror?.();
  if (this.readyState !== FakeWebSocket.CLOSED) {
   this.readyState = FakeWebSocket.CLOSED;
   this.onclose?.({code: 1006, reason: ''});
  }
 }
 drop(code: number, reason = '') {
  this.readyState = FakeWebSocket.CLOSED;
  this.onclose?.({code, reason});
 }
 close(code = 1000, reason = '') {
  if (this.readyState === FakeWebSocket.CLOSED) return;
  this.readyState = FakeWebSocket.CLOSED;
  this.onclose?.({code, reason});
 }
}

function makeDocument() {
 const listeners = new Map<string, Set<EventListener>>();
 let hidden = false;
 const dataset: Record<string, string | undefined> = {};
 return {
  get hidden() { return hidden; },
  setHidden(value: boolean) { hidden = value; },
  documentElement: { dataset },
  addEventListener(type: string, fn: EventListener) {
   let set = listeners.get(type);
   if (!set) { set = new Set(); listeners.set(type, set); }
   set.add(fn);
  },
  removeEventListener(type: string, fn: EventListener) {
   listeners.get(type)?.delete(fn);
  },
  dispatch(type: string) {
   for (const fn of [...(listeners.get(type) ?? [])]) fn(new Event(type));
  },
 };
}

function makeRoom(overrides: Partial<HostedRoom> = {}): HostedRoom {
 return {
  room: '11111111-1111-4111-8111-111111111111',
  token: 'a'.repeat(64),
  links: null,
  origin: 'https://jev-grand-prix.example.test',
  ...overrides,
 };
}

function makeState(overrides: Partial<RaceState> = {}): RaceState {
 const race = createRace(3, 'monza');
 return {
  type: 'state',
  room: '11111111-1111-4111-8111-111111111111',
  race,
  connected: {a: true, b: true},
  decisions: {a: null, b: null},
  intents: {a: 0, b: 0},
  engineerCalls: {a: 0, b: 0},
  driverStats: {a: {attempts: 0, successes: 0, fallbacks: 0}, b: {attempts: 0, successes: 0, fallbacks: 0}},
  matchup: 'jev-vs-jev',
  players: {
   a: {name: 'Jev', engine: 'jev', provider: 'mock', model: 'mock', mock: true, intervalMs: 200},
   b: {name: 'Jev', engine: 'jev', provider: 'mock', model: 'mock', mock: true, intervalMs: 200},
  },
  mode: 'mock',
  serverTime: Date.now(),
  physicsHz: 120,
  snapshotHz: 30,
  speed: 4,
  paidCalls: 0,
  ...overrides,
 };
}

describe('network lifecycle and rate limiting', () => {
 let fakeDoc: ReturnType<typeof makeDocument>;
 let winListeners: Map<string, Set<EventListener>>;
 const origWS = globalThis.WebSocket;
 const origDoc = globalThis.document;
 const origAdd = globalThis.addEventListener;
 const origRemove = globalThis.removeEventListener;
 const origFetch = globalThis.fetch;

 beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  fakeDoc = makeDocument();
  winListeners = new Map();
  (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
  (globalThis as Record<string, unknown>).document = fakeDoc;
  (globalThis as Record<string, unknown>).addEventListener = (type: string, fn: EventListener) => {
   let set = winListeners.get(type);
   if (!set) { set = new Set(); winListeners.set(type, set); }
   set.add(fn);
  };
  (globalThis as Record<string, unknown>).removeEventListener = (type: string, fn: EventListener) => {
   winListeners.get(type)?.delete(fn);
  };
  (globalThis as Record<string, unknown>).fetch = vi.fn(async () => new Response(JSON.stringify({error: 'Race expired'}), {status: 404}));
 });

 afterEach(() => {
  vi.useRealTimers();
  (globalThis as Record<string, unknown>).WebSocket = origWS;
  (globalThis as Record<string, unknown>).document = origDoc;
  (globalThis as Record<string, unknown>).addEventListener = origAdd;
  (globalThis as Record<string, unknown>).removeEventListener = origRemove;
  (globalThis as Record<string, unknown>).fetch = origFetch;
 });

 it('stops reconnecting permanently when room expires via 4410 or 1000 close', () => {
  const conn = connect(null, makeRoom());
  expect(FakeWebSocket.instances).toHaveLength(1);
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[0].drop(ROOM_EXPIRED_CLOSE_CODE, 'Room expired');
  expect(conn.status).toBe('RACE EXPIRED');
  vi.advanceTimersByTime(600_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
  conn.close();
 });

 it('stops reconnecting after a single /info 404 probe when handshake fails on an expired room', async () => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({error: 'Race expired'}), {status: 404}));
  (globalThis as Record<string, unknown>).fetch = fetchSpy;
  const conn = connect(null, makeRoom());
  expect(FakeWebSocket.instances).toHaveLength(1);
  FakeWebSocket.instances[0].failHandshake();
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(conn.status).toBe('RACE EXPIRED');
  await vi.advanceTimersByTimeAsync(600_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
  conn.close();
 });

 it('caps live-room handshake failures with exponential backoff instead of looping forever', async () => {
  const conn = connect(null, makeRoom({live: true}));
  for (let i = 0; i < MAX_HANDSHAKE_FAILURES; i++) {
   FakeWebSocket.instances[i].failHandshake();
   await vi.advanceTimersByTimeAsync(60_000);
  }
  expect(FakeWebSocket.instances).toHaveLength(MAX_HANDSHAKE_FAILURES);
  expect(conn.status).toBe('RACE EXPIRED');
  await vi.advanceTimersByTimeAsync(600_000);
  expect(FakeWebSocket.instances).toHaveLength(MAX_HANDSHAKE_FAILURES);
  conn.close();
 });

 it('caps repeated transient disconnects after MAX_RECONNECT_ATTEMPTS with backoff', () => {
  const conn = connect(null, makeRoom());
  for (let i = 0; i <= MAX_RECONNECT_ATTEMPTS; i++) {
   const sock = FakeWebSocket.instances[i];
   expect(sock).toBeDefined();
   sock.open();
   // Drop before joined so retry backoff accumulates across drops.
   sock.drop(1006);
   vi.advanceTimersByTime(40_000);
  }
  expect(FakeWebSocket.instances).toHaveLength(1 + MAX_RECONNECT_ATTEMPTS);
  expect(conn.status).toBe('DISCONNECTED');
  vi.advanceTimersByTime(600_000);
  expect(FakeWebSocket.instances).toHaveLength(1 + MAX_RECONNECT_ATTEMPTS);
  conn.close();
 });

 it('pauses messages immediately when hidden or mcpHidden, closes after grace, and resumes when visible', () => {
  const conn = connect('a', makeRoom());
  const ws1 = FakeWebSocket.instances[0];
  ws1.open();
  ws1.receive({type: 'joined', team: 'a', canReset: true});
  const racing = makeState();
  racing.race.phase = 'racing';
  ws1.receive(racing);
  const sentBeforeHide = ws1.sent.length;

  fakeDoc.documentElement.dataset.mcpHidden = 'true';
  fakeDoc.dispatch('mcp-visibility');
  vi.advanceTimersByTime(HIDDEN_DISCONNECT_MS - 100);
  expect(ws1.sent.length).toBe(sentBeforeHide); // zero pings or decides while hidden

  vi.advanceTimersByTime(200);
  expect(ws1.readyState).toBe(FakeWebSocket.CLOSED);
  expect(conn.status).toBe('PAUSED');
  vi.advanceTimersByTime(600_000);
  expect(FakeWebSocket.instances).toHaveLength(1); // never reconnects while hidden

  fakeDoc.documentElement.dataset.mcpHidden = 'false';
  fakeDoc.dispatch('mcp-visibility');
  expect(FakeWebSocket.instances).toHaveLength(2); // resumes once visible again
  conn.close();
 });

 it('stops pinging when a race finishes, auto-closes after idle grace, and reopens only on explicit replay/reset', () => {
  const conn = connect(null, makeRoom());
  const ws1 = FakeWebSocket.instances[0];
  ws1.open();
  ws1.receive({type: 'joined', team: null, canReset: true});
  const finished = makeState();
  finished.race.phase = 'finished';
  ws1.receive(finished);
  const sentAtFinish = ws1.sent.length;

  vi.advanceTimersByTime(FINISHED_IDLE_CLOSE_MS - 1000);
  expect(ws1.sent.length).toBe(sentAtFinish); // 0 pings sent while viewing finished results

  vi.advanceTimersByTime(2000);
  expect(ws1.readyState).toBe(FakeWebSocket.CLOSED);
  expect(conn.status).toBe('RACE FINISHED');

  vi.advanceTimersByTime(600_000);
  expect(FakeWebSocket.instances).toHaveLength(1); // stays closed indefinitely

  // Clicking replay explicitly reopens once and transmits replay
  conn.send({type: 'replay'});
  expect(FakeWebSocket.instances).toHaveLength(2);
  const ws2 = FakeWebSocket.instances[1];
  ws2.open();
  ws2.receive({type: 'joined', team: null, canReset: true});
  expect(ws2.sent.map(s => JSON.parse(s).type)).toContain('replay');
  conn.close();
 });

 it('eliminates SEAT TAKEN reconnect polling until state reports the seat is free', () => {
  const conn = connect('a', makeRoom());
  const ws1 = FakeWebSocket.instances[0];
  ws1.open();
  ws1.receive({type: 'joined', team: null, canReset: false, reason: 'SEAT TAKEN · SPECTATING'});
  ws1.receive(makeState({connected: {a: true, b: true}}));

  vi.advanceTimersByTime(60_000);
  expect(FakeWebSocket.instances).toHaveLength(1); // zero blind reconnects while seat is occupied

  ws1.receive(makeState({connected: {a: false, b: true}}));
  expect(FakeWebSocket.instances).toHaveLength(2); // single immediate reclaim once occupant leaves
  conn.close();
 });

 it('throttles ping to 10s and decide to 400ms and tears down on beforeunload', () => {
  const conn = connect('a', makeRoom());
  const ws1 = FakeWebSocket.instances[0];
  ws1.open();
  ws1.receive({type: 'joined', team: 'a', canReset: false});
  const racing = makeState();
  racing.race.phase = 'racing';
  ws1.receive(racing);

  vi.advanceTimersByTime(60_000);
  const types = ws1.sent.map(s => JSON.parse(s).type);
  const pings = types.filter(t => t === 'ping').length;
  const decides = types.filter(t => t === 'decide').length;
  expect(pings).toBe(Math.floor(60_000 / PING_INTERVAL_MS));
  expect(decides).toBeLessThanOrEqual(Math.ceil(60_000 / DECIDE_INTERVAL_MS) + 1);

  for (const fn of [...(winListeners.get('beforeunload') ?? [])]) fn(new Event('beforeunload'));
  expect(ws1.readyState).toBe(FakeWebSocket.CLOSED);
  void conn;
 });
});

describe('worker DO protection', () => {
 it('rejects non-Upgrade /ws requests without invoking DO and caches expired room IDs', async () => {
  const workerModulePath = '../worker/' + 'index';
  const {createWorker} = await import(/* @vite-ignore */ workerModulePath) as {createWorker: () => {fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response>}};
  let doCalls = 0;
  let roomExpired = true;
  const stub = {
   fetch: vi.fn(async (req: Request) => {
    doCalls++;
    const u = new URL(req.url);
    if (u.pathname.startsWith('/internal-create')) {
     roomExpired = false;
     const id = u.searchParams.get('room')!;
     return Response.json({links: {room: id, expiresAt: Date.now() + 60_000, owner: '', a: '', b: '', spectator: ''}, mcpToken: 'tok', state: {}});
    }
    if (roomExpired) {
     return Response.json({error: 'Race expired'}, {status: 404, headers: {'X-Race-Expired': '1'}});
    }
    if (u.pathname.endsWith('/status')) {
     return Response.json({error: 'Not found'}, {status: 404}); // e.g., live room /status 404 without X-Race-Expired
    }
    return new Response(null, {status: 200});
   }),
  };
  const env = {
   ROOMS: {
    idFromName: (id: string) => id,
    get: () => stub,
   },
   ROOM_CREATION: {limit: async () => ({success: true})},
   ASSETS: {fetch: async () => new Response('ok')},
  };
  const worker = createWorker();
  const roomId = '22222222-2222-4222-8222-222222222222';

  // Non-upgrade GET /ws returns 426 directly from Worker (0 DO calls)
  const badWs = await worker.fetch(new Request(`https://example.test/api/rooms/${roomId}/ws`), env, {});
  expect(badWs.status).toBe(426);
  expect(doCalls).toBe(0);

  // First expired WS upgrade hits DO once and caches expiry
  const expired1 = await worker.fetch(new Request(`https://example.test/api/rooms/${roomId}/ws`, {headers: {Upgrade: 'websocket'}}), env, {});
  expect(expired1.status).toBe(404);
  expect(doCalls).toBe(1);

  // Subsequent 50 zombie retries hit Worker cache only (0 additional DO calls!)
  for (let i = 0; i < 50; i++) {
   const expiredN = await worker.fetch(new Request(`https://example.test/api/rooms/${roomId}/ws`, {headers: {Upgrade: 'websocket'}}), env, {});
   expect(expiredN.status).toBe(404);
  }
  expect(doCalls).toBe(1);

  // Non-expired live room 404 on /status (without X-Race-Expired) is NOT cached as expired
  roomExpired = false;
  const liveRoomId = '33333333-3333-4333-8333-333333333333';
  const liveStatus = await worker.fetch(new Request(`https://example.test/api/rooms/${liveRoomId}/status`), env, {});
  expect(liveStatus.status).toBe(404);
  const liveWs = await worker.fetch(new Request(`https://example.test/api/rooms/${liveRoomId}/ws`, {headers: {Upgrade: 'websocket'}}), env, {});
  expect(liveWs.status).toBe(200);
  expect(doCalls).toBe(3);
 });
});
