import {moveMapDot,setTextIfChanged,setAttributeIfChanged} from './hud-dom';
import {AI_CONTROL_LABELS} from './ai-controls';
import './drive.css';
import {damageLevel} from './crashes';
import {damageRepairSeconds, drsAllowed, DT} from './physics';
import {formatLap, type GearboxMode, type TractionControl} from './drive-physics';
import {createDriveControls} from './drive-controls';
import {createDriveAudio} from './drive-audio';
import {createScene, type CameraMode} from './scene';
import {mountTcamTelemetry} from './tcam-telemetry';
import {connect, createInterpolator, type Connection} from './network';
import {mountEventLog} from './event-log-view';
import {mountDriverRadio, type SendDriverQuestion} from './driver-radio';
import {blendRace} from './presentation-motion';
import {getTrack, isCircuit, type CircuitId} from './track';
import {classification, constructors, opponents, playerEntry} from './grid';
import {raceControlTelemetry, rainLabel, type Hazard, type RainLevel} from './race-control';
import {
 PERSONAS,
 type Compound,
 type DriverControlMode,
 type EngineerControlMode,
 type ErsMode,
 type HostedRoom,
 type HumanControlInput,
 type Race,
 type RaceState,
 type RoomLinks,
 type Team,
} from './types';
import type {RacingLineMode} from './racing-line';

type DriveCameraKind = 'tcam' | 'cockpit' | 'chase' | 'nose';

const CAMERA_CYCLE: readonly DriveCameraKind[] = ['tcam', 'cockpit', 'chase', 'nose'];
const CAMERA_LABELS: Record<DriveCameraKind, string> = {
 tcam: 'T-CAM',
 cockpit: 'COCKPIT',
 chase: 'CHASE',
 nose: 'NOSE',
};
const DRIVER_CYCLE: readonly DriverControlMode[] = ['human', 'jev', 'autopilot'];
const EMBEDDED_DRIVER_CYCLE: readonly DriverControlMode[] = ['human', 'autopilot'];
const DRIVER_LABELS: Record<DriverControlMode, string> = {
 human: 'YOU',
 jev: 'JEV',
 luna: 'LUNA',
 autopilot: 'AUTOPILOT',
};
const LINE_CYCLE: readonly RacingLineMode[] = ['full', 'corners', 'off'];
const ERS_CYCLE: readonly ErsMode[] = ['harvest', 'balanced', 'deploy'];
const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard', 'intermediate', 'wet'];
const COMPOUND_SHORT: Record<Compound, string> = {
 soft: 'S',
 medium: 'M',
 hard: 'H',
 intermediate: 'I',
 wet: 'W',
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function escapeHtml(text: string): string {
 return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface DriveMountOptions {
 circuit?: CircuitId;
 audioOutput?: AudioContext|null;
 team?: Team;
 embedded?: boolean;
 canStart?: () => boolean;
 startReady?: (state: RaceState) => boolean;
 onStart?: () => void;
 autostart?: boolean;
 sendDriverQuestion?: SendDriverQuestion | null;
}

export function mountDrive(room: HostedRoom, options: DriveMountOptions = {}): {connection: Connection; suspend3D: () => void; dispose: () => void} {
 const params = new URLSearchParams(location.search);
 const embedded = options.embedded === true;
 const seat: Team = options.team ?? (params.get('team') === 'b' ? 'b' : 'a');
 const initialDriverParam = embedded ? null : params.get('driver');
 const initialEngineerParam = embedded ? null : params.get('engineer');
 const autostart = options.autostart ?? params.has('autostart');

 let cameraKind: DriveCameraKind = 'tcam';
 let racingLineMode: RacingLineMode = 'full';
 let gearbox: GearboxMode = 'auto';
 let tractionControl: TractionControl = 'medium';
 let absEnabled = true;
 let pitAssist = true;
 let brakeBias = 56;
 let manualGear = 1;
 let manualDrs = false;
 let localErsMode: ErsMode | undefined;
 let nextCompound: Compound = seat === 'a' ? 'hard' : 'soft';
 let mfdTab: 'car' | 'pit' | 'room' = 'car';
 let menuOpen = false;
 let disposed = false;
 let frameId = 0;
 let lastFrameAt = performance.now();
 let lastControlSentAt = 0;
 let lastControlSignature = '';
 let lastHudAt = 0;
 let lastRadioId = 0;
 let radioBannerUntil = 0;
 let lastEventId = 0;
 let alertText = '';
 let alertTone: 'info' | 'green' | 'amber' | 'red' | 'purple' = 'info';
 let alertUntil = 0;
 let prevLightsLit = 0;
 let prevPhase: Race['phase'] | undefined;
 let prevDriverMode: DriverControlMode | undefined;
 let initialModesSent = false;
 let autostartSent = false;
 let replayFrames: Race[] = [];
 let replayActive = false;
 let replayStartAt = 0;
 let lastStandingsHtml = '';
 let standingGaps: Element[] = [];
 let lastResultsHtml = '';

 let conn = connect(seat, room, {
  role: 'driver',
  shouldDecide: (s) => !embedded && (s.driverMode?.[seat] ?? 'jev') === 'jev',
 });
 let promotingRoom: Promise<HostedRoom> | null = null;
 let promotedPending: {driverMode: DriverControlMode; engineerMode: EngineerControlMode; start: boolean} | null = null;
 const interpolate = createInterpolator(0.045);

 const engineerUrl = () => {
  const base = room.links?.[seat] ?? `${location.origin}/?room=${room.room}&team=${seat}#token=${room.token}`;
  const u = new URL(base, location.origin);
  u.searchParams.set('engineer', '');
  return u.href;
 };
 const broadcastUrl = () => room.links?.spectator ?? `${location.origin}/?room=${room.room}&spectate`;
 const pitWallUrl = () => room.links?.[seat] ?? `${location.origin}/?room=${room.room}&team=${seat}#token=${room.token}`;

 const app = document.getElementById('app')!;
 app.innerHTML = `
 <div class="drive-mode" id="drive-root" data-seat="${seat}"${embedded ? ' data-embedded="true"' : ''}${room.live ? ' data-live="true"' : ''}>
  <div class="drive-viewport" id="drive-viewport">
   <div class="drive-loading" id="drive-loading">
    <div class="drive-eyebrow">MCP GRAND PRIX · DRIVE MODE</div>
    <p id="drive-loading-text">Connecting to race room &amp; loading 3D circuit…</p>
   </div>
  </div>

  <div class="drive-hud" id="drive-hud" hidden>
   <div class="drive-topbar">
    <div class="drive-brand-nav">
     <a class="drive-home-link" href="/" title="Back to MCP Grand Prix">MCP <b>GP</b></a>
     <span class="drive-conn-pill" id="drive-conn-pill">CONNECTING</span>
     <div class="drive-corner-pill">
      <span id="drive-circuit-tag">MONZA</span>
      <b id="drive-corner-name">Start / Finish</b>
     </div>
    </div>

    <div class="drive-mode-switcher" id="drive-mode-switcher" role="group" aria-label="Driver control mode">
     <button type="button" data-dmode="human" class="active" title="Drive manually (G to cycle)">YOU</button>
     <button type="button" data-dmode="jev" title="Let Jev AI drive your car (G to cycle)">JEV</button>
     <button type="button" data-dmode="autopilot" title="Let car drive itself on optimal racing line (G to cycle)">AUTOPILOT</button>
    </div>

    <div class="drive-quick-actions">
     <button type="button" class="drive-eng-pill" id="drive-eng-pill" data-state="mock" title="Click to configure or open Strategy Engineer Pit Wall">
      <i class="dot"></i><span id="drive-eng-label">ENG: MOCKED</span>
     </button>
     <button type="button" class="drive-chip-btn" id="drive-cam-btn" title="Cycle camera (C)">CAM: <b id="drive-cam-label">T-CAM</b> <kbd>C</kbd></button>
     <button type="button" class="drive-chip-btn" id="drive-line-btn" title="Dynamic Racing Line (L)">LINE: <b id="drive-line-label">FULL</b> <kbd>L</kbd></button>
     <button type="button" class="drive-chip-btn" id="drive-audio-btn" title="Toggle V6 Hybrid Audio">SOUND: <b id="drive-audio-label">ON</b></button>
     <button type="button" class="drive-chip-btn" id="drive-menu-btn" title="Menu / Lobby (ESC)">MENU <kbd>ESC</kbd></button>
    </div>
   </div>

   <div class="drive-radio-stack" id="drive-radio-stack">
    <div class="drive-strategy-strip" id="drive-strategy-strip">
     <span class="dst-tag" id="dst-pace">PACE: BALANCED</span>
     <span class="dst-tag" id="dst-ers">ERS: BALANCED</span>
     <span class="dst-tag" id="dst-tactic">HOLD</span>
     <span class="dst-box" id="dst-box" hidden>BOX THIS LAP</span>
    </div>
    ${room.live ? '<section class="drive-team-radio" id="drive-team-radio" aria-labelledby="drive-team-radio-title" hidden></section>' : ''}
    <div class="drive-radio-banner" id="drive-radio-banner" hidden>
     <div class="drb-head">
      <span class="drb-speaker" id="drb-speaker">STRATEGY ENGINEER</span>
      <span class="drb-source" id="drb-source">MOCKED</span>
      <span class="drb-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
     </div>
     <p class="drb-text" id="drb-text"></p>
    </div>
   </div>

   <div class="drive-lights-gantry" id="drive-lights" hidden>
    <div class="drive-lights-bar">
     <div class="drive-light-pod"><i></i><i></i></div>
     <div class="drive-light-pod"><i></i><i></i></div>
     <div class="drive-light-pod"><i></i><i></i></div>
     <div class="drive-light-pod"><i></i><i></i></div>
     <div class="drive-light-pod"><i></i><i></i></div>
    </div>
    <div class="drive-launch-guide">
     <div class="drive-launch-label" id="drive-launch-label">HOLD YOUR BREATH — LIGHTS SEQUENCE</div>
    </div>
   </div>

   <div class="drive-alert" id="drive-alert" hidden></div>
   <div class="drive-rear-chip" id="drive-rear-chip" hidden>◀ REAR VIEW ▶</div>

   <div class="drive-left-stack">
   <div class="drive-timing" id="drive-timing">
    <div class="drive-timing-head">
     <div class="drive-pos"><small>POS</small><strong id="drive-pos-val">P1</strong></div>
     <div class="drive-lap-box"><span>LAP</span><b id="drive-lap-val">1 / 3</b></div>
    </div>
    <div class="drive-clock-row">
     <span class="drive-cur-lap" id="drive-cur-lap">0:00.000</span>
     <span class="drive-delta" id="drive-flag-chip">GREEN</span>
    </div>
    <div class="drive-best-row">
     <span>BEST <b id="drive-best-lap">—:—.———</b></span>
     <span class="drive-invalid-tag" id="drive-pen-tag" hidden>+5s</span>
    </div>
    <div class="drive-sectors" id="drive-sectors">
     <i data-state="idle">S1</i><i data-state="idle">S2</i><i data-state="idle">S3</i>
    </div>
    <div class="drive-standings" id="drive-standings"></div>
   </div>


    <div class="drive-minimap">
     <svg id="drive-map-svg" viewBox="0 0 1000 1000" aria-label="Circuit minimap">
      <path class="dm-track" id="dm-track"/>
      <g class="dm-field" id="dm-field"></g>
      <circle class="dm-rival" id="dm-rival" r="36"/>
      <circle class="dm-player" id="dm-player" r="46"/>
     </svg>
    </div>
   <div class="drive-mfd" id="drive-mfd">
    <div class="drive-mfd-tabs">
     <button type="button" data-mfd="car" class="active">CAR</button>
     <button type="button" data-mfd="pit">PIT</button>
     <button type="button" data-mfd="room">PIT WALL</button>
    </div>
    <div class="drive-mfd-body">
     <div class="drive-mfd-page" id="mfd-car">
      <div class="drive-tyre-grid" id="mfd-tyres">
       <div class="drive-tyre-card" data-health="good"><small>TYRE LIFE</small><b id="mfd-tyre-life">100%</b></div>
       <div class="drive-tyre-card" data-health="good"><small>TEMP</small><b id="mfd-tyre-temp">85°C</b></div>
      </div>
      <div class="drive-mfd-row"><span>ERS Mode <kbd>F</kbd></span><b id="mfd-ers-val">BALANCED</b></div>
      <div class="drive-mfd-row">
       <span>Brake Bias <kbd>[</kbd><kbd>]</kbd></span>
       <div class="drive-mini-stepper">
        <button type="button" id="mfd-bb-dec">−</button>
        <b id="mfd-bb-val">56%</b>
        <button type="button" id="mfd-bb-inc">+</button>
       </div>
      </div>
      <div class="drive-mfd-row"><span>Damage</span><b id="mfd-dmg-val">0%</b></div>
      <div class="drive-mfd-row"><span>Warnings / Pen</span><b id="mfd-warn-val">0 / 0s</b></div>
     </div>

     <div class="drive-mfd-page" id="mfd-pit" hidden>
      <div class="drive-mfd-row"><span>Active Compound</span><b id="mfd-cur-tyre">SOFT</b></div>
      <div class="drive-mfd-row"><span>Next Compound</span><b id="mfd-next-tyre">HARD</b></div>
      <div class="drive-compound-picks" id="mfd-compound-picks">
       ${COMPOUNDS.map((c) => `<button type="button" data-c="${c}" class="${c === nextCompound ? 'selected' : ''}">${COMPOUND_SHORT[c]}</button>`).join('')}
      </div>
      <button type="button" class="drive-box-btn" id="mfd-box-btn">REQUEST BOX THIS LAP <kbd>P</kbd></button>
      <div class="drive-mfd-row"><span>Est. Pit Stop</span><b id="mfd-pit-est">2.6s</b></div>
     </div>

     <div class="drive-mfd-page" id="mfd-room" hidden>
      <div class="drive-mfd-row"><span>Driver</span><b id="mfd-driver-val">YOU</b></div>
      <div class="drive-mfd-row"><span>Engineer</span><b id="mfd-eng-val">MOCKED</b></div>
      <div class="drive-mfd-actions">
       <button type="button" class="drive-box-btn" id="mfd-eng-toggle">Switch to Joined Engineer</button>
       <a class="drive-mfd-link" id="mfd-pitwall-link" href="${engineerUrl()}" target="_blank">Open Strategy Pit Wall ↗</a>
       <button type="button" class="drive-mfd-link" id="mfd-copy-eng">Copy Engineer Invite Link</button>
       <a class="drive-mfd-link" id="mfd-broadcast-link" href="${broadcastUrl()}" target="_blank">Open World Feed ↗</a>
      </div>
      <div class="drive-mfd-rc">
       <button type="button" data-rc-rain="dry">Dry</button>
       <button type="button" data-rc-rain="light">Rain</button>
       <button type="button" data-rc-sc="1">Safety Car</button>
      </div>
     </div>
    </div>
   </div>
   </div>

   <div class="drive-tacho" id="drive-tacho">
    <div class="drive-shift-leds" id="drive-shift-leds">${'<i></i>'.repeat(15)}</div>
    <div class="drive-tacho-main">
     <svg class="tach-arc" viewBox="0 0 240 94" aria-hidden="true">
      <defs><linearGradient id="drive-rev-spectrum"><stop stop-color="#29e5a1"/><stop offset=".48" stop-color="#f5c95a"/><stop offset=".78" stop-color="#ff3548"/><stop offset="1" stop-color="#ed64ff"/></linearGradient></defs>
      <path class="tach-track" d="M13 83 C28 -9 211 -9 227 83"/>
      <path id="drive-rev-arc" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" d="M13 83 C28 -9 211 -9 227 83"/>
     </svg>
     <div class="drive-pedal-col">
      <div class="drive-pedal-track"><div class="drive-pedal-fill brake" id="drive-brk-bar"></div></div>
      <small>BRK</small>
     </div>
     <div class="drive-speed-block">
      <div class="drive-speed-num" id="drive-speed-val">000</div>
      <div class="drive-speed-unit">KM/H</div>
      <div class="drive-rpm-readout" id="drive-rpm-val">4000 RPM</div>
     </div>
     <div class="drive-gear-box">
      <small>GEAR</small>
      <div class="drive-gear-val" id="drive-gear-val">1</div>
     </div>
     <div class="drive-pedal-col">
      <div class="drive-pedal-track"><div class="drive-pedal-fill throttle" id="drive-thr-bar"></div></div>
      <small>THR</small>
     </div>
    </div>
    <div class="drive-status-pills">
     <span class="drive-drs-pill" id="drive-drs-pill" data-state="off">DRS</span>
     <span class="drive-assist-lamp" id="drive-driver-lamp" data-mode="human">YOU</span>
     <span class="drive-assist-lamp" id="drive-tc-lamp">TC</span>
     <span class="drive-assist-lamp" id="drive-abs-lamp">ABS</span>
    </div>
    <div class="drive-ers-wrap">
     <div class="drive-ers-head">
      <span>ERS BATTERY</span>
      <b class="drive-ers-mode" id="drive-ers-mode" data-mode="balanced">BALANCED · 90%</b>
     </div>
     <div class="drive-ers-bar"><div class="drive-ers-fill" id="drive-ers-fill" style="width:90%"></div></div>
    </div>
    <div class="drive-fuel-row">
     <span>FUEL <b id="drive-fuel-val">34.0 KG</b></span>
     <span>BB <b id="drive-bb-val">56%</b></span>
     <span>TYRE <b id="drive-tyre-badge">SOFT</b></span>
    </div>
   </div>

   <div class="drive-touch" id="drive-touch" hidden>
    <div class="drive-touch-group">
     <button type="button" class="drive-touch-btn" id="touch-left">◀</button>
     <button type="button" class="drive-touch-btn" id="touch-right">▶</button>
     <button type="button" class="drive-touch-btn small" id="touch-drs">DRS</button>
     <button type="button" class="drive-touch-btn small" id="touch-ers">ERS</button>
    </div>
    <div class="drive-touch-group">
     <button type="button" class="drive-touch-btn brk" id="touch-brk">BRK</button>
     <button type="button" class="drive-touch-btn gas" id="touch-gas">GAS</button>
    </div>
   </div>
  </div>

  <!-- ROOM LOBBY OVERLAY -->
  <div class="drive-overlay" id="drive-lobby">
   <div class="drive-card">
    <div class="drive-card-head">
     <div>
      <div class="drive-eyebrow">MCP GRAND PRIX · LIVE ROOM LOBBY · ${PERSONAS[seat].name.toUpperCase()} #${PERSONAS[seat].number}</div>
      <h1 id="lobby-title">Drive Mode</h1>
     </div>
     <div class="drive-head-links">
      <a class="drive-exit-link" id="lobby-broadcast-link" href="${broadcastUrl()}" target="_blank">World Feed ↗</a>
      <a class="drive-exit-link" href="/">All Modes</a>
     </div>
    </div>

    <div class="drive-setup-grid">
     <div>
      <div class="drive-group">
       <div class="drive-group-label">Driver Control <small>(Switch anytime mid-race with G)</small></div>
       <div class="drive-seg" id="lobby-driver-seg">
        <button type="button" data-dmode="human" class="selected">You (Drive)</button>
        <button type="button" data-dmode="jev">Jev (AI)</button>
        <button type="button" data-dmode="autopilot">Autopilot</button>
       </div>
       <p class="drive-mode-desc" id="lobby-driver-desc">Drive the car yourself with keyboard, gamepad, or touch controls.</p>
      </div>

      <div class="drive-group">
       <div class="drive-group-label">Strategy Engineer <small>(Pit Wall Radio)</small></div>
       <div class="drive-seg" id="lobby-eng-seg">
        <button type="button" data-emode="mock" class="selected">Mocked Engineer</button>
        <button type="button" data-emode="joined">Join Strategy Engineer</button>
       </div>
       <div class="drive-eng-box" id="lobby-eng-box">
        <div class="drive-eng-status" id="lobby-eng-status">Automatic strategist will call pace, ERS &amp; pit stops over team radio.</div>
        <div class="drive-eng-actions">
         <a class="drive-secondary-btn small" id="lobby-open-pitwall" href="${engineerUrl()}" target="_blank">Open Strategy Pit Wall ↗</a>
         <button type="button" class="drive-secondary-btn small" id="lobby-copy-eng">Copy Engineer Link</button>
        </div>
       </div>
      </div>

      <div class="drive-group">
       <div class="drive-group-label">Circuit</div>
       <div class="drive-seg" id="lobby-circuit-seg">
        <button type="button" data-circuit="monza" class="selected">Monza · Day</button>
        <button type="button" data-circuit="las-vegas">Las Vegas · Night</button>
       </div>
      </div>
     </div>

     <div class="drive-assists-panel">
      <h3>Driving Assists (When You Drive)</h3>
      <div class="drive-assist-row">
       <span>Gearbox</span>
       <div class="drive-seg" id="opt-gearbox">
        <button type="button" data-val="auto" class="selected">Auto</button>
        <button type="button" data-val="manual">Manual</button>
       </div>
      </div>
      <div class="drive-assist-row">
       <span>Traction Control</span>
       <div class="drive-seg" id="opt-tc">
        <button type="button" data-val="full">Full</button>
        <button type="button" data-val="medium" class="selected">Medium</button>
        <button type="button" data-val="off">Off</button>
       </div>
      </div>
      <div class="drive-assist-row">
       <span>Anti-Lock Brakes</span>
       <div class="drive-seg" id="opt-abs">
        <button type="button" data-val="on" class="selected">On</button>
        <button type="button" data-val="off">Off</button>
       </div>
      </div>
      <div class="drive-assist-row">
       <span>Dynamic Racing Line</span>
       <div class="drive-seg" id="opt-line">
        <button type="button" data-val="full" class="selected">Full</button>
        <button type="button" data-val="corners">Corners</button>
        <button type="button" data-val="off">Off</button>
       </div>
      </div>
      <div class="drive-assist-row">
       <span>Pit Assist</span>
       <div class="drive-seg" id="opt-pit">
        <button type="button" data-val="on" class="selected">On</button>
        <button type="button" data-val="off">Off</button>
       </div>
      </div>
      <div class="drive-pad-badge" id="lobby-pad-badge">Room: ${room.room.slice(0, 8)} · Connecting…</div>
     </div>
    </div>

    <div class="drive-controls-strip">
     <span><kbd>W</kbd>/<kbd>↑</kbd> Gas</span>
     <span><kbd>S</kbd>/<kbd>↓</kbd> Brake</span>
     <span><kbd>A</kbd><kbd>D</kbd> Steer</span>
     <span><kbd>G</kbd> Switch Driver</span>
     <span><kbd>Space</kbd> DRS</span>
     <span><kbd>Shift</kbd> ERS Boost</span>
     <span><kbd>C</kbd> Camera</span>
     <span><kbd>V</kbd> Rear View</span>
     <span><kbd>P</kbd> Box</span>
     <span><kbd>ESC</kbd> Menu</span>
    </div>

    <div class="drive-cta-row">
     <button type="button" class="drive-primary-btn" id="drive-start-btn" disabled>Connecting to room…</button>
     <a class="drive-secondary-btn" href="${pitWallUrl()}" target="_blank">Classic Pit Wall ↗</a>
    </div>
   </div>
  </div>

  <!-- PAUSE / LIVE MENU OVERLAY -->
  <div class="drive-overlay" id="drive-pause" hidden>
   <div class="drive-card compact">
    <div class="drive-card-head">
     <div>
      <div class="drive-eyebrow">LIVE ROOM MENU · RACE CONTINUES IN REAL TIME</div>
      <h2>Cockpit Controls</h2>
     </div>
     <button type="button" class="drive-exit-link" id="pause-close-btn">Resume</button>
    </div>

    <div class="drive-group">
     <div class="drive-group-label">Driver Control</div>
     <div class="drive-seg" id="pause-driver-seg">
      <button type="button" data-dmode="human">You (Drive)</button>
      <button type="button" data-dmode="jev">Jev (AI)</button>
      <button type="button" data-dmode="autopilot">Autopilot</button>
     </div>
    </div>

    <div class="drive-group">
     <div class="drive-group-label">Strategy Engineer</div>
     <div class="drive-seg" id="pause-eng-seg">
      <button type="button" data-emode="mock">Mocked Engineer</button>
      <button type="button" data-emode="joined">Joined Strategy Engineer</button>
     </div>
     <div class="drive-eng-actions" style="margin-top:8px">
      <a class="drive-secondary-btn small" href="${engineerUrl()}" target="_blank">Open Strategy Pit Wall ↗</a>
      <button type="button" class="drive-secondary-btn small" id="pause-copy-eng">Copy Engineer Link</button>
     </div>
    </div>

    <div class="drive-cta-row">
     <button type="button" class="drive-primary-btn" id="pause-resume-btn">Back to Cockpit</button>
     <button type="button" class="drive-secondary-btn" id="pause-reset-btn">Reset Lobby</button>
     <a class="drive-secondary-btn" href="${broadcastUrl()}" target="_blank">World Feed ↗</a>
    </div>
   </div>
  </div>

  <!-- RESULTS OVERLAY -->
  <div class="drive-overlay" id="drive-results" hidden>
   <div class="drive-card">
    <div class="drive-card-head">
     <div>
      <div class="drive-eyebrow">▧ CHEQUERED FLAG · OFFICIAL ROOM CLASSIFICATION</div>
      <h2 id="res-title">Race Complete</h2>
     </div>
     <a class="drive-exit-link" href="/">All Modes</a>
    </div>
    <div class="drive-summary-stats">
     <div class="drive-stat-box"><small>FINISH POS</small><b id="res-pos">P1</b></div>
     <div class="drive-stat-box"><small>BEST LAP</small><b id="res-best">—:—.———</b></div>
     <div class="drive-stat-box"><small>PIT STOPS</small><b id="res-stops">0</b></div>
     <div class="drive-stat-box"><small>PENALTIES</small><b id="res-pen">0s</b></div>
    </div>
    <table class="drive-results-table">
     <thead><tr><th>POS</th><th>DRIVER</th><th>TYRE</th><th>TIME / STATUS</th></tr></thead>
     <tbody id="res-tbody"></tbody>
    </table>
    <div class="drive-cta-row">
     <button type="button" class="drive-primary-btn" id="res-again-btn">Race Again ↗</button>
     <button type="button" class="drive-secondary-btn" id="res-replay-btn">↶ Instant Replay</button>
     <a class="drive-secondary-btn" href="${broadcastUrl()}" target="_blank">World Feed ↗</a>
    </div>
   </div>
  </div>
 </div>${embedded ? '<section id="race-event-log" class="race-event-log" aria-labelledby="event-log-title"></section>' : ''}`;

 const elements=new Map(Array.from(app.querySelectorAll<HTMLElement>('[id]'),node=>[node.id,node]));
 const el=(id:string)=>elements.get(id)!;
 if (embedded) {
  app.querySelectorAll<HTMLElement>('[data-dmode="jev"]').forEach((node) => { node.hidden = true; });
 }
 const eventLog = embedded ? mountEventLog(el('race-event-log'), conn) : null;
 const driverRadio = room.live ? mountDriverRadio(el('drive-team-radio'), seat, () => conn, {sendDriverQuestion: options.sendDriverQuestion}) : null;
 const viewport = el('drive-viewport');
 const hudEl = el('drive-hud');
 const loadingEl = el('drive-loading');
 const lobbyEl = el('drive-lobby');
 const pauseEl = el('drive-pause');
 const resultsEl = el('drive-results');
 const lightsEl = el('drive-lights');
 const lightPods = Array.from(lightsEl.querySelectorAll<HTMLElement>('.drive-light-pod'));
 const revArc=el('drive-rev-arc');
 let previousRev=-1;
 const shiftLeds = Array.from(el('drive-shift-leds').querySelectorAll<HTMLElement>('i'));
 const sectorChips = Array.from(el('drive-sectors').querySelectorAll<HTMLElement>('i'));
 const tcam = mountTcamTelemetry(viewport);
 let latestGamepadName: string | null = null;
 let haloVisible = true;
 const controls = createDriveControls({
  onCamera: () => cycleCamera(),
  onFlashback: () => {},
  onPause: () => {
   const st = conn.state;
   if (st && st.race.phase !== "lobby" && st.race.phase !== "finished") {
    menuOpen = !menuOpen;
    pauseEl.hidden = !menuOpen;
   }
  },
  onMfdCycle: () => {
   mfdTab = mfdTab === "car" ? "pit" : mfdTab === "pit" ? "room" : "car";
   syncMfdTabs();
  },
  onBoxToggle: () => togglePitBox(),
  onCompoundCycle: () => {
   const idx = (COMPOUNDS.indexOf(nextCompound) + 1) % COMPOUNDS.length;
   nextCompound = COMPOUNDS[idx];
   el("mfd-compound-picks").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("selected", b.dataset.c === nextCompound));
   el("mfd-next-tyre").textContent = nextCompound.toUpperCase();
  },
  onErsMode: (dir) => {
   const cur = localErsMode ?? conn.state?.race.cars[seat].instruction.ers ?? "balanced";
   const idx = (ERS_CYCLE.indexOf(cur) + dir + ERS_CYCLE.length) % ERS_CYCLE.length;
   localErsMode = ERS_CYCLE[idx];
   showAlert(`ERS: ${localErsMode.toUpperCase()}`, "info", 1400);
  },
  onBrakeBias: (delta) => { brakeBias = clamp(brakeBias + delta, 50, 64); },
  onHaloToggle: () => { haloVisible = !haloVisible; },
  onRacingLineToggle: () => cycleRacingLine(),
  onAudioToggle: () => toggleAudio(),
 });
 const audio = createDriveAudio(options.audioOutput);
 let audioEnabled = true;

 let currentCircuit: CircuitId = options.circuit ?? (isCircuit(params.get('circuit')) ? params.get('circuit') as CircuitId : 'monza');
 let track = getTrack(currentCircuit);
 const hidden=()=>embedded&&(document.hidden||document.documentElement.dataset.mcpHidden==='true');
 function makeScene(){
  const view=createScene(viewport,track);
  view.setMode(resolveSceneCamera());view.setRacingLine(racingLineMode,seat);
  return view;
 }
 let scene=hidden()?undefined:makeScene();

 function rebuildMinimap() {
  const {LENGTH, pointAt} = track;
  const pts = Array.from({length: Math.ceil(LENGTH / 25)}, (_, i) => pointAt(i * 25));
  el('dm-track').setAttribute('d', pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ') + 'Z');
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const pad = 160;
  el('drive-map-svg').setAttribute(
   'viewBox',
   `${Math.min(...xs) - pad} ${Math.min(...zs) - pad} ${Math.max(...xs) - Math.min(...xs) + pad * 2} ${Math.max(...zs) - Math.min(...zs) + pad * 2}`,
  );
  const fieldG = el('dm-field');
  fieldG.innerHTML = '';
  for (let i = 0; i < opponents.length; i++) {
   const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
   dot.setAttribute('r', '26');
   dot.setAttribute('fill', constructors[opponents[i].team][0]);
   fieldG.append(dot);
  }
 }
 rebuildMinimap();

 function showAlert(text: string, tone: typeof alertTone = 'info', durationMs = 3400) {
  alertText = text;
  alertTone = tone;
  alertUntil = performance.now() + durationMs;
  const node = el('drive-alert');
  node.textContent = text;
  node.dataset.tone = tone;
  node.hidden = false;
 }

 function currentDriverMode(s?: RaceState | null): DriverControlMode {
  return s?.driverMode?.[seat] ?? 'human';
 }
 function currentEngineerMode(s?: RaceState | null): EngineerControlMode {
  return s?.engineerMode?.[seat] ?? 'mock';
 }
 function setDriverMode(mode: DriverControlMode) {
  conn.send({type: 'driver-mode', mode});
  const label = mode === 'human' ? 'YOU ARE DRIVING' : mode === 'jev' ? 'JEV TAKING CONTROL' : 'AUTOPILOT ENGAGED';
  showAlert(label, mode === 'human' ? 'green' : mode === 'jev' ? 'red' : 'info', 2500);
 }
 function syncRoomLinks() {
  const engHref = engineerUrl();
  const bcHref = broadcastUrl();
  for (const id of ['mfd-pitwall-link', 'lobby-open-pitwall']) {
   const a = document.getElementById(id) as HTMLAnchorElement | null;
   if (a) a.href = engHref;
  }
  for (const id of ['mfd-broadcast-link', 'lobby-broadcast-link']) {
   const a = document.getElementById(id) as HTMLAnchorElement | null;
   if (a) a.href = bcHref;
  }
 }

 async function ensureOnlineRoom(startIfActive = false): Promise<HostedRoom> {
  if (!room.local) return room;
  if (promotingRoom) return promotingRoom;
  const localCfg = room.local;
  const desiredDriver = currentDriverMode(conn.state);
  const wasActive = startIfActive && prevPhase !== undefined && prevPhase !== 'lobby' && prevPhase !== 'finished';
  promotingRoom = (async () => {
   showAlert('OPENING LIVE ROOM FOR PIT WALL…', 'info', 2500);
   const createParams = new URLSearchParams({drive: '', circuit: currentCircuit, laps: String(localCfg.laps)});
   const res = await fetch('/api/rooms?' + createParams.toString(), {method: 'POST'});
   if (!res.ok) throw new Error('Could not open online room (' + res.status + ').');
   const links: RoomLinks = await res.json();
   if(disposed)throw new Error('Drive view closed');
   const ownerUrl = new URL(links.owner);
   const token = new URLSearchParams(ownerUrl.hash.slice(1)).get('token') ?? '';
   ownerUrl.searchParams.set('drive', '');
   ownerUrl.searchParams.set('team', seat);
   ownerUrl.searchParams.set('engineer', 'joined');
   history.replaceState(null, '', ownerUrl.pathname + ownerUrl.search + ownerUrl.hash);
   room = {room: links.room, token, links};
   promotedPending = {driverMode: desiredDriver, engineerMode: 'joined', start: wasActive};
   lastRadioId = 0;
   lastEventId = 0;
   prevPhase = undefined;
   const oldConn = conn;
   const nextConn = connect(seat, room, {
    role: 'driver',
    shouldDecide: (s) => (s.driverMode?.[seat] ?? 'jev') === 'jev',
   });
   attachConnection(nextConn);
   conn = nextConn;
   oldConn.close();
   syncRoomLinks();
   return room;
  })().finally(() => { promotingRoom = null; });
  return promotingRoom;
 }

 function setEngineerMode(mode: EngineerControlMode) {
  if (mode === 'joined' && room.local) {
   void ensureOnlineRoom(true).catch(() => showAlert('COULD NOT OPEN LIVE ROOM', 'red', 3000));
   return;
  }
  conn.send({type: 'engineer-mode', mode});
  showAlert(mode === 'joined' ? 'STRATEGY ENGINEER: LIVE PIT WALL' : 'STRATEGY ENGINEER: MOCKED AUTO', 'info', 2500);
 }

 let copyTimer:ReturnType<typeof setTimeout>|undefined;
 async function copyEngineerLink(btn: HTMLButtonElement) {
  if (room.local) {
   try { await ensureOnlineRoom(true); } catch { showAlert('COULD NOT OPEN LIVE ROOM', 'red', 3000); return; }
  }
  const url = engineerUrl();
  try {
   await navigator.clipboard.writeText(url);
   if(disposed)return;
   clearTimeout(copyTimer);
   const prev = btn.textContent;
   btn.textContent = 'Copied link ✓';
   copyTimer=setTimeout(() => { btn.textContent = prev; }, 1800);
  } catch {
   window.prompt('Copy Strategy Engineer Pit Wall link:', url);
  }
 }

 function bindSeg(containerId: string, onPick: (val: string) => void) {
  const container = el(containerId);
  container.addEventListener('click', (ev) => {
   const btn = (ev.target as HTMLElement).closest('button');
   if (!btn) return;
   const val = btn.dataset.val ?? btn.dataset.dmode ?? btn.dataset.emode ?? btn.dataset.circuit;
   if (!val) return;
   container.querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === btn));
   onPick(val);
  });
 }

 // Driver mode switchers (Topbar, Lobby, Pause)
 el('drive-mode-switcher').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button');
  const mode = btn?.dataset.dmode as DriverControlMode | undefined;
  if (mode) setDriverMode(mode);
 });
 bindSeg('lobby-driver-seg', (val) => setDriverMode(val as DriverControlMode));
 bindSeg('pause-driver-seg', (val) => setDriverMode(val as DriverControlMode));

 // Engineer mode switchers (Lobby, Pause, Topbar, MFD)
 bindSeg('lobby-eng-seg', (val) => setEngineerMode(val as EngineerControlMode));
 bindSeg('pause-eng-seg', (val) => setEngineerMode(val as EngineerControlMode));
 el('drive-eng-pill').onclick = () => {
  mfdTab = 'room';
  syncMfdTabs();
  const s = conn.state;
  if (currentEngineerMode(s) === 'joined' && !s?.engineerConnected?.[seat]) {
   window.open(engineerUrl(), '_blank');
  } else {
   setEngineerMode(currentEngineerMode(s) === 'mock' ? 'joined' : 'mock');
  }
 };
 el('mfd-eng-toggle').onclick = () => {
  const cur = currentEngineerMode(conn.state);
  setEngineerMode(cur === 'mock' ? 'joined' : 'mock');
 };
 el('lobby-copy-eng').onclick = () => void copyEngineerLink(el('lobby-copy-eng') as HTMLButtonElement);
 el('pause-copy-eng').onclick = () => void copyEngineerLink(el('pause-copy-eng') as HTMLButtonElement);
 el('mfd-copy-eng').onclick = () => void copyEngineerLink(el('mfd-copy-eng') as HTMLButtonElement);
 for (const [id, getUrl] of [['mfd-pitwall-link', engineerUrl], ['lobby-open-pitwall', engineerUrl], ['mfd-broadcast-link', broadcastUrl], ['lobby-broadcast-link', broadcastUrl]] as const) {
  el(id).onclick = (ev) => {
   if (!room.local) return;
   ev.preventDefault();
   void ensureOnlineRoom(true).then(() => window.open(getUrl(), '_blank')).catch(() => showAlert('COULD NOT OPEN LIVE ROOM', 'red', 3000));
  };
 }

 // Circuit switcher (owner)
 bindSeg('lobby-circuit-seg', (val) => {
  if (isCircuit(val)) conn.send({type: 'circuit', circuit: val});
 });

 // Driving assists
 bindSeg('opt-gearbox', (v) => { gearbox = v as GearboxMode; });
 bindSeg('opt-tc', (v) => { tractionControl = v as TractionControl; });
 bindSeg('opt-abs', (v) => { absEnabled = v === 'on'; });
 bindSeg('opt-line', (v) => {
  racingLineMode = v as RacingLineMode;
  scene?.setRacingLine(racingLineMode, seat);
  el('drive-line-label').textContent = racingLineMode.toUpperCase();
 });
 bindSeg('opt-pit', (v) => { pitAssist = v === 'on'; });

 // Start / Pause / Reset / Replay
 const sendStart = () => {
  if (options.onStart) options.onStart();
  else conn.send({type: 'start'});
 };
 el('drive-start-btn').onclick = () => {
  if (audioEnabled) audio.unlock();
  sendStart();
 };
 el('drive-menu-btn').onclick = () => { menuOpen = !menuOpen; pauseEl.hidden = !menuOpen; };
 el('pause-close-btn').onclick = () => { menuOpen = false; pauseEl.hidden = true; };
 el('pause-resume-btn').onclick = () => { menuOpen = false; pauseEl.hidden = true; };
 el('pause-reset-btn').onclick = () => {
  menuOpen = false;
  pauseEl.hidden = true;
  replayActive = false;
  conn.send({type: 'reset'});
 };
 el('res-again-btn').onclick = () => {
  replayActive = false;
  conn.send({type: 'reset'});
 };
 el('res-replay-btn').onclick = () => conn.send({type: 'replay'});

 // Camera / Racing Line / Audio buttons
 el('drive-cam-btn').onclick = () => cycleCamera();
 el('drive-line-btn').onclick = () => cycleRacingLine();
 function toggleAudio() {
  audioEnabled = !audioEnabled;
  if (audioEnabled) audio.unlock();
  audio.setEnabled(audioEnabled);
  el('drive-audio-label').textContent = audioEnabled ? 'ON' : 'OFF';
 }
 el('drive-audio-btn').onclick = () => toggleAudio();

 function cycleCamera() {
  cameraKind = CAMERA_CYCLE[(CAMERA_CYCLE.indexOf(cameraKind) + 1) % CAMERA_CYCLE.length];
  el('drive-cam-label').textContent = CAMERA_LABELS[cameraKind];
  showAlert(`CAMERA: ${CAMERA_LABELS[cameraKind]}`, 'info', 1400);
 }
 function cycleRacingLine() {
  racingLineMode = LINE_CYCLE[(LINE_CYCLE.indexOf(racingLineMode) + 1) % LINE_CYCLE.length];
  scene?.setRacingLine(racingLineMode, seat);
  el('drive-line-label').textContent = racingLineMode.toUpperCase();
  showAlert(`RACING LINE: ${racingLineMode.toUpperCase()}`, 'info', 1400);
 }

 // MFD Tabs & Pit Controls
 function syncMfdTabs() {
  el('drive-mfd').querySelectorAll<HTMLButtonElement>('.drive-mfd-tabs button').forEach((b) => {
   b.classList.toggle('active', b.dataset.mfd === mfdTab);
  });
  el('mfd-car').hidden = mfdTab !== 'car';
  el('mfd-pit').hidden = mfdTab !== 'pit';
  el('mfd-room').hidden = mfdTab !== 'room';
 }
 el('drive-mfd').querySelectorAll<HTMLButtonElement>('.drive-mfd-tabs button').forEach((btn) => {
  btn.onclick = () => {
   mfdTab = btn.dataset.mfd as typeof mfdTab;
   syncMfdTabs();
  };
 });
 el('mfd-bb-dec').onclick = () => { brakeBias = clamp(brakeBias - 1, 50, 64); };
 el('mfd-bb-inc').onclick = () => { brakeBias = clamp(brakeBias + 1, 50, 64); };
 el('mfd-compound-picks').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button');
  const c = btn?.dataset.c as Compound | undefined;
  if (!c) return;
  nextCompound = c;
  el('mfd-compound-picks').querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === btn));
  el('mfd-next-tyre').textContent = c.toUpperCase();
 });

 function togglePitBox() {
  const car = conn.state?.race.cars[seat];
  if (!car) return;
  const box = !car.instruction.box;
  conn.send({
   type: 'radio',
   instruction: {
    ...car.instruction,
    box,
    tyre: box ? nextCompound : car.compound,
    line: box ? `Box this lap for ${nextCompound} tyres.` : 'Stay out. Cancelling pit request.',
   },
  });
  showAlert(box ? `BOX ARMED · ${nextCompound.toUpperCase()}` : 'BOX CANCELLED · STAY OUT', 'amber', 2200);
 }
 el('mfd-box-btn').onclick = () => togglePitBox();

 // Race Control quick buttons inside MFD Pit Wall tab
 el('mfd-room').querySelectorAll<HTMLButtonElement>('[data-rc-rain]').forEach((btn) => {
  btn.onclick = () => conn.send({type: 'race-control', hazard: {kind: 'rain', level: btn.dataset.rcRain as RainLevel}});
 });
 el('mfd-room').querySelector<HTMLButtonElement>('[data-rc-sc]')!.onclick = () => {
  const scActive = Boolean(conn.state?.race.control?.safetyCar);
  const hazard: Hazard = scActive ? {kind: 'safety-car-in'} : {kind: 'safety-car', when: 'now'};
  conn.send({type: 'race-control', hazard});
 };

 // Extra hotkeys (G: cycle driver mode, L: racing line, P: pit box)
 const onKeyDown = (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  if (e.repeat) return;
  if (e.code === 'KeyG') {
   const cycle = embedded ? EMBEDDED_DRIVER_CYCLE : DRIVER_CYCLE;
   const cur = currentDriverMode(conn.state);
   const idx = cycle.indexOf(cur);
   const next = cycle[(idx + 1) % cycle.length];
   setDriverMode(next);
  }
 };
 window.addEventListener('keydown', onKeyDown);

 // Touch buttons (visible on touch devices)
 if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  el('drive-touch').hidden = false;
  const bindHold = (id: string, onChange: (down: boolean) => void) => {
   const node = el(id);
   node.addEventListener('pointerdown', (ev) => { ev.preventDefault(); onChange(true); });
   node.addEventListener('pointerup', () => onChange(false));
   node.addEventListener('pointercancel', () => onChange(false));
   node.addEventListener('pointerleave', () => onChange(false));
  };
  let touchL = false, touchR = false;
  const syncTouchSteer = () => { controls.touch.steer = (touchL ? 1 : 0) - (touchR ? 1 : 0); };
  bindHold('touch-left', (d) => { touchL = d; syncTouchSteer(); });
  bindHold('touch-right', (d) => { touchR = d; syncTouchSteer(); });
  bindHold('touch-gas', (d) => { controls.touch.throttle = d ? 1 : 0; });
  bindHold('touch-brk', (d) => { controls.touch.brake = d ? 1 : 0; });
  bindHold('touch-ers', (d) => { controls.touch.ersOvertake = d; });
  el('touch-drs').addEventListener('pointerdown', (ev) => { ev.preventDefault(); controls.touch.drsPulse = true; });
 }

 function attachConnection(target: typeof conn) {
 if (driverRadio) {
  target.onQuestionAccepted = driverRadio.onAccepted;
  target.onQuestionError = driverRadio.onError;
 }
 target.onReplay = (frames) => {
  if (!frames.length) return;
  replayFrames = frames;
  replayActive = true;
  replayStartAt = performance.now();
  resultsEl.hidden = true;
  showAlert('INSTANT REPLAY · 0.65×', 'purple', 3000);
 };

 // Snapshot handler
 target.onSnapshot = (s, received) => {
  if (disposed) return;
  interpolate.push(s, received);

  if (promotedPending && target.team) {
   const p = promotedPending;
   promotedPending = null;
   if (currentDriverMode(s) !== p.driverMode) target.send({type: 'driver-mode', mode: p.driverMode});
   if (currentEngineerMode(s) !== p.engineerMode) target.send({type: 'engineer-mode', mode: p.engineerMode});
   if (p.start && s.race.phase === 'lobby' && s.connected.a && s.connected.b) target.send({type: 'start'});
  }
  // Apply URL-requested initial modes once connected
  if (!initialModesSent && target.team) {
   initialModesSent = true;
   if (initialDriverParam === 'human' || initialDriverParam === 'jev' || initialDriverParam === 'autopilot') {
    if (currentDriverMode(s) !== initialDriverParam) conn.send({type: 'driver-mode', mode: initialDriverParam});
   }
   if (initialEngineerParam === 'joined' || initialEngineerParam === 'mock') {
    if (currentEngineerMode(s) !== initialEngineerParam) conn.send({type: 'engineer-mode', mode: initialEngineerParam});
   }
  }
  const canStartNow = options.canStart?.() ?? true;
  const startReadyNow = options.startReady?.(s) ?? true;
  if (autostart && !autostartSent && target.team && canStartNow && startReadyNow && s.race.phase === 'lobby' && s.connected.a && s.connected.b) {
   autostartSent = true;
   sendStart();
  }

  // Handle circuit changes dynamically
  if (s.race.circuit !== currentCircuit) {
   currentCircuit = s.race.circuit;
   track = getTrack(currentCircuit);
   scene?.dispose();
   scene=hidden()?undefined:makeScene();
   rebuildMinimap();
  }

  // Sync manual gear on mode transition into human
  const dMode = currentDriverMode(s);
  if (dMode === 'human' && prevDriverMode && prevDriverMode !== 'human') {
   manualGear = clamp(s.race.cars[seat].gear || 1, 1, 8);
  }
  prevDriverMode = dMode;

  // Check for new Team Radio calls for our car
  const engMode = currentEngineerMode(s);
  const liveStrategist = engMode === 'joined' || Boolean(s.chatStrategy || s.guestChatStrategy);
  const latestRadio = s.latestChatRadio?.[seat] ?? s.race.radio.filter((x) => {
   if (x.team !== seat || x.consultation) return false;
   if (liveStrategist && x.source !== 'live') return false;
   if (x.speaker !== 'ENGINEER' && x.source === 'mock') return false;
   return true;
  }).at(-1);
  if (latestRadio && latestRadio.id > lastRadioId) {
   lastRadioId = latestRadio.id;
   radioBannerUntil = performance.now() + 7500;
   const banner = el('drive-radio-banner');
   el('drb-speaker').textContent =
    latestRadio.strategist === 'chatgpt'
     ? 'CHATGPT STRATEGIST'
     : latestRadio.speaker === 'ENGINEER'
      ? 'STRATEGY ENGINEER'
      : `${latestRadio.speaker} (DRIVER)`;
   el('drb-source').textContent =
    latestRadio.source === 'live' ? 'LIVE PIT WALL' : latestRadio.source === 'fallback' ? 'FALLBACK' : 'MOCKED';
   banner.dataset.source = latestRadio.source;
   el('drb-text').textContent = `"${latestRadio.text}"`;
   banner.hidden = false;
  }

  // Check for new race events (limits, pit, lap, collision)
  const latestEvent = s.race.events.filter((ev) => ev.team === seat && ['pit', 'limits', 'collision', 'lap', 'overtake'].includes(ev.kind)).at(-1);
  if (latestEvent && latestEvent.id > lastEventId) {
   lastEventId = latestEvent.id;
   const tone: typeof alertTone =
    latestEvent.kind === 'collision' || latestEvent.kind === 'limits' ? 'red'
     : latestEvent.kind === 'pit' ? 'amber'
      : latestEvent.kind === 'lap' ? 'purple' : 'green';
   showAlert(latestEvent.message, tone, 3000);
  }
 };
 }
 attachConnection(conn);

 function resolveSceneCamera(): CameraMode {
  if (cameraKind === 'tcam') return seat === 'a' ? 'tcam-a' : 'tcam-b';
  if (cameraKind === 'cockpit') return seat === 'a' ? 'cockpit-a' : 'cockpit-b';
  if (cameraKind === 'nose') return seat === 'a' ? 'nose-a' : 'nose-b';
  return seat === 'a' ? 'chase-a' : 'chase-b';
 }

 // Expose authoritative state & drive debug hooks
 Object.defineProperty(window, '__raceState', {configurable: true, get: () => conn.state});
 (window as unknown as Record<string, unknown>).__driveDebug = {
  getState: () => conn.state,
  getMode: () => ({
   driverMode: currentDriverMode(conn.state),
   engineerMode: currentEngineerMode(conn.state),
   engineerConnected: Boolean(conn.state?.engineerConnected?.[seat]),
   camera: cameraKind,
   racingLine: racingLineMode,
   seat,
   room: room.room,
   local: Boolean(room.local),
   engineerUrl: engineerUrl(),
  }),
  setDriverMode,
  setEngineerMode,
 };

 let lastMapAt=-Infinity;
 let controlDriver:DriverControlMode|undefined,controlEngineer:EngineerControlMode|undefined;
 let controlCircuit:CircuitId|undefined,controlOnline=false,controlReset=false;
 function syncControlButtons(s: RaceState) {
  const dMode = currentDriverMode(s);
  const eMode = currentEngineerMode(s);
  const engOnline = Boolean(s.engineerConnected?.[seat]);

  if(controlDriver===dMode&&controlEngineer===eMode&&controlOnline===engOnline&&controlCircuit===s.race.circuit&&controlReset===conn.canReset)return;
  controlDriver=dMode;controlEngineer=eMode;controlOnline=engOnline;controlCircuit=s.race.circuit;controlReset=conn.canReset;
  // Topbar driver mode switcher
  el('drive-mode-switcher').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
   b.classList.toggle('active', b.dataset.dmode === dMode);
  });
  for (const id of ['lobby-driver-seg', 'pause-driver-seg']) {
   el(id).querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.dmode === dMode);
   });
  }
  const desc =
   dMode === 'human'
    ? 'Drive the car yourself with WASD/Arrows, Gamepad (dual rumble), or Touch.'
    : dMode === 'jev'
     ? 'Jev AI drives your car using the room’s live/mock driver pipeline. Take over anytime with G.'
     : 'Built-in deterministic autopilot holds the optimal racing line and obeys Strategy Engineer calls.';
  if (el('lobby-driver-desc').textContent !== desc) el('lobby-driver-desc').textContent = desc;

  // Engineer mode switchers
  for (const id of ['lobby-eng-seg', 'pause-eng-seg']) {
   el(id).querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.emode === eMode);
   });
  }
  const engPill = el('drive-eng-pill');
  const engState = eMode === 'mock' ? 'mock' : engOnline ? 'connected' : 'waiting';
  engPill.dataset.state = engState;
  el('drive-eng-label').textContent =
   engState === 'mock' ? 'ENG: MOCKED' : engState === 'connected' ? 'ENG: LIVE' : 'ENG: JOIN ↗';

  el('lobby-eng-status').textContent =
   eMode === 'mock'
    ? 'Automatic Strategy Engineer will call pace, ERS & pit stops over team radio.'
    : engOnline
     ? '● Strategy Engineer connected on Pit Wall — live radio active.'
     : '○ Waiting for Strategy Engineer to join via the Pit Wall link below.';
  el('lobby-eng-status').dataset.state = engState;

  el('mfd-driver-val').textContent = DRIVER_LABELS[dMode];
  el('mfd-eng-val').textContent = engState === 'mock' ? 'MOCKED' : engState === 'connected' ? 'LIVE CONNECTED' : 'WAITING';
  el('mfd-eng-toggle').textContent = eMode === 'mock' ? 'Switch to Joined Engineer' : 'Switch to Mocked Engineer';

  // Circuit seg
  el('lobby-circuit-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
   b.classList.toggle('selected', b.dataset.circuit === s.race.circuit);
   b.disabled = !conn.canReset;
  });
 }

 function updateHud(s: RaceState, r: Race, now: number) {
  const car = r.cars[seat];
  const rival = r.cars[seat === 'a' ? 'b' : 'a'];
  const dMode = currentDriverMode(s);
  const order = classification(r);
  const place = Math.max(1, order.findIndex((row) => row.entry.seat === seat) + 1);
  const inLobby = r.phase === 'lobby';
  const isFinished = r.phase === 'finished' && !replayActive;

  setAttributeIfChanged(document.body,'data-phase',r.phase);
  setAttributeIfChanged(document.body,'data-room',s.room);
  setAttributeIfChanged(document.body,'data-circuit',r.circuit);
  setAttributeIfChanged(document.body,'data-connected',String(s.connected.a && s.connected.b));
  setAttributeIfChanged(document.body,'data-driver-mode',dMode);
  setAttributeIfChanged(document.body,'data-engineer-mode',currentEngineerMode(s));

  const modelsReady = scene?.ready;
  loadingEl.hidden = modelsReady || inLobby;
  lobbyEl.hidden = !inLobby;
  resultsEl.hidden = !isFinished;
  hudEl.hidden = inLobby;
  driverRadio?.sync(replayActive);

  syncControlButtons(s);

  // Lobby ready state
  if (inLobby) {
   const seatsReady = s.connected.a && s.connected.b;
   const canStart = options.canStart?.() ?? true;
   const startReady = options.startReady?.(s) ?? true;
   const startBtn = el('drive-start-btn') as HTMLButtonElement;
   startBtn.disabled = !seatsReady || !canStart || !startReady || conn.status !== 'CONNECTED';
   setTextIfChanged(startBtn,!seatsReady
    ? 'Connecting seats…'
    : !canStart
     ? 'Waiting for Team A to start…'
     : !startReady
      ? 'Waiting for ChatGPT to subscribe…'
      : `START ${track.name.toUpperCase()} GRAND PRIX (${r.laps} LAPS) ↗`);
   const padInfo = latestGamepadName ? ` · Gamepad: ${latestGamepadName}` : '';
   setTextIfChanged(el('lobby-pad-badge'),room.local ? `Local Race · 0ms${padInfo}` : `Room ${s.room.slice(0, 8)} · ${conn.status} (${conn.latency}ms)${padInfo}`);
  }

  // Topbar pills
  setTextIfChanged(el('drive-conn-pill'),room.local ? 'LOCAL · 0MS' : `${conn.status} · ${conn.latency}MS`);
  setTextIfChanged(el('drive-circuit-tag'),track.name.toUpperCase());
  setTextIfChanged(el('drive-corner-name'),track.cornerName(car.distance));

  // Starting lights
  lightsEl.hidden = r.phase !== 'lights';
  if (r.phase === 'lights') {
   const lit = clamp(Math.ceil(5 - r.countdown), 0, 5);
   if (lit > prevLightsLit && audioEnabled) audio.playStartBeep(false);
   prevLightsLit = lit;
   for (let i = 0; i < lightPods.length; i++) lightPods[i].classList.toggle('lit', i < lit);
   setTextIfChanged(el('drive-launch-label'),dMode === 'human'
     ? 'GET READY — FLOOR GAS ON LIGHTS OUT!'
     : dMode === 'jev'
      ? 'JEV ON THE GRID — LIGHTS SEQUENCE'
      : 'AUTOPILOT ARMED — LIGHTS SEQUENCE');
  } else {
   if (prevPhase === 'lights' && r.phase === 'racing') {
    if (audioEnabled) audio.playStartBeep(true);
    showAlert('LIGHTS OUT AND AWAY WE GO!', 'green', 2400);
   }
   prevLightsLit = 0;
  }
  prevPhase = r.phase;

  // Timing & position
  setTextIfChanged(el('drive-pos-val'),`P${place}`);
  setTextIfChanged(el('drive-lap-val'),`${Math.min(r.laps, car.lap + 1)} / ${r.laps}`);
  const curLapSec = car.finishTime !== null ? car.lastLap : Math.max(0, r.time - car.lapStart);
  setTextIfChanged(el('drive-cur-lap'),curLapSec > 0 ? formatLap(curLapSec) : '0:00.000');
  setTextIfChanged(el('drive-best-lap'),car.bestLap > 0 ? formatLap(car.bestLap) : '—:—.———');

  const {flag} = raceControlTelemetry(r);
  const rain = r.control?.rain ?? 'dry';
  const flagEl = el('drive-flag-chip');
  setTextIfChanged(flagEl,replayActive
   ? 'REPLAY'
   : flag === 'safety-car'
    ? 'SAFETY CAR'
    : flag === 'yellow'
     ? 'YELLOW'
     : rain !== 'dry'
      ? rainLabel(rain).toUpperCase()
      : 'GREEN');
  setAttributeIfChanged(flagEl,'data-sign',flag === 'green' ? 'fast' : 'slow');

  const penTag = el('drive-pen-tag');
  penTag.hidden = car.penalty <= 0;
  if (car.penalty > 0) setTextIfChanged(penTag,`+${car.penalty}s PEN`);

  for (let i = 0; i < 3; i++) {
   setAttributeIfChanged(sectorChips[i],'data-state',car.sector === i ? 'active' : car.splits[i] ? car.splitColours[i] : 'idle');
  }

  // Standings compact tower (top 7 + player if outside top 7)
  const visible = order.slice(0, 7);
  if (place > 7 && order[place - 1]) visible.push(order[place - 1]);
  const leaderDist = order[0]?.car.distance ?? 0;
  const gapText: string[] = [];
  const stHtml = visible.map((row) => {
   const idx = order.indexOf(row);
   const isPlayer = row.entry.seat === seat;
   const gapSec = idx === 0 ? 'LEAD' : `+${(Math.max(0, leaderDist - row.car.distance) / Math.max(30, row.car.speed)).toFixed(1)}s`;
   gapText.push(row.car.finishTime !== null ? 'FIN' : gapSec);
   const col = constructors[row.entry.team]?.[0] ?? '#ed3446';
   const comp = (row.car.compound ?? 'medium') as Compound;
   return `<div class="drive-st-row${isPlayer ? ' is-player' : ''}"><span class="drive-st-pos">${idx + 1}</span><i class="drive-st-bar" style="background:${col}"></i><span class="drive-st-code">${row.entry.code}${isPlayer ? ` <small>${DRIVER_LABELS[dMode]}</small>` : ''}</span><span class="drive-st-gap"></span><span class="drive-st-tyre" data-c="${comp}">${COMPOUND_SHORT[comp]}</span></div>`;
  }).join('');
  if (stHtml !== lastStandingsHtml) {
   lastStandingsHtml = stHtml;
   const tower = el('drive-standings');
   tower.innerHTML = stHtml;
   standingGaps = Array.from(tower.querySelectorAll('.drive-st-gap'));
  }
  standingGaps.forEach((node, i) => setTextIfChanged(node, gapText[i]));

  // Strategy strip + Radio banner timeout
  setTextIfChanged(el('dst-pace'),`PACE: ${car.instruction.pace.toUpperCase()}`);
  setTextIfChanged(el('dst-ers'),`ERS: ${(localErsMode ?? car.instruction.ers).toUpperCase()}`);
  setTextIfChanged(el('dst-tactic'),car.instruction.tactic.toUpperCase());
  const boxBadge = el('dst-box');
  boxBadge.hidden = !car.instruction.box && car.pit === 'none';
  if (!boxBadge.hidden) {
   setTextIfChanged(boxBadge,car.pit !== 'none' ? `IN PIT LANE · ${car.pit.toUpperCase()}` : `BOX THIS LAP · ${car.instruction.tyre.toUpperCase()}`);
  }
  if (now > radioBannerUntil) el('drive-radio-banner').hidden = true;
  if (now > alertUntil) el('drive-alert').hidden = true;

  // Tachometer & Pedals
  const kph = Math.round(car.speed * 3.6);
  setTextIfChanged(el('drive-speed-val'),String(kph).padStart(3, '0'));
  setTextIfChanged(el('drive-rpm-val'),`${Math.round(car.rpm)} RPM`);
  setTextIfChanged(el('drive-gear-val'),String(car.gear));
  el('drive-thr-bar').style.height = `${Math.round(car.throttle * 100)}%`;
  el('drive-brk-bar').style.height = `${Math.round(car.brake * 100)}%`;

  const rpmRatio = clamp((car.rpm - 8500) / (12800 - 8500), 0, 1);
  const rev=Math.round(clamp((car.rpm-3500)/9300,0,1)*100);
  if(rev!==previousRev){revArc.setAttribute('stroke-dashoffset',String(100-rev));previousRev=rev;}
  const litLeds = Math.round(rpmRatio * 15);
  el('drive-shift-leds').classList.toggle('flash', car.rpm >= 12650);
  for (let i = 0; i < 15; i++) {
   shiftLeds[i].className = i < litLeds ? (i < 5 ? 'lit-g' : i < 10 ? 'lit-r' : 'lit-p') : '';
  }

  // Status pills (DRS, Active Driver Lamp, TC, ABS)
  const drsPill = el('drive-drs-pill');
  const drsReady = drsAllowed(car, track) && r.time > 20;
  setAttributeIfChanged(drsPill,'data-state',car.drs ? 'open' : drsReady ? 'ready' : 'off');
  setTextIfChanged(drsPill,car.drs ? 'DRS OPEN' : drsReady ? 'DRS READY' : 'DRS');

  const driverLamp = el('drive-driver-lamp');
  setAttributeIfChanged(driverLamp,'data-mode',dMode);
  const dec = s.decisions[seat];
  const style = s.aiControlStyle?.[seat];
  const badge = style && style !== 'tactical' ? AI_CONTROL_LABELS[style]
    : dMode === 'jev' || dMode === 'luna'
     ? `${DRIVER_LABELS[dMode]}${dec ? ` · ${dec.responseMs}MS` : ''}`
     : dMode === 'human' ? 'YOU' : 'AUTO';
  setTextIfChanged(driverLamp,s.stepLockWaiting ? `${badge} · WAITING ON AI` : badge);
  driverLamp.classList.add('active');

  el('drive-tc-lamp').classList.toggle('active', dMode === 'human' && tractionControl !== 'off');
  el('drive-abs-lamp').classList.toggle('active', dMode === 'human' && absEnabled);

  // ERS & Fuel
  const ersModeDisplay = dMode === 'human' && localErsMode ? localErsMode : car.instruction.ers;
  const deploying = (car.ersPowerKw ?? 0) > 5;
  const ersModeEl = el('drive-ers-mode');
  setTextIfChanged(ersModeEl,`${deploying ? 'DEPLOYING' : ersModeDisplay.toUpperCase()} · ${Math.round(car.ers)}%`);
  setAttributeIfChanged(ersModeEl,'data-mode',deploying ? 'overtake' : ersModeDisplay === 'harvest' ? 'none' : 'balanced');
  const ersFill = el('drive-ers-fill');
  ersFill.style.width = `${clamp(car.ers, 0, 100)}%`;
  ersFill.classList.toggle('overtake', deploying);

  setTextIfChanged(el('drive-fuel-val'),`${car.fuel.toFixed(1)} KG`);
  setTextIfChanged(el('drive-bb-val'),`${brakeBias}%`);
  const tyreBadge=el('drive-tyre-badge');
  if(tyreBadge.dataset.compound!==car.compound){tyreBadge.dataset.compound=car.compound;tyreBadge.textContent=car.compound.toUpperCase();}

  // MFD Car & Pit updates
  const tyreLife = Math.round((1 - car.wear) * 100);
  setTextIfChanged(el('mfd-tyre-life'),`${tyreLife}%`);
  setAttributeIfChanged(el('mfd-tyre-life').parentElement!,'data-health',tyreLife > 45 ? 'good' : tyreLife > 22 ? 'warn' : 'crit');
  setTextIfChanged(el('mfd-tyre-temp'),`${Math.round(car.temperature)}°C`);
  setAttributeIfChanged(el('mfd-tyre-temp').parentElement!,'data-health',car.temperature > 112 ? 'crit' : car.temperature > 104 ? 'warn' : 'good');
  setTextIfChanged(el('mfd-ers-val'),ersModeDisplay.toUpperCase());
  setTextIfChanged(el('mfd-bb-val'),`${brakeBias}%`);
  const dmgPct = Math.round(damageLevel(car.damage) * 100);
  setTextIfChanged(el('mfd-dmg-val'),`${dmgPct}%`);
  setTextIfChanged(el('mfd-warn-val'),`${car.warnings} / +${car.penalty}s`);
  setTextIfChanged(el('mfd-cur-tyre'),car.compound.toUpperCase());
  setTextIfChanged(el('mfd-next-tyre'),nextCompound.toUpperCase());
  const boxBtn = el('mfd-box-btn');
  if(boxBtn.classList.contains('armed')!==car.instruction.box){
   boxBtn.classList.toggle('armed',car.instruction.box);
   boxBtn.innerHTML = car.instruction.box ? 'BOX ARMED · CANCEL <kbd>P</kbd>' : 'REQUEST BOX THIS LAP <kbd>P</kbd>';
  }
  setTextIfChanged(el('mfd-pit-est'),`${(track.PIT_STOP_SECONDS + damageRepairSeconds(car.damage)).toFixed(1)}s`);

  // Minimap dots
  if(now-lastMapAt>=100){
   lastMapAt=now;
   const fieldDots = el('dm-field').children;
   for (let i = 0; i < fieldDots.length; i++) {
    const f = r.field[i];
    if (!f) continue;
    const pt = track.pointAt(f.distance);
    moveMapDot(fieldDots[i],pt);
   }
   const pPt = track.pointAt(car.distance);
   moveMapDot(el('dm-player'),pPt);
   const rPt = track.pointAt(rival.distance);
   moveMapDot(el('dm-rival'),rPt);
  }
  // T-cam 2026 Halo Overlay (when in T-Cam & racing)
  if (cameraKind === 'tcam' && haloVisible && r.phase === 'racing' && !menuOpen) {
   tcam.update(
    seat,
    car,
    playerEntry(seat),
    place,
    track.cornerName(car.distance),
    Math.min(r.laps, car.lap + 1),
    curLapSec > 0 ? formatLap(curLapSec) : '0:00.000',
    car.bestLap > 0 ? formatLap(car.bestLap) : '—:—.———',
   );
  } else {
   tcam.hide();
  }

  // Chequered Flag Results
  if (isFinished) {
   setTextIfChanged(el('res-title'),`${order[0].entry.name} wins ${track.name}!`);
   setTextIfChanged(el('res-pos'),`P${place}`);
   setTextIfChanged(el('res-best'),car.bestLap > 0 ? formatLap(car.bestLap) : '—:—.———');
   setTextIfChanged(el('res-stops'),String(car.stops));
   setTextIfChanged(el('res-pen'),`${car.penalty}s`);
   const rHtml = order.slice(0, 10).map((row, idx) => {
    const isP = row.entry.seat === seat;
    const comp = (row.car.compound ?? 'medium') as Compound;
    const timeStr = row.car.finishTime !== null ? formatLap(row.car.finishTime) : `+${Math.round(Math.max(0, leaderDist - row.car.distance))}m`;
    return `<tr class="${isP ? 'is-player' : ''}"><td>P${idx + 1}</td><td>${escapeHtml(row.entry.name)}${isP ? ' (YOU)' : ''}</td><td>${comp.toUpperCase()}</td><td>${timeStr}</td></tr>`;
   }).join('');
   if (rHtml !== lastResultsHtml) {
    lastResultsHtml = rHtml;
    el('res-tbody').innerHTML = rHtml;
   }
  }
 }

 function tick(now: number) {
  frameId=0;
  if(disposed||hidden())return;
  scene??=makeScene();
  frameId=requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  const s = conn.state;
  const activeDriving = Boolean(s && (s.race.phase === 'racing' || s.race.phase === 'lights') && !menuOpen);
  const polled = controls.poll(dt, activeDriving);
  latestGamepadName = polled.gamepadName;
  const inp = polled.inputs;

  if (inp.shiftUp && gearbox === 'manual') manualGear = clamp(manualGear + 1, 1, 8);
  if (inp.shiftDown && gearbox === 'manual') manualGear = clamp(manualGear - 1, 1, 8);
  if (inp.drsToggle) {
   const car = s?.race.cars[seat];
   if (car && drsAllowed(car, track)) {
    manualDrs = !manualDrs;
    if (audioEnabled) audio.playDrsBeep();
   }
  }
  if (inp.brake > 0.05) manualDrs = false;

  // Throttle manual driving inputs: send on change (up to 20 Hz) and keep-alive at 600 ms
  if (s && s.race.phase === 'racing' && currentDriverMode(s) === 'human' && !document.hidden) {
   const input: HumanControlInput = menuOpen
    ? {throttle: 0, brake: 0.4, steer: 0, pitAssist}
    : {
       throttle: Math.round(inp.throttle * 100) / 100,
       brake: Math.round(inp.brake * 100) / 100,
       steer: Math.round(inp.steer * 100) / 100,
       ersOvertake: inp.ersOvertake,
       ersMode: localErsMode,
       drs: manualDrs,
       brakeBias,
       gear: gearbox === 'manual' ? manualGear : undefined,
       tc: tractionControl,
       abs: absEnabled,
       pitAssist,
      };
   const sig = JSON.stringify(input);
   const changed = sig !== lastControlSignature;
   const minGap = changed ? 50 : 600;
   if (now - lastControlSentAt >= minGap) {
    lastControlSentAt = now;
    lastControlSignature = sig;
    conn.send({type: 'control', input});
   }
  }

  // Render 3D world from authoritative interpolated room state (or Instant Replay)
  if (s) {
   let renderedRace = interpolate(s, conn.received, now);
   if (replayActive && replayFrames.length > 1) {
    const pos = ((now - replayStartAt) / 1000) * 0.65 * (1 / (8 * DT));
    if (pos >= replayFrames.length - 1) {
     replayActive = false;
    } else {
     const idx = Math.floor(pos);
     renderedRace = blendRace(replayFrames[idx], replayFrames[idx + 1], pos - idx);
    }
   }

   scene.setLookBack(polled.lookBack && !menuOpen);
   scene.setHideCar(cameraKind === 'nose' ? seat : null);
   el('drive-rear-chip').hidden = !polled.lookBack || menuOpen;
   const desiredCam = resolveSceneCamera(); if (scene.activeCamera !== desiredCam) scene.setMode(desiredCam); scene.render(renderedRace, now);

   // Update V6 Hybrid Audio & Gamepad Rumble
   const car = renderedRace.cars[seat];
   if (audioEnabled && renderedRace.phase === 'racing' && !menuOpen) {
    const offTrack = Math.abs(car.offset) > track.trackHalfWidth(car.distance) + 0.5;
    audio.update({
     rpm: car.rpm,
     throttle: car.throttle,
     brake: car.brake,
     speed: car.speed,
     gear: car.gear,
     wheelspin: 0,
     lockup: car.lockup ?? 0,
     offTrack,
     onKerb: offTrack,
     ersDeploying: (car.ersPowerKw ?? 0) > 5,
     onRevLimiter: car.rpm >= 12750,
     active: true,
    });
    if (currentDriverMode(s) === 'human') {
     controls.rumble(
      offTrack || car.lockup ? 0.5 : 0,
      car.lockup ? 0.7 : offTrack ? 0.35 : 0,
      80,
     );
    }
   } else {
    audio.update({
     rpm: 4000, throttle: 0, brake: 0, speed: 0, gear: 1,
     wheelspin: 0, lockup: 0, offTrack: false, onKerb: false, ersDeploying: false, onRevLimiter: false, active: false,
    });
   }

   if (now - lastHudAt >= 50) {
    lastHudAt = now;
    updateHud(s, renderedRace, now);
   }
  }
 }

 function onVisibility(){
  if(disposed)return;
  if(hidden()){
   cancelAnimationFrame(frameId);frameId=0;
   if(audioEnabled)audio.setEnabled(false);
  }else if(!frameId){
   lastFrameAt=performance.now();if(audioEnabled)audio.setEnabled(true);
   frameId=requestAnimationFrame(tick);
  }
 }
 if(embedded){
  document.addEventListener('visibilitychange',onVisibility);
  document.addEventListener('mcp-visibility',onVisibility);
 }
 onVisibility();

 return {
  get connection() { return conn; },
  suspend3D:()=>{
   if(!embedded)return;
   cancelAnimationFrame(frameId);frameId=0;
   scene?.dispose();scene=undefined;
  },
  dispose: () => {
   if(disposed)return;
   disposed = true;
   document.removeEventListener('visibilitychange',onVisibility);
   document.removeEventListener('mcp-visibility',onVisibility);
   cancelAnimationFrame(frameId);
   window.removeEventListener('keydown', onKeyDown);
   eventLog?.dispose();
   clearTimeout(copyTimer);controls.dispose();
   audio.dispose();
   tcam.dispose();driverRadio?.dispose();replayFrames.length=0;
   Reflect.deleteProperty(window,'__raceState');Reflect.deleteProperty(window,'__driveDebug');
   conn.close();
   scene?.dispose();scene=undefined;app.replaceChildren();elements.clear();
   document.body.classList.remove('drive-active');
  },
 };
}
