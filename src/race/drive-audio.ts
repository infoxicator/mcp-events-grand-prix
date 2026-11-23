export interface DriveAudioSample {
 rpm: number;
 speed: number; // m/s
 throttle: number; // 0..1
 brake: number; // 0..1
 gear: number; // -1..8
 wheelspin: number; // 0..1
 lockup: number; // 0..1
 offTrack: boolean;
 onKerb: boolean;
 ersDeploying: boolean;
 onRevLimiter: boolean;
 active: boolean;
}

export interface DriveAudio {
 unlock(): void;
 setEnabled(on: boolean): void;
 isEnabled(): boolean;
 setVolume(v: number): void;
 update(sample: DriveAudioSample): void;
 playStartBeep(lightsOut: boolean): void;
 playDrsBeep(): void;
 playImpact(severity: number): void;
 playFlashback(): void;
 dispose(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createDriveAudio(): DriveAudio {
 let ctx: AudioContext | null = null;
 let master: GainNode | null = null;
 let oscMain: OscillatorNode | null = null;
 let oscSub: OscillatorNode | null = null;
 let oscHarm: OscillatorNode | null = null;
 let engineFilter: BiquadFilterNode | null = null;
 let engineGain: GainNode | null = null;

 let mguOsc: OscillatorNode | null = null;
 let mguGain: GainNode | null = null;

 let windGain: GainNode | null = null;
 let windFilter: BiquadFilterNode | null = null;

 let tyreGain: GainNode | null = null;
 let tyreFilter: BiquadFilterNode | null = null;

 let kerbGain: GainNode | null = null;
 let kerbOsc: OscillatorNode | null = null;

 let enabled = true;
 let volume = 0.36;
 let lastGear = 1;
 let shiftCutUntil = 0;

 function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
   window.AudioContext ||
   (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return null;
  try {
   ctx = new Ctor();
  } catch {
   return null;
  }

  master = ctx.createGain();
  master.gain.value = enabled ? volume : 0;
  master.connect(ctx.destination);

  // V6 hybrid engine bank (1.6L V6 fires 3x per rev -> f = rpm / 20)
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 950;
  engineFilter.Q.value = 2.6;

  engineGain = ctx.createGain();
  engineGain.gain.value = 0.0001;
  engineFilter.connect(engineGain);
  engineGain.connect(master);

  oscMain = ctx.createOscillator();
  oscMain.type = 'sawtooth';
  oscMain.frequency.value = 180;
  oscMain.connect(engineFilter);

  oscSub = ctx.createOscillator();
  oscSub.type = 'triangle';
  oscSub.frequency.value = 90;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.65;
  oscSub.connect(subGain);
  subGain.connect(engineFilter);

  oscHarm = ctx.createOscillator();
  oscHarm.type = 'sawtooth';
  oscHarm.frequency.value = 360;
  const harmGain = ctx.createGain();
  harmGain.gain.value = 0.24;
  oscHarm.connect(harmGain);
  harmGain.connect(engineFilter);

  // MGU-H / MGU-K electric whine
  mguOsc = ctx.createOscillator();
  mguOsc.type = 'sine';
  mguOsc.frequency.value = 1400;
  mguGain = ctx.createGain();
  mguGain.gain.value = 0.0001;
  mguOsc.connect(mguGain);
  mguGain.connect(master);

  // Shared white noise buffer for wind + tyre screech
  const bufLen = ctx.sampleRate * 2;
  const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const windSrc = ctx.createBufferSource();
  windSrc.buffer = noiseBuf;
  windSrc.loop = true;
  windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 500;
  windFilter.Q.value = 0.8;
  windGain = ctx.createGain();
  windGain.gain.value = 0.0001;
  windSrc.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(master);

  const tyreSrc = ctx.createBufferSource();
  tyreSrc.buffer = noiseBuf;
  tyreSrc.loop = true;
  tyreFilter = ctx.createBiquadFilter();
  tyreFilter.type = 'bandpass';
  tyreFilter.frequency.value = 1650;
  tyreFilter.Q.value = 6.5;
  tyreGain = ctx.createGain();
  tyreGain.gain.value = 0.0001;
  tyreSrc.connect(tyreFilter);
  tyreFilter.connect(tyreGain);
  tyreGain.connect(master);

  // Kerb / gravel rumble
  kerbOsc = ctx.createOscillator();
  kerbOsc.type = 'square';
  kerbOsc.frequency.value = 48;
  const kerbFilter = ctx.createBiquadFilter();
  kerbFilter.type = 'lowpass';
  kerbFilter.frequency.value = 160;
  kerbGain = ctx.createGain();
  kerbGain.gain.value = 0.0001;
  kerbOsc.connect(kerbFilter);
  kerbFilter.connect(kerbGain);
  kerbGain.connect(master);

  oscMain.start();
  oscSub.start();
  oscHarm.start();
  mguOsc.start();
  windSrc.start();
  tyreSrc.start();
  kerbOsc.start();

  return ctx;
 }

 function unlock() {
  const c = ensureContext();
  if (c && c.state === 'suspended') {
   c.resume().catch(() => {});
  }
 }

 function setEnabled(on: boolean) {
  enabled = on;
  if (enabled) unlock();
  if (ctx && master) {
   master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.04);
  }
 }

 function setVolume(v: number) {
  volume = clamp(v, 0, 1);
  if (ctx && master && enabled) {
   master.gain.setTargetAtTime(volume, ctx.currentTime, 0.04);
  }
 }

 function update(s: DriveAudioSample) {
  if (!ctx || !enabled || ctx.state !== 'running') return;
  const now = ctx.currentTime;

  if (!s.active) {
   engineGain!.gain.setTargetAtTime(0.0001, now, 0.08);
   mguGain!.gain.setTargetAtTime(0.0001, now, 0.08);
   windGain!.gain.setTargetAtTime(0.0001, now, 0.08);
   tyreGain!.gain.setTargetAtTime(0.0001, now, 0.08);
   kerbGain!.gain.setTargetAtTime(0.0001, now, 0.08);
   return;
  }

  // Detect gear shift for crisp F1 seamless-shift ignition cut
  if (s.gear !== lastGear && s.gear > 0 && lastGear > 0) {
   shiftCutUntil = now + 0.042;
  }
  lastGear = s.gear;

  const rpm = clamp(s.rpm, 3200, 13400);
  // V6 3-per-rev firing frequency (~180 Hz idle -> ~660 Hz at 13,200 RPM)
  const limiterFlutter = s.onRevLimiter ? (Math.sin(now * 95) > 0 ? 1 : 0.92) : 1;
  const baseFreq = (rpm / 20) * limiterFlutter;

  oscMain!.frequency.setTargetAtTime(baseFreq, now, 0.025);
  oscSub!.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.025);
  oscHarm!.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.025);

  const load = 0.35 + s.throttle * 0.65;
  const cutoff = 520 + (rpm / 13200) * 2600 * load;
  engineFilter!.frequency.setTargetAtTime(cutoff, now, 0.03);

  const inCut = now < shiftCutUntil;
  const targetEngine = inCut ? 0.05 : 0.14 + s.throttle * 0.14 + (rpm / 13200) * 0.09;
  engineGain!.gain.setTargetAtTime(targetEngine, now, inCut ? 0.008 : 0.035);

  // MGU-H / MGU-K whine
  const speedRatio = clamp(s.speed / 95, 0, 1);
  const mguFreq = 1150 + (rpm / 13200) * 1850 + (s.ersDeploying ? 420 : 0);
  mguOsc!.frequency.setTargetAtTime(mguFreq, now, 0.04);
  const mguVol = s.ersDeploying
   ? 0.065
   : s.brake > 0.2 && s.speed > 18
     ? 0.035 * s.brake
     : 0.014 + s.throttle * 0.018;
  mguGain!.gain.setTargetAtTime(mguVol, now, 0.05);

  // Aero wind rush
  windFilter!.frequency.setTargetAtTime(340 + speedRatio * 1300, now, 0.06);
  windGain!.gain.setTargetAtTime(speedRatio * speedRatio * 0.11, now, 0.06);

  // Tyre screech (wheelspin + front brake lockup)
  const slip = clamp(Math.max(s.wheelspin, s.lockup), 0, 1);
  tyreFilter!.frequency.setTargetAtTime(1400 + slip * 750, now, 0.04);
  tyreGain!.gain.setTargetAtTime(slip > 0.1 ? slip * 0.12 : 0.0001, now, 0.035);

  // Kerb / off-track rumble
  const rumbleLevel = s.offTrack
   ? Math.min(0.14, 0.03 + speedRatio * 0.12)
   : s.onKerb
     ? Math.min(0.11, 0.02 + speedRatio * 0.09)
     : 0.0001;
  kerbOsc!.frequency.setTargetAtTime(s.offTrack ? 34 + speedRatio * 28 : 54 + speedRatio * 42, now, 0.04);
  kerbGain!.gain.setTargetAtTime(rumbleLevel, now, 0.03);
 }

 function playTone(freq: number, duration: number, gainPeak: number, type: OscillatorType = 'sine', delay = 0) {
  if (!enabled) return;
  const c = ensureContext();
  if (!c || !master || c.state !== 'running') return;
  const now = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(gainPeak, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.02);
 }

 function playStartBeep(lightsOut: boolean) {
  if (lightsOut) {
   playTone(987.77, 0.38, 0.24, 'triangle', 0);
  } else {
   playTone(659.25, 0.13, 0.18, 'triangle', 0);
  }
 }

 function playDrsBeep() {
  playTone(1860, 0.055, 0.11, 'sine', 0);
  playTone(2340, 0.075, 0.13, 'sine', 0.065);
 }

 function playImpact(severity: number) {
  if (!enabled) return;
  const c = ensureContext();
  if (!c || !master || c.state !== 'running') return;
  const s = clamp(severity, 0.15, 1);
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(125 + s * 60, now);
  osc.frequency.exponentialRampToValueAtTime(28, now + 0.22);
  g.gain.setValueAtTime(0.28 * s, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + 0.26);
 }

 function playFlashback() {
  if (!enabled) return;
  const c = ensureContext();
  if (!c || !master || c.state !== 'running') return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(920, now);
  osc.frequency.exponentialRampToValueAtTime(240, now + 0.26);
  g.gain.setValueAtTime(0.16, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + 0.3);
 }

 function dispose() {
  if (ctx) {
   ctx.close().catch(() => {});
   ctx = null;
  }
 }

 return {
  unlock,
  setEnabled,
  isEnabled: () => enabled,
  setVolume,
  update,
  playStartBeep,
  playDrsBeep,
  playImpact,
  playFlashback,
  dispose,
 };
}
