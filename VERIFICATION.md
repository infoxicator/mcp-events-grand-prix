# Jev Grand Prix verification

Verified locally on 2026-11-13. Node **24.14.0**, Apple **M4 Pro**, Chromium via Playwright, TypeSafe SDK **0.7.0**. All AI verification used deterministic mocks or injected provider fixtures. The original milestone verification made no paid provider calls. Later explicitly requested authentication diagnostics are recorded below; all automated tests remain mocked. No push, publication or deployment was performed.

All commands ran from this folder. This shell defaults to Node 20, so Node commands used this exact prefix:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
```

## Milestone evidence

- **Baseline:** copied the source working tree, including its uncommitted invitation and clipboard fixes; excluded `.env.local`, `.git`, dependencies and generated files. `npm ci` succeeded; the initial Node 20 install printed engine warnings. All subsequent builds and tests used Node 24. The copied Pong `npm run build` passed. `JEV_MOCK=1 npm run test:e2e` passed both scored three-context Pong scenarios in **48.0 s**, including reconnect, replay and Jev/Luna switching. Local baseline commit: `ebb7eba`.
- **M1:** sourced real Monza GeoJSON and MIT licence. Measured projected length **5793.163396 m**, against published **5793 m**. Production build/typechecks passed. Chromium rendered `/?track` with a real WebGL canvas, no page errors and HTTP health 200. Screenshot: `artifacts/m1-monza.png`. Commit: `59ab726`.
- **M2:** ten deterministic simulation/brain tests passed; two mock cars moved on the 3D racing line. Build/typechecks passed. The initial lap test waited 110 simulated seconds, which included a pit stop; changed its observation window to 160 seconds. Commit: `93806d0`.
- **M3:** 15 tests passed, including the real SDK with a fixture transport, engineer JSON validation/fallback and a complete three-lap race. The controlled strategy test compares identical mock inputs with and without Vector’s pit call, and asserts the undercut saves more than ten simulated seconds. Two strict typing issues found during the milestone were corrected and typecheck rerun before amending its local commit. Commit: `b75ecd1`.
- **M4:** the full three-context race, separate sandboxed MCP contexts with invitation joining, and a local Cloudflare workerd test passed. Shared state, seat isolation, owner authorization, clipboard fallback, browser invitation entry and independent teardown were exercised. Commit: `c84a009`.
- **M5:** final recording UI, camera corrections, source-aligned sector/DRS annotations, speed trap, contact shadows, measured performance, launcher and final verification. Its local commit follows the checks recorded below.

## Final commands

Commands below used the Node prefix above, followed by the exact command shown. The suite runs mock agents regardless of configured credentials.

| Command | Result |
| --- | --- |
| `JEV_MOCK=1 npm run verify` | PASS: strict Node + Worker typechecks; three production bundles; 15 Vitest tests; complete race Playwright scenario; sandboxed MCP invitation scenario |
| `npm run build` | PASS within `verify`: web, single-file MCP App, local SDK host/sandbox |
| `npm run typecheck` | PASS within `build`: strict main and Worker TypeScript configurations |
| `npm test` | PASS: 15 tests across two files |
| `JEV_MOCK=1 npm run test:e2e` | PASS within `verify`: three separate browser contexts, real WebSockets, both moving cars, engineer radio changing intent, both pit stops, sectors/laps, finish/results, replay, title/reset, reconnect and 480 px layout |
| `JEV_MOCK=1 npm run test:mcp` | PASS within `verify`: real SDK discovery/tool call/resource read; two independent AppBridge contexts; invitation joins one room; browser spectator agrees; safe private metadata; clipboard fallback; fullscreen; teardown; browser invitation form |
| `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-grand-prix-worker-test.log npm run test:worker` | PASS: local workerd / Durable Object / MCP invitation test, 5.9 s |
| `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-grand-prix-wrangler.log npm run worker:check` | PASS: 1256.96 KiB bundle, bindings/assets resolved; dry-run exited with no upload |
| `npm run test:performance` | PASS: 60.3 / 60.3 / 60.3 average FPS; GPU measurements saved |
| `PORT=5477 JEV_MOCK=1 npm run demo:smoke` | PASS: three independent Chromium app windows, both AI seats and intents, racing phase, HTTP health; cleaned up |

The first baseline browser command could not bind its local IPC socket inside the restricted sandbox. Rerunning with local server/browser execution permission passed. Network downloads similarly used authorized read-only network access. These were environment restrictions, not skipped tests.

## What the full race established

Final full race scenario: room `ad2a2430-c14a-4c92-976a-8c7a86ba944c`, **47.0 s** test time / **48.4 s** including server setup. Chaos won this run after the test deliberately ordered Vector to manage tyres. Both cars completed three timed laps and one tyre stop. Vector accepted **56** driver intents and made **24** engineer calls; Chaos accepted **52** intents and made **28** engineer calls. Provider attempts stayed **0**; page errors were **[]**.

Vector lap times: **95.850 / 138.792 / 102.100 s**. Chaos lap times: **94.167 / 117.517 / 99.517 s**. This is evidence of a complete network race, not a pre-rendered animation or predetermined result. Browser scheduling may change the result; replaying identical inputs at identical fixed physics steps is deterministic.

Vitest covers:

- projected real circuit length and a closed centreline;
- deterministic stepping, lap and sector timing;
- detection-latched ≤1 second DRS eligibility, wrong-zone rejection and pit exclusion;
- tyre wear, temperature-dependent grip, fuel consumption;
- aligned slipstream benefit and corner dirty-air penalty;
- exactly 2.6 seconds stopped, tyre fitting and 80 km/h pit limit;
- track-limit warnings and five-second penalties;
- distinct mock driver personalities, engineer undercut/management strategy and obedience;
- a complete strategic race, shared seats, sequence-checked intent acceptance, duplicate rejection, pause/rejoin;
- real `TypeSafeClient.systemOne` serialization/decoding with fixture answers;
- valid engineer JSON, malformed-output fallback and a mock flag that prevents transport calls;
- invitation round-tripping and rejection of opposing-seat/owner access.

## Visual and performance evidence

Screenshots saved and versioned in the repo:

- [Cockpit](artifacts/cockpit.png)
- [Broadcast](artifacts/broadcast.png)
- [Results](artifacts/results.png)
- [Title](artifacts/title.png)
- [MCP team app](artifacts/mcp-team-a.png)
- [Monza milestone fly-through](artifacts/m1-monza.png)

They were visually inspected. The first draft exposed trees inside the circuit because nearest-vertex distance is insufficient on long straight segments. Changed the clearance test to distance from every line segment. Camera chase smoothing also lagged behind at accelerated simulation speed; cameras now follow the already-interpolated car positions directly. Static geometry batches by material; park trees are instanced. Car meshes keep halo, wheels and distinct liveries.

Headless screenshots showed lower FPS and are not used to claim GPU performance. A separate headed Chromium check confirmed **ANGLE Metal / Apple M4 Pro** hardware acceleration. At **1100×850 per context**, three views at once measured approximately **60 FPS**, with fewer than 100 draw calls per view in the sampled shots. `scripts/performance.mjs` runs five samples, saves the GPU, viewport, draw calls, triangles, frame rates and mock health to `artifacts/performance.json`, and fails if any view averages under 55 FPS. This establishes this machine/configuration; it is not a guarantee for every MacBook or resolution.

## Scope and limits

Real: authoritative fixed-step server, room/seat capabilities, WebSocket traffic, interpolation, local control/physics, timing, strategy effects, pit stops, Three.js rendering, MCP protocol and sandbox bridge, local Worker Durable Objects and mock-only hosting configuration.

Mocked: default Jev decisions and slow engineer model calls. SDK/engineer fixtures prove adapter behavior, not real-account quota, latency or model quality. No paid endpoint was called. No actual ChatGPT or Claude account registration was automated.

Simplified: accelerated tyre wear and clock; controller-based lateral physics; approximate pit lane, corner/control-line stations and scenery; dry conditions only, no elevation/audio/damage/safety car. The full centreline is real, projected and unscaled. DRS follows the referenced 2025 Monza format, not the 2026 regulations.

A browser-bundle scan for `TypeSafeClient`, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `api.typesafe.ai` and `openrouter.ai/api` found no matches. A final `git status --short` in the source Pong repository showed exactly the same original seven modified files and three untracked invitation/clipboard files; its HEAD remained `b902805`. All edits and commits are in the new project.

## Final MCP result and running demo

Final MCP test: **29.7 s** / **30.9 s** including servers. Both sandboxed views and the spectator used room `cc237c69-5aa5-44e7-a352-200f75113a19`. Team A accepted **54** intents and B **64** before teardown. Provider attempts **0**, page errors **[]**. Clipboard fallback, fullscreen, independent controller shutdown and browser invitation entry all passed.

The final local demo was launched with the Node prefix above and:

```sh
PORT=5277 JEV_MOCK=1 npm run demo
curl --fail --silent --show-error http://127.0.0.1:5277/health
curl --fail --silent --show-error -o /dev/null -w '\nweb HTTP %{http_code}\n' 'http://127.0.0.1:5277/?spectate'
```

**RUNNING**: three independent, side-by-side Chromium app windows. Health reported `ok:true`, `mode:mock`, `physicsHz:120`, `snapshotHz:30`, `speed:4`, both teams connected, tick advancing, **paidCalls:0**. The web route returned **HTTP 200**. Click **Title sequence → Lights out** for a fresh recording. Ctrl+C in the launcher closes its own windows and server.

Full final command output is saved in `artifacts/verification.log` and `artifacts/worker-verification.log`. No temporary verification servers remain; the requested demo is left running.

## 2026-11-13: Jev authentication and observable fallbacks

A controlled diagnostic request returned **HTTP 401**. The read-only models endpoint confirmed the configured Grand Prix key was rejected; the original Pong key was different and authenticated successfully. The user identified the incorrect key and corrected it. No credential was printed or copied by the agent. These were explicitly requested diagnostics, separate from the mocked test suite.

Fixed the silent fallback handling: driver decisions now carry safe provider/model/status/error metadata; the UI reports the error and successful-response counts; the header distinguishes configured credentials, observed live Jev responses and fallback. HTTP 401/403 stops further provider requests until restart, rate limits honor Retry-After, and transient failures back off. Server and browser both enforce pacing. Cooldown responses do not inflate provider-attempt counts.

Added four mocked regressions covering HTTP 401 with a secret-bearing response body, no repeated authentication attempts, shared-team rate-limit cooldown and recovery, malformed responses/network errors, and mock transport isolation. `npm test` passed **19 tests**. The diagnostic-fix build, strict typechecks, 19 tests, the full three-context race and the MCP invitation scenario all passed before adding Luna.

## 2026-11-13: Jev versus Luna, ported from Pong

Added `server/luna.ts` using the same OpenAI Decisions REST contract as Pong: pinned `gpt-6-luna`, JSON telemetry plus engineer instruction, and named `choice` answers. Six questions match Jev’s racing intent: line, speed bias, braking, ERS, DRS and persona reply. The server validates answer names/types/choices/confidence and the model; refusal, duplicate, missing and malformed answers fall back visibly.

Luna keeps Pong’s post-response minimum 600 ms delay, actual-token / configured-and-provider token pacing, request-rate pacing, 20% headroom, and Retry-After support including a 1728-second daily quota. Rate/auth metadata is safe to show; raw provider bodies, keys and organization IDs are excluded. A cached result never increments confirmed-response or attempt counters. Authentication blocks until restart. Tests prove the quota survives reset, reconnect and switching to Jev and back.

The owner-only driver selector, `RACE_MATCHUP`, `npm run demo:luna`, public driver roster, header/driver/radio labels, Node rooms, MCP tool/host arguments and Worker checkpoint now support both matchups. An invitation preserves the originating race’s matchup. Public MCP/Worker games stay mock-only. Mock flags override local real keys in every automated test and the smoke launcher. Existing `.env.local` credentials were not changed.

Unit verification passed **33 tests** across four files: the 15 original race/brain tests, four Jev error tests, 13 Luna tests and a replay regression. The first full browser pass completed **both** three-lap modes (53.5 s Jev/Jev, 45.4 s Jev/Luna), with both pit stops, results, replay, reconnect, mode switching, zero paid calls and no page errors. Added a focused provider-status UI test to ensure credentials alone do not display confirmed live inference. Final command results and screenshots are recorded below.

The expanded run exposed a replay capture bug: a position change at the finish could replace an overtake and append frozen frames indefinitely. Capture now stops at the finish, only records genuine on-track leader changes, strips unrelated event/radio payloads and bounds the frame count. A room regression verifies finished races cannot grow history or replay.

Final verification for the Luna integration (all inference mocked or injected; no paid calls):

| Command | Result |
| --- | --- |
| `JEV_MOCK=1 npm run verify` | PASS: strict Node/Worker typechecks, three Vite builds, 33 unit tests, three browser tests and one MCP test |
| `npm run test:e2e` (inside verify) | PASS: provider status/error UI; Jev/Jev full race 45.6 s; Jev/Luna full race 44.8 s; zero paid calls and no page errors |
| `npm run test:mcp` (inside verify) | PASS: 30.2 s; two independent Jev/Luna MCP apps, invitation preservation, shared browser spectator, clipboard fallback, browser invite and independent teardown; zero paid calls |

Commands used Node 24.14.0 via `env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH`. The final full verification output is saved in `artifacts/luna-verification.log`. Luna-specific screenshots are `artifacts/cockpit-luna.png`, `artifacts/broadcast-luna.png`, `artifacts/results-luna.png` and `artifacts/title-luna.png`. Broadcast and results were visually inspected.

The browser build was scanned for Jev/OpenAI SDK client markers, all four provider key names, and provider inference endpoints: **no matches**. Existing user credentials were left untouched. Real Luna requires the user's own `OPENAI_API_KEY`; account access, quota and live model behavior were not tested. The original running-demo notes above describe the initial milestone session, not a claim that a server is still running now.

Additional final checks:

| Command | Result |
| --- | --- |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-luna-worker.log npm run test:worker` | PASS: local workerd / Durable Object physics, seat intents, radio, owner authorization and Jev/Luna MCP invitation preservation; 3.5 s, paid calls 0 |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-luna-dry-run.log npm run worker:check` | PASS: 1271.28 KiB bundle; dry-run exited without upload or deployment |
| `PORT=5477 JEV_MOCK=1 npm run demo:smoke -- --matchup=jev-vs-luna` | PASS: three independent Chromium windows, correct matchup, both driver seats connected, intents accepted, racing phase and HTTP health; launcher cleaned up |
| `git diff --check` and local credential/bundle scans | PASS: no whitespace errors or local key values in tracked/nonignored files; no provider credentials or inference endpoints in browser bundles |

Worker and smoke logs are saved in `artifacts/luna-worker-verification.log`, `artifacts/luna-worker-check.log` and `artifacts/luna-demo-smoke.log`. No live Luna request was made. Launch real Jev/Luna with `JEV_MOCK=0 LUNA_MOCK=0 npm run demo:luna` after adding `OPENAI_API_KEY` alongside the existing Jev key in `.env.local`. These commands leave engineer mock/live selection independent.

## 2026-11-16: car, environment and handling realism

Replaced the original block-built cars with original detailed 2025-style meshes: 3.6 m wheelbase, 2 m envelope, shaped monocoque and sidepods, open cockpit, halo, suspension, multi-element front/rear wings, diffuser, wheel covers, rotating slicks, compound lettering, driver/visor and liveries. Paint/carbon/rubber/metal respond to local HDR environment lighting. Steering, wheel rotation, body pitch/roll and DRS flap animate from telemetry. Added a clean car-detail view with front, rear, side and top inspection URLs.

Replaced flat road/terrain and cone trees with CC0 asphalt/normal/grass/HDR assets, rubber buildup, gravel, volumetric leaf clusters, real shadows, mesh fences and continuous Armco. Corrected the original ~22 m track ribbon to an illustrative 12 m, widening to 15 m at the grid. Garages now sit beside the pit lane. Trackside cameras have anchored telephoto positions; the aerial camera uses tighter framing. Asset attribution and SHA-256 hashes are stored under `src/race/assets/`.

Physics now uses SI force/power calculations, tyre load sensitivity, quadratic aero, DRS/tow drag reduction, wake downforce loss, traction-limited launch, a combined tyre force limit, fuel mass, 120 kW ERS and per-lap energy budgets. Steering uses a finite-rate, tyre-limited bicycle model with a pure-pursuit controller, not direct offset sliding. A multi-scale curvature optimisation creates the racing line. Local smoothing removes source digitisation spikes; a sampled-length regression keeps the path within 1% of the original 5,793.163 m layout. Excess entry speed can understeer off the line and onto runoff. The accelerated tyre cliff remains intentional for a three-lap strategy demo; the undercut regression still passes.

The initial physical pass exposed >6 g spikes and cars overshooting chicanes. Fixes included geometry fairing, curvature rather than shortest-path optimisation, a predictive braking envelope, and braking/steering allocation under the tyre-force limit. The clean calibration now produces a **78.533 s flying lap**, **3.867 m maximum absolute lateral offset**, **5.5 g maximum lateral acceleration** and **3.931 g peak deceleration**. It fixes tyres at fresh/95°C and fuel at 10 kg to isolate handling, so it is not a normal strategy-race result. It is a calibration envelope, not proof of matching team telemetry: Lesmo 2 and Ascari minima still differ from the referenced real car measurements. Actual full races retain fuel, wear, temperature, pits, agent choices and network timing.

References: [FIA 2025 dimensions](https://www.fia.com/system/files/documents/fia_2025_formula_1_technical_regulations_-_issue_02_-_2025-02-26.pdf), [McLaren MCL39 specification](https://www.mclaren.com/racing/formula-1/2025/mcl39-technical-specification/), [Brembo 2025 Monza braking data](https://brem-p-001.sitecorecontenthub.cloud/api/public/content/a7758d9026e14e81b940a82dd992941c?v=cc87e1fe), [Poly Haven CC0 licence](https://polyhaven.com/license).

All verification uses `JEV_MOCK=1` or injected WebSocket fixtures. No provider inference calls were made. The test renderer initially stalled in macOS headless/software mode, preventing driver updates; macOS verification now uses headed Chromium and the same Metal GPU path as the demo. `PW_HEADLESS=1` remains available explicitly. This was not resolved by weakening the race assertions. A separate test-setup issue (Playwright importing track JSON without a Node import attribute) was removed from the visual-only fixture.

The earlier full GPU test of the upgraded scene measured **60.1 / 60.1 / 60.1 FPS**, three simultaneous 1100×850 views. The final run and commands are recorded below. Standard `demo` retains the 4× recording clock; `npm run demo:realistic` uses 1× for physically plausible apparent motion. No claim of a six-degree-of-freedom suspension/tyre simulator, surveyed scenery or a licensed team replica is made.


Final results, using Node **24.14.0** (`env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH` before each npm command):

| Command | Result |
| --- | --- |
| `JEV_MOCK=1 npm run verify` | PASS: `npm run build` (strict Node/Worker typechecks and three Vite builds), **39 unit tests**, **4 Playwright tests**, **1 MCP test** |
| `npm run test:e2e` (inside verify) | PASS: provider UI; Jev/Jev full race **23.7 s**; Jev/Luna full race **22.2 s**; front/rear/side/aerial/cockpit render checks **6.3 s**; no browser errors or missing assets |
| `npm run test:mcp` (inside verify) | PASS: **12.5 s**, two independent apps plus browser spectator; invitation, clipboard fallback, browser joining and independent teardown; accepted intents **35 / 42**, paid calls **0** |
| `JEV_MOCK=1 npm run test:handling` | PASS: complete three-lap strategic race, one pit stop per car, max speed **345.70 km/h**; separate clean flying lap **78.533 s** |
| `JEV_MOCK=1 npm run test:performance` | PASS: final production build, three simultaneous **1100×850** hardware-rendered views, average **60.2 / 60.2 / 60.2 FPS**, paid calls **0** |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-realism-worker.log npm run test:worker` | PASS: local workerd assets, Durable Object physics, both intents, radio, seat authorization and MCP invitation; **3.9 s**, paid calls **0** |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-realism-dry-run.log npm run worker:check` | PASS: **1281.84 KiB**, dry run only; no upload or deployment |

Full outputs are saved as `artifacts/realism-verification.log`, `realism-handling.log`, `realism-performance.log`, `realism-worker-verification.log` and `realism-worker-check.log`; machine-readable samples are `artifacts/handling.json` and `artifacts/performance.json`. The close-up inspection caught and corrected reversed body normals and overlapping tyre lettering. The final front/rear/side/aerial/cockpit PNGs are saved under `artifacts/realism-*.png`, alongside refreshed actual-race cockpit/broadcast/results screenshots for both driver matchups. The close-up render test uses a deterministic mock WebSocket pose; the full-race tests use the real server and real physics with mock inference.

`PORT=5477 JEV_MOCK=1 npm run demo:realistic -- --smoke --headed --matchup=jev-vs-luna` also **passed**: three independent browser windows, a **1×** clock, both seats connected, accepted mock decisions, racing phase and successful running-server HTTP health check. Output is `artifacts/realism-demo-smoke.log`. The launcher closed its own server/windows afterward. Temporary preview servers were also stopped; no unrelated running demo was restarted or reconfigured.

`git diff --check` passed. A scan of browser JavaScript and HTML found no provider key names, SDK client markers or inference endpoints. User credentials and the original Pong folder were not changed. No live inference was used for this work, and nothing was pushed, published or deployed.


## 2026-11-16: Las Vegas night circuit

Added a room-specific circuit selector, preserving Monza and supporting concurrent rooms on different circuits. The circuit travels with server-authoritative race state, replay frames, resets, driver changes, MCP invitations and Worker checkpoints. Only the owner can switch circuits. Jev, Luna and engineer prompts now describe the selected circuit. The minimap, sectors, DRS, pit route, location labels and night tyre-temperature target use that circuit's data.

The unscaled Las Vegas GeoJSON projects to **6,227.823 m**, within **0.433%** of the published 6,201 m. All 17 turns are annotated; DRS and sector offsets reference the FIA 2025 map. Real BBC and Road & Track/Getty race-night photographs were downloaded temporarily and visually inspected. Original procedural models implement the Sphere, floodlights, street barriers, hotel façades, Bellagio fountains, Paris tower and High Roller. [Reference sources and limitations](data/LAS-VEGAS-REFERENCES.md) document what is measured versus approximate. No reference photo or proprietary car/track mesh was redistributed.

The Sphere uses a 157.277 m diameter and 111.557 m height above ground, with an original animated LED shader/artwork. Night rendering includes bloom, four nearby physical floodlights, a lit track corridor and deterministic titanium skid streaks at high speed. Sparks stop at low speed and in the pits; they are cosmetic, not a suspension simulation. Geometry batching and local textures keep the MCP resource self-contained. Camera buttons add Sphere and Strip establishing views.

Visual iteration corrected Sphere text orientation/framing, added roof caps and façade pilasters, improved window scale and the ground surroundings, and reduced the catch-fence cell size. The initial visual test found a favicon 404; a bundled inline icon fixed it. Typecheck also caught a duplicate local variable during the city refinement; that was corrected before the final suite. Final renders have no missing assets, browser errors or shader errors. Rendering resource disposal covers bloom, shadow maps, sprites and shader textures when switching circuits.

Final commands below used Node **24.14.0**, prefixed with `env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH`. Every automated test used mock inference or injected WebSocket fixtures, with **zero paid provider calls**.

| Command | Result |
| --- | --- |
| `JEV_MOCK=1 npm run verify` | PASS: strict Node/Worker typechecks, all three production builds, **44 Vitest tests**, **6 Playwright tests**, **2 MCP tests** |
| `npm run test:e2e` (inside verify) | PASS: provider UI; Monza Jev/Jev **22.4 s**, Monza Jev/Luna **22.5 s**, Las Vegas Jev/Luna **25.6 s**; car/Monza render checks **6.3 s**, Vegas Sphere/Strip/aerial/cockpit/sparks checks **9.9 s** |
| `npm run test:mcp` (inside verify) | PASS: two sandboxed contexts plus browser spectator on each circuit, **11.8 s Monza / 12.0 s Vegas**; invitation retains circuit/matchup, clipboard fallback, browser join and independent teardown |
| `JEV_MOCK=1 RACE_CIRCUIT=las-vegas npm run test:handling` | PASS: deterministic three-lap strategic race, both cars pit once, top speed **337.07 km/h**; separate fresh-tyre calibration **89.850 s flying lap**, max offset **3.858 m**, lateral acceleration **5.221 g** |
| `JEV_MOCK=1 RACE_CIRCUIT=las-vegas npm run test:performance` | PASS: three simultaneous **1100×850** headed GPU views, **60.0 / 60.0 / 60.0 FPS**, night lighting/bloom/sparks enabled |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/vegas-worker.log npm run test:worker` | PASS: local Durable Object driving and circuit-preserving MCP invitations on **both circuits**, **3.9 s / 3.8 s**, zero paid calls |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/vegas-dry-run.log npm run worker:check` | PASS: **1290.24 KiB** Worker bundle; dry run only, no upload/deployment |

Full races verify independent WebSockets, moving cars, engineer-to-driver behaviour changes, both pit stops, three laps, results, replay, reconnect, driver changes and mobile width. New unit tests cover Vegas geometry, zone-specific DRS, room isolation, owner-only circuit changes, deterministic full races and speed/pit-dependent sparks. The clean calibration fixes fuel/tyres to isolate handling and is not a claim to reproduce measured F1 telemetry.

Evidence: `artifacts/vegas-verification.log`, `vegas-handling.log`, `vegas-performance.log`, `vegas-worker-verification.log`, `vegas-worker-check.log`; telemetry in `handling-vegas.json` and `performance-vegas.json`. Render fixtures: `vegas-sphere.png`, `vegas-strip.png`, `vegas-aerial.png`, `vegas-cockpit.png`, `vegas-sparks.png`. Actual race screenshots: `cockpit-vegas.png`, `broadcast-vegas.png`, `results-vegas.png`, `title-vegas.png`; sandbox view: `mcp-team-a-vegas.png`. Fixture pictures use a fixed camera/car pose, while race/MCP screenshots use the actual mock-driven server.

`PORT=5477 JEV_MOCK=1 npm run demo:vegas -- --smoke --headed --matchup=jev-vs-luna` **passed**: Las Vegas, 1× race clock, three independent browser windows, both seats connected, accepted mock decisions, racing phase and healthy running HTTP server. The launcher then cleaned up its own windows/server. Output is saved in `artifacts/vegas-demo-smoke.log`.

The final browser bundle scan found no provider key names, SDK client markers or inference endpoints. No credentials were changed or printed. The original Pong folder and unrelated running servers were left alone. Nothing was pushed, uploaded or deployed.

A final lifecycle regression, `JEV_MOCK=1 npx playwright test e2e/vegas.spec.ts --grep 'owner switches'`, **passed in 3.7 s** (5.7 s including servers). It switches Monza → Vegas → Monza → Vegas → Monza across two independent connected browser contexts, preserves the room, limits each view to one canvas, restricts selection to the owner and exits the Sphere camera on returning to daylight. The first setup tried the camera with no driver seats connected and was blocked by the expected waiting overlay; that attempt was interrupted, then the test was corrected to connect both mock drivers. Clean output is in `artifacts/vegas-switching.log`. The test is now part of `npm run test:e2e` (seven browser scenarios total).

## 2026-11-16: Blender car realism v2

Preserved `5ce603c`'s Monza + Las Vegas circuit geometry, scenery, night lighting, Sphere, sparks, physics, Jev/Luna providers, engineers, radio, rooms, invitation flow and Worker configuration. No simulation coefficients or provider settings changed. The new work replaces the car renderer with original Blender GLBs, adds a real modelled steering wheel/live display, lowers the driver's-eye camera, adds T-cam, and provides a studio with Colour/Clay/occluded Wireframe modes.

**Reference approval:** the MP4 was downloaded and inspected at 1 fps plus 4 fps in the requested ranges. Ruben approved the timestamped proof and corrected the livery specification to match the clip. All marks on the new models are fictional. Reference media stays local and is excluded from production builds. The original pre-change front/cockpit/broadcast/rear captures are preserved in `artifacts/realism-v2/before/`.

**Blender:** version **5.2.2 LTS**, build `d13f752e3b9c`. The first sandboxed process exited 139 before Python execution. Its crash trace points to `supports_barycentric_whitelist` → `MTLBackend::metal_is_supported` → GPU backend selection. The same installed binary completed successfully with normal local application/GPU access. Final regeneration used `-b --factory-startup --python scripts/blender/build_car.py` with user add-ons disabled. No reinstall, engine substitution or procedural Three.js car fallback was used. Both high/low GLBs and the editable `.blend` are committed. Final high LOD: **103,808 triangles**, approximately **3.0 MB**; low LOD: approximately **929 KB**, selected from 32 m. The manifest records dimensions and authorship.

**Visual iteration:** inspected actual headed GPU screenshots against frames 00:01, 00:04.25 and 00:05.25. Fixed over-bright carbon, inflated cockpit shoulders, clipped fictional lettering, mirrored steering-button layout, a visible reflection boundary, a jagged paint boundary, reversed cover-face visibility in Clay and an obstructed steering close-up. Wireframe now draws lines over an opaque depth surface so internal/back edges do not obscure the silhouette. Final screenshots have no page errors, failed HTTP assets or shader errors. The 3D dashboard updates at 10 Hz; wheel rotation, steering, body pitch/roll and DRS follow telemetry every rendered frame.

Commands used Node **24.14.0**, with `env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH` before each npm/npx command. All provider execution used **`JEV_MOCK=1`** or injected mock WebSocket fixtures; paid calls **0**.

| Command | Observed result |
| --- | --- |
| `/Applications/Blender.app/Contents/MacOS/Blender --version` | 5.2.2 LTS |
| `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_car.py` | PASS; editable source + two GLBs exported |
| `JEV_MOCK=1 npm run verify` | PASS; strict Node/Worker typechecks, three production builds, **46 Vitest tests**, **8 Playwright scenarios**, **2 MCP invitation tests** |
| `JEV_MOCK=1 npm run build` and `npm run typecheck` | PASS after the final visual refinements |
| `JEV_MOCK=1 npm test` | PASS: **46 tests / 7 files** after final refinements; GLB rigs/resources/branding/LOD and wheelbase checks added |
| `JEV_MOCK=1 npx playwright test e2e/realism-v2.spec.ts` | PASS: **17.2 s** final capture; front/rear/side/wheel/steering/chase/onboard/T-cam and all studio modes; live-to-studio return; pause control; no browser/asset errors |
| `JEV_MOCK=1 npm run test:mcp` | PASS final renderer: **2 tests**, **11.7 s Monza / 12.3 s Vegas**; separate app contexts + spectator, clipboard fallback, browser invite joining, independent teardown |
| `JEV_MOCK=1 npm run test:handling` | PASS Monza deterministic three-lap race; both cars pit once; calibration output retained |
| `JEV_MOCK=1 RACE_CIRCUIT=las-vegas npm run test:handling` | PASS Vegas deterministic three-lap race; both cars pit once; calibration output retained |
| `JEV_MOCK=1 npm run test:performance` | PASS: three 1100×850 headed GPU views; **115.5 / 115.6 / 115.6 FPS** Vector/Chaos/Broadcast |
| `JEV_MOCK=1 RACE_CIRCUIT=las-vegas npm run test:performance` | PASS final isolated measurement: **115.7 / 115.6 / 115.7 FPS**, three 1100×850 views, Apple M4 Pro Metal renderer; night lighting/bloom/sparks enabled |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-v2-final-worker.log npm run test:worker` | PASS: **2 tests**, Monza **4.1 s**, Vegas **4.0 s**; local workerd/DO, MCP resource and shared races |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-v2-dry-run.log npm run worker:check` | PASS; dry run only, no deployment/upload |
| `PORT=5487 JEV_MOCK=1 ENGINEER_MOCK=1 npm run demo:vegas -- --smoke --headed --matchup=jev-vs-luna` | PASS; three independent Chromium windows, both mock drivers, racing phase, HTTP health OK; launcher cleaned up its own windows/server |
| `curl --fail --silent http://127.0.0.1:5477/health` | PASS; local mock server reachable; JSON retained |
| `python3 scripts/realism-sheets.py` | PASS; three 1200 px wide JPEG quality-60 sheets, each base64 payload below 45,000 characters; three reference comparisons |
| `git diff --check` | PASS |

The full races verify movement, radio-driven behaviour changes, pit stops, lap counts, finish/results, replay and reconnect on both circuits. The final close-up captures use a deterministic mock WebSocket pose to allow comparison; full-race/MCP screenshots use the actual server. A performance measurement overlapping the demo smoke check was conservatively ~103 FPS; it was repeated with exactly three windows, yielding the final ~116 FPS figures above. FPS describes this Mac/display/viewport, not all hardware or a 4K recording guarantee. Scene pixel ratio remains capped at 1.5.

All new evidence is under `artifacts/realism-v2/`: PNG captures, comparison PNGs, JPEG sheets, exact base64 text, logs, machine-readable render/handling/performance data and a self-contained remote review with copy/select fallback. The MCP resource is approximately **12.3 MB uncompressed**, including both GLBs and existing track textures/HDR; local sandbox and Worker tests pass. Loading on a slow link will take longer. Existing screenshots outside this evidence directory are restored to the baseline after testing so the pre-change record remains intact.

**Honest remaining gaps:** the video has more carefully sculpted continuous body surfaces, denser fictional-equivalent sponsor placement, more convincing tyre shoulder detail and richer studio reflections. Our sidepods, inlet lips, suspension attachments, helmet and wing sections remain simplified. Some render typography is lighter than the reference. The scene uses a blurred planar reflection and contact shading rather than ray-traced AO/global illumination. Driver's-eye and T-cam are usable live camera views but do not include hands, visor optics or a full physical camera/suspension model. There is no exploded engine/gearbox view. These are improved real-time models, not a photogrammetric replica or a claim of matching every surface in the clip. The calibrated driving model and accelerated strategy wear remain as before.

Local changes only. No provider keys were read or changed; no live inference, pushes, publishing or deployment occurred.
