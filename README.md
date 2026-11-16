# Jev Grand Prix

Two teams. Two speeds of intelligence. Monza by day. Las Vegas by night. Built for Ruben Casas ([@Infoxicador](https://x.com/Infoxicador)).

**Vector** is calm and precise, in orange. **Chaos** is aggressive, in violet. Each has a slow race engineer and a fast driver. Choose **Jev vs Jev** or **Jev vs Luna**; in the latter, Vector uses Jev and Chaos uses GPT-6 Luna through OpenAI Decisions. The engineer chooses strategy; Jev chooses structured driving intent; a deterministic local controller handles acceleration, braking and line following. Every window watches the same authoritative race.

## Run

Requires **Node.js 22+** (verified on 24.14.0).

```sh
cd jev-grand-prix
npm ci
npm run demo
```

The launcher starts a local server on **http://127.0.0.1:5277** and opens three independent Chromium app windows side by side: **Vector | Broadcast | Chaos**. It installs Chromium if missing. Ctrl+C or closing a demo window cleans up its browsers and server. An occupied port is rejected; use `PORT=5278 npm run demo` for another instance. The demo defaults to `JEV_MOCK=1`, even when a local key exists.

Manual windows:

```sh
npm run dev
# http://127.0.0.1:5277/?team=a
# http://127.0.0.1:5277/?team=b
# http://127.0.0.1:5277/?spectate
```

Production assets locally: `npm run build && npm start`. Reachability: `curl --fail http://127.0.0.1:5277/health`. Circuit tour: `/?track`.

Keep both team seats open. Missing seats pause physics without losing laps, tyres or strategy. WebSockets reconnect with backoff; an occupied seat becomes a spectator. Separate rooms have distinct owner, team and sandbox capabilities. Team credentials live in URL fragments and the WebSocket join message. Spectator URLs contain none.

## Record for X

Maximize the broadcast window to 1440×980 or 1920×1080. **Title sequence → Lights out** resets the default race and gives a clean recording start. The opening title is also available with `/?spectate&intro`. The engineer/radio panels, battle banner, timing tower and telemetry work with the sound muted.

Use **07 Onboard**, **23 Onboard**, **Broadcast**, **Aerial** or **Car detail** to switch cameras. Onboard includes the physical halo, visible nose/wheels and a steering wheel dash with gear, speed, DRS and ERS. Broadcast cycles through chase, trackside and helicopter cameras; overtakes and near misses trigger cuts. **Instant replay** replays the closest captured on-track lead change at 0.65×; **Back to live** restores the race. Results show classification, race and best-lap times, tyre stops and the winner. **Race again** resets the owner’s race.

Three laps take about 80–100 wall seconds at the default **4× race clock**. `npm run demo:realistic` uses real simulation time (1×); up to 24× is supported for tests. Tyre degradation is deliberately accelerated so undercuts matter in three laps. Each pit-wall view has **Push / Manage / Box, box** radio overrides; they take priority for three wall seconds. Engineers otherwise update every 12 simulated seconds (3 wall seconds at 4×). Drivers request a decision every 200 ms, with one request in flight per team. A late response never advances or rewinds physics.

## Real agents and keys

No keys were copied from Pong. All verification uses mocks or injected fixtures. To configure real agents:

```sh
cp .env.local.example .env.local
```

For a direct Jev key:

```dotenv
JEV_PROVIDER=typesafe
TYPESAFE_API_KEY=your-key
JEV_MODEL=jev-latest
JEV_MOCK=0
```

Or choose `JEV_PROVIDER=openrouter` with `OPENROUTER_API_KEY` and `JEV_MODEL=jev-1.13`; or `JEV_PROVIDER=vercel` with `AI_GATEWAY_API_KEY` and `JEV_MODEL=typesafe-ai/jev`. This reuses Pong’s official `@typesafe-ai/sdk` 0.7.0 `TypeSafeClient.systemOne({state,questions})` integration, with `choice()` questions for line, pace, brake aggression, ERS, DRS and a persona-driven radio reply. [Official SDK source](https://github.com/typesafe-ai/typesafe-sdk-js).

The slow engineer uses server-side OpenRouter or Vercel AI Gateway chat completions:

```dotenv
ENGINEER_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key
ENGINEER_MODEL=openai/gpt-4.1
ENGINEER_MOCK=0
```

For Gateway, set `ENGINEER_PROVIDER=vercel` and `AI_GATEWAY_API_KEY`. The model is configurable. Engineer output is validated JSON: pace, ERS mode, pit instruction, next compound, attack/defend/hold and a short radio line. Failures use explicitly labelled rule-based fallbacks. Requests have timeouts and no automatic retries.

Run `JEV_MOCK=0 npm run demo` to opt into configured live providers. `npm run dev` and `npm start` read `.env.local`; no configured key means automatic mock for that brain. **`JEV_MOCK=1` overrides every provider**, including the engineer. `ENGINEER_MOCK=1` mocks only engineers. Keys, provider URLs and SDK clients stay on the server; no provider secrets are bundled into web or MCP HTML. Live API availability and spending were not tested. The UI labels mock, live and fallback decisions individually. The header shows **APIS CONFIGURED** until a real response is observed, **JEV LIVE** after successful Jev decisions, or **API FALLBACK** when a driver fails. The driver card shows **confirmed responses / attempts** and a safe error message with HTTP status. `/health` exposes the same per-team attempt/success/fallback counters and latest error metadata. A configured key alone does not establish successful inference.

Authentication failures (401/403) disable further Jev requests until the server restarts. Correct the ignored `.env.local` key, stop the old process and run `JEV_MOCK=0 npm run demo`. Rate limits honor `Retry-After`; transient network/provider failures use bounded backoff. Cooldowns survive seat reconnects and race resets. Raw provider response bodies and keys never enter public error messages.

## Jev versus Luna

```sh
npm run demo:luna
```

This opens **Vector / Jev** against **Chaos / GPT-6 Luna**. It defaults to mock mode. The race owner can also choose **Jev vs Luna** from the **Drivers** selector above the feed; changing the matchup starts a fresh race and updates every connected view. Team seats and invitation credentials stay intact. `RACE_MATCHUP=jev-vs-luna` selects the initial mode for `npm run dev` or `npm start`.

For real Jev and real Luna, put both keys in the ignored `.env.local`:

```dotenv
JEV_PROVIDER=typesafe
TYPESAFE_API_KEY=your-typesafe-key
JEV_MODEL=jev-latest
OPENAI_API_KEY=your-openai-key
ENGINEER_MOCK=1
```

Then launch explicitly:

```sh
JEV_MOCK=0 LUNA_MOCK=0 npm run demo:luna
```

Stop an existing demo first so port 5277 is free. Engineers remain mocked in this example; configure them separately above if desired. Real Jev success displays **JEV / SYSTEM ONE**; real Luna success displays **LUNA / DECISIONS**. Both driver panels expose confirmed-response counters. **LIVE + MOCK** indicates one driver lacks a key or is explicitly mocked; **API FALLBACK** means an attempted provider call failed.

Luna ports Pong’s server-side **`POST https://api.openai.com/v1/decisions`**, pinned to **`gpt-6-luna`**. It receives compact JSON telemetry and the engineer instruction, then answers the same six bounded choices as Jev: racing line, pace bias, brake aggression, ERS, DRS and a persona radio reply. Named answers are decoded independently of order; refusals, missing/duplicate answers, invalid choices/confidence, wrong models, HTTP failures and timeouts are labelled Luna fallbacks. No automatic HTTP retries occur. See the [official OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

As in Pong, live Luna defaults to **600 ms after each response**, paced further by actual input tokens, the tighter configured/provider token budget and request limits, with 20% headroom. Configure `LUNA_INTERVAL_MS` (200–60000, default 600) and `LUNA_TPM_BUDGET` (default 60000). The local controller continues at 120 Hz while inference is in flight. HTTP 429 honors `Retry-After`, including long daily limits. The panel reports recognized numeric quota units without exposing upstream messages, organization IDs or keys. Authentication failures require a corrected key and server restart. Provider cooldowns survive race reset, seat reconnect and switching away from and back to Luna.

`JEV_MOCK=1` forces **all** providers to mocks; `LUNA_MOCK=1` mocks only Luna. No key automatically mocks that driver; `LUNA_MOCK=0` explicitly requires `OPENAI_API_KEY`. All tests, including the full Jev-vs-Luna race and MCP invitations, use mock brains or injected response fixtures. No real Luna quota or inference success is claimed by these checks.

## MCP Apps: two hosts, one race

The local server exposes **Streamable HTTP at `/mcp`**. The linked `ui://jev-grand-prix/pit-wall.html` resource bundles the same Three.js renderer and UI in one HTML document using the official MCP Apps SDK. The included host uses `AppBridge` through a separate-origin double-iframe sandbox.

```sh
npm run demo:mcp
# Game + MCP: http://127.0.0.1:5277
# MCP host:   http://127.0.0.1:5278/?player=a&autoplay=1
# Sandbox:    http://127.0.0.1:5279
```

Use another PORT if a demo is already running. Or run `npm run build && npm start`, then `npm run mcp:host` separately. The local host can connect only to a server reachable from its machine; registration in real ChatGPT/Claude accounts was not automated.

1. First host calls `open_grand_prix({player:"a",autoplay:true})`. Without an invitation this creates a new isolated mock race.
2. Copy the **team B invitation** from the app. Clipboard restrictions fall back to a focused, selected, read-only field; press ⌘C / Ctrl+C if needed.
3. Second host calls `open_grand_prix({invite:"jev:…:b:…",autoplay:true})`. It joins the exact room and gets only its own seat, with no owner or opponent credential.
4. **Open web app** opens a credential-free spectator link. Both embedded apps and the browser see the same room, telemetry and radio.

Invitations also work in the browser: **Invite a team → Join by invitation**, or open the invited team URL. `player:"both"` runs both empty seats from one app; copying an invitation releases team B. `player:"spectator"` starts none. Closing/stopping an app releases only its own controllers. Visibility changes stop owned controllers and hide its WebGL canvas; the race pauses if either team is missing. Host theme variables, safe areas, fullscreen, openLink and teardown are handled. `grand_prix_status({room})` reads state without starting AI calls.

Local MCP rooms expire after two hours. Public Worker rooms expire after 15 minutes and always force mocks. Pass `matchup:"jev-vs-luna"` when creating a race to select Luna. An invitation preserves the existing room’s matchup regardless of the second host’s defaults. The included host accepts `?player=a&autoplay=1&matchup=jev-vs-luna`. MCP protocol, sandbox, invitations and shared-race behavior are tested with the actual SDK, not a simulated postMessage host.

```mermaid
flowchart LR
    H[ChatGPT / Claude / local MCP host] <-->|Streamable HTTP /mcp| S[Node server or Cloudflare Worker]
    S -->|tool result + bundled UI resource| H
    H <-->|MCP Apps SDK| A[Sandboxed team pit wall]
    W[Team A / Team B / browser spectator] <-->|WebSocket snapshots at 30 Hz| R[Authoritative room]
    A <-->|same room WebSocket| R
    S --> R
    R -->|telemetry every 12 simulated seconds| E[Slow engineer: main LLM or mock]
    E -->|structured strategy + radio| R
    R -->|compact state + strategy| J[Fast Jev driver: SDK or mock]
    J -->|validated intent every 200 ms| R
    R --> P[Deterministic controller and physics at 120 Hz]
    P --> R
    R --> D[Durable Object checkpoint and expiry on Worker]
```

## Circuit and simulation

The centreline is **real Monza geometry**, from [`bacinger/f1-circuits`, `circuits/it-1922.geojson`](https://github.com/bacinger/f1-circuits/blob/master/circuits/it-1922.geojson). The original file is checked into `data/monza.geojson`; `monza.json` is the identical JSON import used by Node, Vite and workerd. Copyright © 2019–2025 Tomislav Bacinger, **MIT licence**, included in [data/LICENSE-f1-circuits.txt](data/LICENSE-f1-circuits.txt).

Coordinates are projected to local metres at the circuit latitude. The measured closed centreline is **5,793.163 m**, within 0.003% of [Monza’s published 5,793 m](https://www.monzanet.it/tracciato-pista-monza/). It is never scaled to force the result. The GeoJSON’s first vertex is partway up the straight; a 310 m station shift aligns the presentation’s control line approximately with the FIA map. Named corners include Rettifilo, Curva Grande, Roggia, both Lesmos, Ascari and Parabolica.

Sector and DRS placement follows the [2025 FIA circuit map](https://www.fia.com/system/files/decision-document/2025_monza_event_-_circuit_map_-_monza_2025.pdf): S1 233 m before T4, S2 215 m before T8, first DRS detection 95 m before T7 and activation 170 m after it, second detection after T11 and activation 12 m after the control line. Corner stations, pit-lane offset and infrastructure are hand-annotated approximations on the sourced centreline, not a surveyed digital twin. The 2025 DRS format is intentional; this demo is not a simulation of 2026 sporting regulations. The FIA map is referenced, not redistributed or relicensed as MIT.

The deterministic model includes throttle/braking, eight gears, curvature-aware speed limits and braking lookahead, smoothed lateral intent, grip, slipstream, dirty air, detection-latched ≤1s DRS eligibility, zone-limited activation, deploy/balanced/harvest ERS, soft/medium/hard compounds, temperature and wear, fuel mass/consumption, an 80 km/h pit limiter, a **2.6 s** stationary tyre change, track-limit warnings and five-second penalties, sectors, best/last laps and finishing classification. The speed trap is sampled at its track station. Replay stores the best on-track lead change. Mock engineers deliberately use different stop windows; a controlled test proves the early undercut changes the outcome.

The scene uses detailed original 2025-style cars with sculpted nose/monocoque/sidepods, open cockpit, halo, driver/visor, suspension wishbones, multi-element wings, diffuser, rotating slick tyres, 18-inch wheel covers, compound markings and animated steering/DRS. Physically based carbon, clearcoat paint, metal and rubber respond to local HDR daylight. Real shadow maps, textured tarmac with rubber buildup, mottled terrain, gravel, mesh fencing, Armco, grandstands and instanced volumetric leaf clusters replace the original box cars and cone trees. Trackside cameras use anchored positions and telephoto framing; the aerial shot frames the battle more tightly. Scenery is batched and spatially culled, and pixel ratio is capped at 1.5.

Four local textures/HDR files come from **Poly Haven, CC0**: [Asphalt 02](https://polyhaven.com/a/asphalt_02), [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock), and [Kloofendal daylight](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky). Authors and licence links are in [asset attribution](src/race/assets/ATTRIBUTION.md). No external asset/font requests occur during the race; the MCP build embeds its assets.

### Driving and visual realism

For realistic apparent motion, use the real-time launcher. The ordinary recording launcher retains the accelerated 4× clock:

```sh
npm run demo:realistic
# Real Jev / Luna drivers, real-time simulation (requires configured keys):
JEV_MOCK=0 LUNA_MOCK=0 npm run demo:realistic -- --matchup=jev-vs-luna
```

The car envelope uses a **3.6 m wheelbase, 2.0 m width and 800 kg dry mass**, consistent with the [2025 FIA regulations](https://www.fia.com/system/files/documents/fia_2025_formula_1_technical_regulations_-_issue_02_-_2025-02-26.pdf). The hybrid model follows the [MCL39 specification](https://www.mclaren.com/racing/formula-1/2025/mcl39-technical-specification/): 120 kW electric deployment, 4 MJ deployment budget and 2 MJ recovery budget per lap. Engine output and drag/downforce coefficients are explicit calibration estimates in `src/race/vehicle.ts`, not proprietary measurements. [Brembo's 2025 Monza braking data](https://brem-p-001.sitecorecontenthub.cloud/api/public/content/a7758d9026e14e81b940a82dd992941c?v=cc87e1fe) supplies braking and corner-speed reference points; the simulation does not match every corner exactly.

Physics now integrates power/traction-limited acceleration, quadratic aero drag/downforce, tyre load sensitivity, a combined braking/cornering friction envelope, fuel mass, ERS energy accounting and finite steering. DRS reduces drag/downforce, a tow reduces drag, and dirty air reduces downforce. Excess speed saturates lateral grip and produces understeer/runoff; there is no hard attachment to a centreline. The controller follows a bounded minimum-curvature racing line, with tactical agent offsets, predictive braking and same-lane following distance. Steering wheels, front wheels, pitch, roll, wheel rotation and the rear-wing flap respond to telemetry.

The original unscaled GeoJSON length is preserved for timing stations. A local 8 m smoothing kernel removes digitisation kinks for the rendered/driven path; its sampled length remains within 1% of the original. The track is approximately 12 m wide, widening to 15 m on the grid; these widths and runoff/pit placements are illustrative. The deterministic fresh-tyre calibration test completes a flying lap within 75–90 seconds, stays within the track and bounds lateral force at 5.5 g. `npm run test:handling` saves full strategic-race telemetry and prints the clean-lap calibration. The default three-lap tyre wear is still deliberately accelerated.

**Car detail** works before connecting drivers. For inspection angles open `/?spectate&camera=detail&angle=front` (also `rear`, `side`, `top`). The render verification saves front/rear/side, aerial and onboard PNGs in `artifacts/realism-*.png`. On macOS, Playwright uses headed Chromium to exercise the Metal hardware path; `PW_HEADLESS=1` opts into software/headless testing, which is substantially slower for this scene.

## Las Vegas night race

Choose **Las Vegas / Night** in the broadcast view's circuit selector, or launch all three windows directly at Vegas:

```sh
npm run demo:vegas
# Real Jev and Luna, with your existing server-side keys:
JEV_MOCK=0 LUNA_MOCK=0 npm run demo:vegas -- --matchup=jev-vs-luna
```

The Vegas launcher uses a **1× race clock**. `RACE_CIRCUIT=las-vegas npm run dev` also selects Vegas at server startup. Monza remains the default. The race owner can change circuits; this starts a new race for everyone in the room. Team invitees cannot change the circuit. Reconnects, driver matchup changes and race resets preserve the selected circuit. Separate rooms can run different circuits at the same time.

Las Vegas includes the sourced 17-turn street layout, its own sectors, DRS detection/activation zones, speed trap and pit route. The night scene adds a correctly proportioned animated **Sphere**, floodlight rows, close street walls and catch fences, lit hotel façades, the Bellagio lake/fountains, Paris tower and High Roller. **Sphere** and **The Strip** camera buttons provide establishing shots, alongside the moving broadcast, aerial and onboard cameras. Short, load/speed-dependent underfloor sparks show clearly against the dark track. Cooler night conditions affect the existing tyre-temperature model.

The geometry measures **6,227.823 m**, within **0.433%** of the official 6,201 m, without rescaling. Corner stations and infrastructure are approximate. The real race photographs inspected, FIA map, Sphere dimensions, geometry licence and model limitations are documented in [Las Vegas references](data/LAS-VEGAS-REFERENCES.md). The reference photos are not bundled. All scene assets work locally and inside the self-contained MCP app.

For MCP, call `open_grand_prix` with `circuit: "las-vegas"` (and optionally `matchup: "jev-vs-luna"`). A joining invitation always preserves the original race's circuit, regardless of the joiner's defaults. The local MCP host accepts `?circuit=las-vegas&player=a&autoplay=1`.

```sh
RACE_CIRCUIT=las-vegas JEV_MOCK=1 npm run test:handling
RACE_CIRCUIT=las-vegas JEV_MOCK=1 npm run test:performance
PORT=5477 JEV_MOCK=1 npm run demo:vegas -- --smoke --headed --matchup=jev-vs-luna
```

## What is mocked or simplified

Default Jev/Luna decisions and engineer dialogue are deterministic rule-based mocks, labelled on screen. Fixture tests exercise the actual Jev SDK and engineer JSON adapter without contacting providers. The authoritative server, WebSockets, room capabilities, MCP SDK/Apps bridge, physics, timing, pit stops, browser rendering and shared state are real.

This is a recording demo, not a tyre or aerodynamic engineering simulator. Tyre wear is accelerated, and the standard recording launcher accelerates the clock; use `demo:realistic` for 1×. The tyre-limited bicycle model and controller are still simpler than a full six-degree-of-freedom vehicle, suspension and contact-patch simulation. Track width, scenery and pit-lane geometry are illustrative; proprietary aero maps and measured tyre curves are unavailable. No elevation, wet weather, safety car, audio/TTS, realistic damage or official F1 assets are included. Results can change with driver request timing, while fixed physics steps with identical inputs reproduce exactly. Headless screenshot runs can render slowly; the headed hardware GPU test is the performance measurement.

## Verify

```sh
JEV_MOCK=1 npm run verify
npm run test:worker        # local workerd only; no deployment
npm run worker:check       # wrangler dry-run only; no upload
npm run test:performance   # headed Chromium; writes artifacts/performance.json
PORT=5477 npm run demo:smoke -- --headed
```

`verify` runs strict Node/Worker typechecks, web/MCP/host production builds, Vitest, both Monza matchups and a Las Vegas three-context race and both circuits’ two-context MCP invitation tests with a browser spectator. Tests set mock flags regardless of keys. Screenshots are versioned under `artifacts/`: cockpit, broadcast, results, title and MCP view. Full command results and measured limits are in [VERIFICATION.md](VERIFICATION.md).

The original Pong working tree (including its invitation fixes) was copied without `.env.local`, `.git`, dependencies or generated artifacts. Its build and both browser scenarios passed before conversion. Local commit `ebb7eba` preserves that baseline, then M1–M5 evolve it. The source Pong folder was left untouched.

Cloudflare configuration targets a new **`jev-grand-prix`** Worker with Durable Objects, static assets, room rate limits, mock-only public agents, checkpoints and expiry alarms. `npm run dev:worker` runs locally. No account id, provider secrets or previous Pong deployment URL is inherited. **Nothing was deployed, published or pushed.**
