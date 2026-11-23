import type {PlayerInputs} from './drive-physics';

export interface DriveActionCallbacks {
 onCamera: () => void;
 onFlashback: () => void;
 onPause: () => void;
 onMfdCycle: () => void;
 onBoxToggle: () => void;
 onCompoundCycle: () => void;
 onErsMode: (dir: 1 | -1) => void;
 onBrakeBias: (delta: number) => void;
 onHaloToggle: () => void;
 onRacingLineToggle: () => void;
 onAudioToggle: () => void;
}

export interface TouchInputState {
 throttle: number;
 brake: number;
 steer: number;
 ersOvertake: boolean;
 drsPulse: boolean;
 shiftUpPulse: boolean;
 shiftDownPulse: boolean;
 lookBack: boolean;
}

export interface DriveControlState {
 inputs: PlayerInputs;
 lookBack: boolean;
 gamepadName: string | null;
}

export interface DriveControls {
 poll(dt: number, active: boolean): DriveControlState;
 rumble(strong: number, weak: number, durationMs?: number): void;
 readonly touch: TouchInputState;
 clearPulses(): void;
 dispose(): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function applyDeadzone(raw: number, deadzone = 0.07, linearity = 1.38): number {
 const abs = Math.abs(raw);
 if (abs <= deadzone) return 0;
 const norm = (abs - deadzone) / (1 - deadzone);
 return Math.sign(raw) * Math.pow(clamp(norm, 0, 1), linearity);
}

export function createDriveControls(callbacks: DriveActionCallbacks): DriveControls {
 const keys = new Set<string>();
 const ac = new AbortController();
 const {signal} = ac;

 // Edge-triggered pulses consumed on the next physics poll
 let drsPulse = false;
 let shiftUpPulse = false;
 let shiftDownPulse = false;

 // Smooth digital keyboard ramps so keyboard driving feels responsive without harsh snapping
 let keyThrottle = 0;
 let keyBrake = 0;
 let keySteer = 0;

 // Track previous gamepad button states for edge detection
 const prevButtons = new Map<number, boolean>();
 let activeGamepadIndex: number | null = null;
 let activeGamepadName: string | null = null;
 let lastRumbleAt = 0;

 const touch: TouchInputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  ersOvertake: false,
  drsPulse: false,
  shiftUpPulse: false,
  shiftDownPulse: false,
  lookBack: false,
 };

 function isTypingTarget(target: EventTarget | null): boolean {
  return (
   target instanceof HTMLInputElement ||
   target instanceof HTMLSelectElement ||
   target instanceof HTMLTextAreaElement
  );
 }

 const PREVENT_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Backspace',
 ]);

 window.addEventListener(
  'keydown',
  e => {
   if (e.metaKey || e.ctrlKey || e.altKey) return;
   if (isTypingTarget(e.target)) return;
   if (PREVENT_CODES.has(e.code)) e.preventDefault();

   const firstPress = !e.repeat && !keys.has(e.code);
   keys.add(e.code);
   if (!firstPress) return;

   switch (e.code) {
    case 'Escape':
     callbacks.onPause();
     break;
    case 'Space':
    case 'KeyF':
     drsPulse = true;
     break;
    case 'KeyE':
    case 'KeyX':
    case 'PageUp':
     shiftUpPulse = true;
     break;
    case 'KeyQ':
    case 'KeyZ':
    case 'PageDown':
     shiftDownPulse = true;
     break;
    case 'KeyC':
     callbacks.onCamera();
     break;
    case 'KeyR':
    case 'Backspace':
     callbacks.onFlashback();
     break;
    case 'KeyM':
     callbacks.onMfdCycle();
     break;
    case 'KeyP':
     callbacks.onBoxToggle();
     break;
    case 'KeyT':
     callbacks.onCompoundCycle();
     break;
    case 'Digit1':
    case 'KeyJ':
     callbacks.onErsMode(-1);
     break;
    case 'Digit2':
    case 'KeyK':
     callbacks.onErsMode(1);
     break;
    case 'BracketLeft':
     callbacks.onBrakeBias(-1);
     break;
    case 'BracketRight':
     callbacks.onBrakeBias(1);
     break;
    case 'KeyH':
     callbacks.onHaloToggle();
     break;
    case 'KeyL':
     callbacks.onRacingLineToggle();
     break;
    case 'KeyV':
     callbacks.onAudioToggle();
     break;
   }
  },
  {signal},
 );

 window.addEventListener(
  'keyup',
  e => {
   keys.delete(e.code);
  },
  {signal},
 );

 window.addEventListener(
  'blur',
  () => {
   keys.clear();
   keyThrottle = 0;
   keyBrake = 0;
   keySteer = 0;
  },
  {signal},
 );

 window.addEventListener(
  'gamepadconnected',
  e => {
   activeGamepadIndex = e.gamepad.index;
   activeGamepadName = e.gamepad.id;
  },
  {signal},
 );

 window.addEventListener(
  'gamepaddisconnected',
  e => {
   if (activeGamepadIndex === e.gamepad.index) {
    activeGamepadIndex = null;
    activeGamepadName = null;
    prevButtons.clear();
   }
  },
  {signal},
 );

 function findGamepad(): Gamepad | null {
  if (!navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  if (activeGamepadIndex !== null) {
   const pad = pads[activeGamepadIndex];
   if (pad && pad.connected) return pad;
  }
  for (const pad of pads) {
   if (pad && pad.connected) {
    activeGamepadIndex = pad.index;
    activeGamepadName = pad.id;
    return pad;
   }
  }
  activeGamepadName = null;
  return null;
 }

 function edgeButton(pad: Gamepad, idx: number): boolean {
  const down = Boolean(pad.buttons[idx]?.pressed);
  const was = prevButtons.get(idx) ?? false;
  prevButtons.set(idx, down);
  return down && !was;
 }

 function poll(dt: number, active: boolean): DriveControlState {
  const step = clamp(dt, 0.001, 0.05);
  const pad = findGamepad();

  // Handle gamepad edge-triggered buttons even when paused (so Start unpauses)
  let padDrs = false;
  let padShiftUp = false;
  let padShiftDown = false;
  let padLookBack = false;
  let padThrottle = 0;
  let padBrake = 0;
  let padSteer = 0;
  let padOvertake = false;

  if (pad) {
   if (edgeButton(pad, 9)) callbacks.onPause(); // Start / Options
   if (active) {
    padDrs = edgeButton(pad, 3); // Y / Triangle
    padShiftUp = edgeButton(pad, 5); // RB / R1
    padShiftDown = edgeButton(pad, 4); // LB / L1
    if (edgeButton(pad, 2)) callbacks.onFlashback(); // X / Square
    if (edgeButton(pad, 8)) callbacks.onCamera(); // Back / Share
    if (edgeButton(pad, 1)) callbacks.onMfdCycle(); // B / Circle
    if (edgeButton(pad, 12)) callbacks.onErsMode(1); // D-Pad Up
    if (edgeButton(pad, 13)) callbacks.onErsMode(-1); // D-Pad Down
    if (edgeButton(pad, 14)) callbacks.onBrakeBias(-1); // D-Pad Left
    if (edgeButton(pad, 15)) callbacks.onBrakeBias(1); // D-Pad Right
   } else {
    // Still track button state so releasing while unpausing doesn't misfire
    for (const idx of [1, 2, 3, 4, 5, 8, 12, 13, 14, 15]) edgeButton(pad, idx);
   }

   padThrottle = clamp(pad.buttons[7]?.value ?? 0, 0, 1); // RT / R2
   padBrake = clamp(pad.buttons[6]?.value ?? 0, 0, 1); // LT / L2
   // Gamepad Left Stick X: left is -1, right is +1 -> negate so left is +1
   padSteer = applyDeadzone(-(pad.axes[0] ?? 0));
   padOvertake = Boolean(pad.buttons[0]?.pressed); // A / Cross (hold)
   padLookBack = Boolean(pad.buttons[11]?.pressed); // R3
  }

  // Digital keyboard inputs with fast, progressive ramp
  const rawThrottle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  const rawBrake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  const steerLeft = keys.has('KeyA') || keys.has('ArrowLeft');
  const steerRight = keys.has('KeyD') || keys.has('ArrowRight');
  const rawSteer = (steerLeft ? 1 : 0) - (steerRight ? 1 : 0);

  const throttleRate = rawThrottle > keyThrottle ? 7.5 : 10.5;
  keyThrottle += (rawThrottle - keyThrottle) * Math.min(1, step * throttleRate);
  if (Math.abs(keyThrottle - rawThrottle) < 0.01) keyThrottle = rawThrottle;

  const brakeRate = rawBrake > keyBrake ? 8.5 : 11.5;
  keyBrake += (rawBrake - keyBrake) * Math.min(1, step * brakeRate);
  if (Math.abs(keyBrake - rawBrake) < 0.01) keyBrake = rawBrake;

  const steerRate = rawSteer === 0 ? 11.0 : Math.sign(rawSteer) !== Math.sign(keySteer) ? 13.0 : 6.4;
  keySteer += (rawSteer - keySteer) * Math.min(1, step * steerRate);
  if (Math.abs(keySteer - rawSteer) < 0.01) keySteer = rawSteer;

  const throttle = clamp(Math.max(keyThrottle, padThrottle, touch.throttle), 0, 1);
  const brake = clamp(Math.max(keyBrake, padBrake, touch.brake), 0, 1);

  const analogActive = Math.abs(padSteer) > 0.01 || Math.abs(touch.steer) > 0.01;
  const steer =
   Math.abs(padSteer) > 0.01
    ? padSteer
    : Math.abs(touch.steer) > 0.01
      ? touch.steer
      : clamp(keySteer, -1, 1);

  const ersOvertake =
   keys.has('ShiftLeft') ||
   keys.has('ShiftRight') ||
   keys.has('KeyO') ||
   padOvertake ||
   touch.ersOvertake;

  const lookBack = keys.has('KeyB') || keys.has('KeyN') || padLookBack || touch.lookBack;

  const inputs: PlayerInputs = {
   throttle,
   brake,
   steer,
   ersOvertake,
   drsToggle: drsPulse || padDrs || touch.drsPulse,
   shiftUp: shiftUpPulse || padShiftUp || touch.shiftUpPulse,
   shiftDown: shiftDownPulse || padShiftDown || touch.shiftDownPulse,
   analogSteer: analogActive,
  };

  drsPulse = false;
  shiftUpPulse = false;
  shiftDownPulse = false;
  touch.drsPulse = false;
  touch.shiftUpPulse = false;
  touch.shiftDownPulse = false;

  return {
   inputs,
   lookBack,
   gamepadName: activeGamepadName,
  };
 }

 function rumble(strong: number, weak: number, durationMs = 70) {
  const now = performance.now();
  if (now - lastRumbleAt < 45) return;
  const pad = findGamepad() as (Gamepad & {
   vibrationActuator?: {
    playEffect?: (
     type: string,
     params: {
      startDelay: number;
      duration: number;
      weakMagnitude: number;
      strongMagnitude: number;
     },
    ) => Promise<void>;
   };
  }) | null;
  if (!pad?.vibrationActuator?.playEffect) return;
  const s = clamp(strong, 0, 1);
  const w = clamp(weak, 0, 1);
  if (s < 0.04 && w < 0.04) return;
  lastRumbleAt = now;
  pad.vibrationActuator
   .playEffect('dual-rumble', {
    startDelay: 0,
    duration: durationMs,
    weakMagnitude: w,
    strongMagnitude: s,
   })
   .catch(() => {});
 }

 function clearPulses() {
  drsPulse = false;
  shiftUpPulse = false;
  shiftDownPulse = false;
  touch.drsPulse = false;
  touch.shiftUpPulse = false;
  touch.shiftDownPulse = false;
 }

 function dispose() {
  ac.abort();
  keys.clear();
  prevButtons.clear();
 }

 return {poll, rumble, touch, clearPulses, dispose};
}
