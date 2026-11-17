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

## Cars rounds 2–3 and Blender circuits phase 2 — 2026-11-16/17

Part A local commit: **f390a4a**. Part B is the local commit containing this section. No push, publication or deployment. No paid provider calls. Blender **5.2.2 LTS** (`d13f752e3b9c`), `-b --factory-startup`; car AO used actual Cycles CPU bakes. Normal local graphics access avoided the previously diagnosed sandbox Metal initialization crash; no procedural fallback was used.

Car evidence: `artifacts/realism-v3/{before,round-2,round-3}` and `REVIEW.md`. Circuit evidence: `artifacts/circuits-v2/{before,round-1,round-2,round-3}` and `REVIEW.md`. Every circuit round has straight chase, signature onboard, aerial and pit/grandstand shots. Final side-by-side reference sheets and before/after sheets are in each `round-3/<circuit>/` directory. Sphere/Strip close-ups are saved there too. Photo/DEM attribution and accuracy limits are in `data/CIRCUITS-V2-SOURCES.md`.

The exact Node prefix for the commands below was:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
```

| Command after that prefix | Result |
| --- | --- |
| `npm run build` | PASS: main + Worker typechecks, web, self-contained MCP app, host/sandbox bundles |
| `npm run typecheck` | PASS again after strengthening Worker model-readiness assertions |
| `JEV_MOCK=1 npm test` | PASS: **50 tests / 8 files**; includes car LOD/dimensions, exact exported track path, continuous DEM seam/slope, embedded circuit resources and size limits, physics/brains/providers/rooms |
| `JEV_MOCK=1 npm run test:e2e` | PASS: **9 tests**, 2.8 min. Complete Monza Jev/Jev and Jev/Luna races plus Vegas Jev/Luna; real WebSockets, radio changing intent, tyre stops, timed laps, results/replay, provider states, all car/studio views and circuit switching |
| `JEV_MOCK=1 REVIEW_ROUND=round-3 npx playwright test e2e/circuit-review.spec.ts e2e/vegas.spec.ts e2e/mcp.spec.ts` | PASS on final assets: **5 targeted tests**, 1.3 min. Repeats relevant visual tests after final foliage/Sphere fixes; both strict-CSP MCP apps wait for actual car/circuit readiness, share one invited room with a browser spectator, exercise clipboard fallback and teardown; console errors **[]**, paid calls **0** |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-grand-prix-worker-test.log npm run test:worker` | PASS: **2 local workerd tests**, 13.4 s; both circuits load their models, move, issue intents/radio and serve the MCP resource/invitations |
| `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jev-grand-prix-wrangler.log npm run worker:check` | PASS: **--dry-run**, 1290.24 KiB Worker / 234.46 KiB gzip; assets/bindings resolved; no upload |
| `JEV_MOCK=1 npm run test:handling` | PASS: existing fixed-step race/handling calibration completes, tyre stops and lap timings retained |
| `JEV_MOCK=1 npm run test:performance` | PASS: Monza, **113.74 / 113.62 / 113.60 FPS** for Vector / Chaos / Broadcast |
| `JEV_MOCK=1 RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance` | PASS: Vegas, **114.97 / 115.12 / 114.85 FPS** |
| `PORT=5579 JEV_MOCK=1 npm run demo:smoke` | PASS: three independent windows, both teams connected, mock decisions, racing phase, HTTP health; cleaned up its own server/windows |

Performance was measured in headed Chromium on **Apple M4 Pro / ANGLE Metal**, three independent 1100×850 contexts, 50 samples at 500 ms intervals after model loading and warmup. The test now requires a 60 FPS average. Lowest sampled **smoothed** readings were 102.76 FPS (Monza) and 106.20 FPS (Vegas); these are HUD EMA samples, not a guarantee that every individual frame or every MacBook meets that rate. Full data: `artifacts/circuits-v2/performance-{monza,las-vegas}.json` and `performance-summary.json`.

Additional exact non-Node commands:

```sh
python3 scripts/blender/circuit_textures.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_circuits.py -- 1
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_circuits.py -- 2
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_circuits.py -- 3
python3 scripts/circuit-review-comparisons.py round-1
python3 scripts/circuit-review-comparisons.py round-2
python3 scripts/circuit-review-comparisons.py round-3
curl --fail --silent http://127.0.0.1:5477/health
curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/
```

Both running-server checks returned **HTTP 200**; health records `mode: mock`, `paidCalls: 0`, 120 Hz physics and 30 Hz snapshots. That existing local development server remains available on port **5477**. Final command output is saved under `artifacts/circuits-v2/logs/`.

Failures found and fixed are retained in the review notes: overlapping ground AO bake and wrong blending; oversized car mesh; low camera obstructed by the old cockpit tub; terrain/road intersections; a missing Sphere shader brace and later inverted UV artwork; a city block intersecting the Sphere; worker-backed decoding incompatible with strict MCP CSP; a missing test-host favicon; generic `networkidle` waits unsuitable for decoder work. The MCP test explicitly permits only the existing 403 response from probing owner-only `/links` with a team token, then asserts no other console errors through browser invitation joining.

The final circuits have **287,076 Monza / 131,980 Vegas triangles**, spatial chunks and distance-culled detail. Cars retain high/far LODs. MCP uses the same Blender geometry with gzip transport and a direct byte/image loader; host CSP was not relaxed. Current gameplay/provider behaviour remains unchanged. Mock tests do **not** establish live-provider latency, actual ChatGPT/Claude host resource limits, survey-grade elevation, full physical response to slopes, or photorealistic parity. Read the round-by-round critiques before judging fidelity.

## Realism round 4 — 17 November 2026

Continues f390a4a / 13a5147. Evidence and the detailed visual critique are under `artifacts/realism-v4/`; before shots were copied before edits. Blender **5.2.2 LTS** remains the modelling pipeline, with `-b --factory-startup`, normal local graphics access and CPU Cycles AO. Fixed slow scene deletion using `bpy.data.batch_remove`, and supplied the common parent required by Blender's native GPU-instancing exporter. No procedural Three.js model fallback, push, publication, deployment or paid API calls.

Commands use this exact prefix for Node:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
```

| Command after the Node prefix | Result |
| --- | --- |
| `JEV_MOCK=1 npm run build` | PASS: Node/Worker typechecks, web/MCP/host builds, static asset budget; largest file 22,629,942 / 26,214,400 bytes |
| `npm run typecheck` | PASS independently |
| `JEV_MOCK=1 npm test` | PASS: 52 tests / 8 files, including decoder-free quantized MCP assets, native instances, crown LOD presence, geometry/physics/brains/providers/room tests |
| `JEV_MOCK=1 CAR_REVIEW_DIR=realism-v4/after/cars CIRCUIT_REVIEW_DIR=realism-v4/after npm run test:e2e` | PASS: 9 tests, 3.1 min, on final LOD/camera/material assets; full races, radio, pits, results, camera/studio modes and circuit switching |
| `JEV_MOCK=1 CAR_REVIEW_DIR=realism-v4/after/cars CIRCUIT_REVIEW_DIR=realism-v4/after npx playwright test e2e/realism-v2.spec.ts e2e/circuit-review.spec.ts e2e/mcp.spec.ts` | PASS: 4 tests before the final crown-LOD/T-cam/roughness refinements; both invitations/browser joins/clipboard fallbacks and strict-CSP model loading pass, errors [], paidCalls 0 |
| `JEV_MOCK=1 npm run test:mcp` | PASS: 2 tests, 33.6 s, final assets; both circuits, shared invitations, browser joins and clipboard fallback; paidCalls 0, errors [] |
| `JEV_MOCK=1 WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-v4-worker.log npm run test:worker` | PASS: 2 local workerd tests, 11.9 s; models, physics, intents, radio, disconnect, owner authorization and MCP invitations; paid calls 0 |
| `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-v4-wrangler.log npm run worker:check` | PASS: dry-run only, 52 assets, Worker 1290.24 KiB / gzip 234.46 KiB; no upload |
| `JEV_MOCK=1 npm run test:handling` | PASS: deterministic handling/calibration unchanged |
| `JEV_MOCK=1 PORT=5577 npm run test:performance` | PASS: final Monza LODs, means **86.24 / 83.70 / 87.69 FPS**, minimum smoothed samples **71.65 / 66.72 / 73.82** |
| `JEV_MOCK=1 RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance` | PASS: means **111.55 / 111.64 / 111.63 FPS**, minimum smoothed samples **101.14 / 101.01 / 100.13** |
| `PORT=5579 JEV_MOCK=1 npm run demo:smoke` | PASS: three independent windows, both players, mock decisions, racing phase and HTTP health; own windows/server cleaned up |

Performance: Apple M4 Pro / ANGLE Metal, three independent headed Chromium contexts at 1100×850, 50 samples at 500 ms after loading/warmup. No concurrent Blender or browser tests during the accepted measurements. All saved final smoothed samples exceed 60 FPS; the benchmark now checks the minimum as well as the mean. These are HUD EMA readings, not a guarantee about every individual frame, Retina resolution or every MacBook. Full samples and a summary are in `artifacts/realism-v4/performance-*.json`.

Additional commands:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --version
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_car.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_circuits.py -- 4
python3 scripts/review-v4.py iteration-2
python3 scripts/review-v4.py iteration-3
python3 scripts/review-v4.py after
curl --fail --silent http://127.0.0.1:5477/health
curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/
```

The existing server returned HTTP 200 and `mode: mock`, `paidCalls: 0`. It remains running on port 5477. Blender exports completed successfully; car high detail is **230,970 triangles**, with a reduced far LOD. The close-detail budget was intentionally raised to retain curved skins, glove surfaces and tessellated wordmarks, then checked against actual three-view performance. Monza contains about 5.50 million triangles if every high-detail instance were drawn simultaneously; spatial culling and Blender-made distant crown LODs avoid that cost in normal views. Native export reduced Monza's scene graph from 53,920 nodes to roughly 700. Vegas has about 501k total triangles. Actual rendering counts are retained in performance samples.

Failures were corrected rather than accepted: reserved GLSL identifier hid tyres; open tube ends broke glove remeshing; low-detail untextured crowns looked like balls; letter faces cut into convex bodywork; mirror UVs sampled only a tiny image region; the T-cam looked into its own pod; dark albedo in the roughness slot over-amplified Vegas glare; HDR nearest filtering pixelated the sky; scene-root instances did not trigger Blender native instancing; oversized embedded bundles exceeded the Worker limit. An overlapping benchmark/test run was rejected, and the first isolated Monza run still dipped to 48 FPS; distant crown LODs brought the minimum saved sample above 66 FPS.

The final review remains candid: compound body joins, glove anatomy, tyre carcass behaviour, foliage silhouettes, architectural specificity and GI/reflections still trail the reference. Tyre deformation is visual only; coarse DEM, game physics, provider configuration and room/radio/invitation behaviour are preserved. Reference video frames and location photographs are comparison evidence, not production textures or a claim of measured visual parity.

## Realism round 5 — 17 November 2026

Baseline **47aedf6**. Before/after images, reference comparisons, steering-lock poses and rejected iterations are saved in `artifacts/realism-v5/`. Modelling stayed in **Blender 5.2.2 LTS**, using factory startup and CPU Cycles AO. No push, deployment, publishing or paid API calls.

Exact Node prefix used:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
```

All test commands used `JEV_MOCK=1 ENGINEER_MOCK=1`. Worker commands also used `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-v5-wrangler.log`.

| Command after the prefix/environment above | Result |
| --- | --- |
| `npm run build` | PASS: main/Worker typechecks, web/MCP/host builds and 25 MiB asset check |
| `npm run typecheck` | PASS independently |
| `npm test` | PASS: **53 tests / 8 files**; new connected-body-shell check, articulated rig/material presence, existing geometry/physics/brains/providers/rooms |
| `CAR_REVIEW_DIR=realism-v5/after/cars CIRCUIT_REVIEW_DIR=realism-v5/after npm run test:e2e` | PASS: **9 tests, 3.5 min**, on the final 244,212-triangle Blender car and circuit assets; full races, radio→intent, pits/laps/results, all car/studio modes, two added steering-lock poses, day/night switching and visual captures |
| `npm run test:mcp` | PASS: **2 tests, 35.4 s**; both circuits, independent app contexts, invite joining, browser spectator/joining, clipboard fallback and teardown; paidCalls 0, errors [] |
| `npm run test:worker` | PASS: **2 local workerd tests, 12.0 s**; assets, Durable Object simulation, intents, radio, owner authorization and MCP invitations; paid calls 0 |
| `npm run worker:check` | PASS: **dry-run only**, Worker 1290.24 KiB / gzip 234.46 KiB; no upload |
| `npm run test:handling` | PASS: deterministic handling/calibration; physics was not changed |

Additional commands:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --version
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_car.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_circuits.py -- 5
python3 scripts/review-v5.py iteration-2
python3 scripts/review-v5.py iteration-3
python3 scripts/review-v5.py after
curl --fail --silent http://127.0.0.1:5477/health
curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/
```

The existing server returned HTTP 200 and mock health with zero paid calls; its health response is saved in the round folder. Blender exports succeeded. The final car is **244,212 triangles**, within the unchanged 245k cap; the unified outer skin passes a one-connected-component check across its material primitives. Monza totals **2,375,190** high-detail instanced triangles, Vegas **519,624**, before runtime LOD/culling. Source .blend files, normal/LOD GLBs and MCP-compatible packed assets are retained.

Visual review rejected and corrected dropped paint materials and sealed intake mouths after voxel fusion, jagged triangle-based livery boundaries, over-budget topology, red inner cockpit panels and over-bright Vegas highlights. The shared preview failed twice with `Preview automation snapshot timed out after 15000ms`; its owned tab was closed and the requested headed Playwright workflow supplied the captures.

After the full suite passed, two performance-only experiments (alternate-frame shadows and static world-matrix caching) showed no useful benefit and were reverted exactly. Build/typecheck/unit tests and isolated benchmarks were repeated on the restored, already browser-verified renderer. No reduced shadow cadence or frozen matrix behaviour remains. See `artifacts/realism-v5/REVIEW.md` for honest visual limitations and the experiment measurements.

Final isolated performance and launcher commands (same Node/mock prefix):

| Command | Result |
| --- | --- |
| `PORT=5577 npm run test:performance` | PASS: Monza Vector/Chaos/Broadcast means **90.96 / 90.04 / 91.17 FPS**; minimum smoothed samples **70.35 / 69.60 / 74.14** |
| `RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance` | PASS: Vegas means **103.80 / 103.68 / 104.19 FPS**; minimum smoothed samples **90.24 / 90.43 / 86.99** |
| `PORT=5579 npm run demo:smoke` | PASS: three independent windows, both players connected, mock decisions visible, racing phase, HTTP health; own windows/server cleaned up |

These are the last measurements on the retained code, not the best of the experiments. **The ~110 FPS Monza stretch target was not reached.** Each run used Apple M4 Pro / ANGLE Metal, three independent headed Chromium contexts at 1100×850, 50 samples at 500 ms after loading/warmup, with no overlapping Blender or other browser tests. The benchmark asserts both mean and minimum sampled smoothed FPS >=60. HUD EMA samples do not guarantee every individual frame or every MacBook reaches that rate. Raw samples, rejected experiments and `performance-summary.json` are saved in the round folder.

The restored build's largest static file is **23,242,425 / 26,214,400 bytes**. Final build/typecheck/unit checks passed again; the full race/MCP/Worker suite had already passed on this exact retained renderer before the two reverted experiments. The server remains available on port 5477 in mock mode. All per-command logs are under `artifacts/realism-v5/logs/`.

## Realism v6 — 17 November 2026

Baseline **884c3f2** preserved. All changes are local. Models built with **Blender 5.2.2 LTS** (`d13f752e3b9c`), factory startup, CPU Cycles AO. No Blender crash or runtime repair was needed. Visual review caught and fixed a wrongly oriented Boolean cutter, mismatched inlet contours and a folded decal projection. No Three.js model fallback, push, publishing or deployment.

Commands used Node 24.14.0 via `PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH`, with **`JEV_MOCK=1 ENGINEER_MOCK=1`** throughout. `WRANGLER_SEND_METRICS=false` and `WRANGLER_LOG_PATH=/tmp/jgp-v6-wrangler.log` were used for Worker commands. Exact sequential verification commands are retained in `artifacts/realism-v6/verify.sh`; individual logs are in its `logs/` directory.

| Command | Final result |
| --- | --- |
| `/Applications/Blender.app/Contents/MacOS/Blender --version` | 5.2.2 LTS |
| `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_car.py` | PASS; final high LOD **242,859 triangles**, cap unchanged at 245k; editable .blend, GLBs and AO retained |
| `npm run circuit:build` | PASS; Blender round 6 Monza and Vegas, native instancing/LOD and MCP assets |
| `python3 scripts/measure-car.py` | Actual GLB bounds: **5.6274 m length, 2.0000 m width, 3.6000 m wheelbase**, highest point 1.171 m |
| `npm run build` | PASS, including both TypeScript configurations and web/MCP/host bundles; largest asset **23,595,217 / 26,214,400 bytes** |
| `npm run typecheck` | PASS; repeated after adding the aperture regression test |
| `npm test` | **55 passed / 8 files**; exported mouths, connected skin, rigs, budgets, track, physics, timing and brains |
| `CAR_REVIEW_DIR=realism-v6/after/cars CIRCUIT_REVIEW_DIR=realism-v6/after npm run test:e2e` | **9 passed**, headed GPU Chromium; three independent WebSocket contexts, Jev/Jev and Jev/Luna mock races, radio changes, pit stops, laps, results, both circuits and all camera/finish captures |
| `npm run test:mcp` | **2 passed**; separate MCP app contexts, invitations, blocked-clipboard fallback, browser joining/spectating, both circuits, strict CSP |
| `npm run test:worker` | **2 passed** against local workerd; Durable Object physics/agents/radio, disconnect and ownership checks, MCP invitation resource |
| `npm run worker:check` | PASS; `wrangler deploy --dry-run` only, no deployment |
| `npm run test:handling` | PASS; fixed-step handling and calibration reports |
| `PORT=5577 npm run test:performance` | PASS; Monza means **97.23 / 96.77 / 97.41 FPS**, minima of smoothed samples **82.75 / 82.14 / 81.22** |
| `RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance` | PASS; Vegas means **100.36 / 100.24 / 100.45 FPS**, minima **84.71 / 83.59 / 86.07** |
| `PORT=5579 npm run demo:smoke` | PASS; three independent windows, both players connected, mock decisions, racing phase and HTTP health; own resources cleaned up |
| `curl --fail --silent http://127.0.0.1:5477/health` | PASS; existing server remains mock, **paidCalls: 0** |
| `curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/` | **HTTP 200** |
| `python3 scripts/review-v6.py after` | Final reference pairs, before/after pairs and every-view contact sheets generated and inspected |

FPS order is Vector / Chaos / Broadcast. Each benchmark used three independent headed Chromium contexts at 1100×850, Apple M4 Pro / ANGLE Metal, 50 samples at 500 ms after warmup, without overlapping Blender/browser tests. Both means and minimum sampled smoothed FPS exceeded 60. **The 110 FPS Monza stretch target was not reached.** These are HUD EMA samples, not a guarantee for every frame or every MacBook. Raw measurements and summary are in the round folder.

Before-shots, three intermediate review sets, final shots, rejected-run logs and detailed critique are in `artifacts/realism-v6/`. The script run on the rejected capped-mouth asset was stopped before benchmarks. Full verification was repeated on the corrected asset; after that, only an additional exported-aperture regression test and documentation were added. Build/typecheck and the complete 55-test unit suite were rerun. No gameplay/provider logic changed. All measured/tested agent decisions used mock mode; no real Jev/Luna/engineer API calls were made.

Final review confirms the inlet silhouette, individual finger motion, foliage depth and warm lakeside landmark changes. It does **not** claim reference-level photorealism: cockpit coaming/halo-root transitions, tyre/controls detail, solid tree crowns, generic surrounding towers and approximate reflections remain visible gaps. See `artifacts/realism-v6/REVIEW.md` for concrete comparisons and perspective limitations.

## Realism v7 — 2026-11-17

Baseline `feb5baa`; final captures and logs: `artifacts/realism-v7/`. Blender **5.2.2 LTS** (`d13f752e3b9c`), factory startup, Cycles CPU AO baking. No Blender crash, reinstall, backend workaround or Three.js model fallback was needed. Both car and circuits were regenerated from their Blender scripts.

Actual authoring commands:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --version
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/blender/build_car.py
npm run circuit:build
```

The circuit command exports the authoritative render paths, generates the original texture atlases and invokes Blender with `build_circuits.py -- 7`. The final car has **241,170 triangles**, under the unchanged 245,000 high-LOD cap. Exported bounds measure **5.627269 m long × 2.000000 m wide**, **3.600000 m wheelbase**; highest point is **1.171 m**, including the camera. Monza has 96-triangle open near branchlet prototypes and 64-triangle open far prototypes, with native GPU instancing. The new asset test verifies alpha textures and both prototype budgets.

Final verification command: `zsh artifacts/realism-v7/verify.sh` — **exit 0**. It exports Node 24.14.0 onto PATH, `JEV_MOCK=1 ENGINEER_MOCK=1`, both review output directories and `WRANGLER_SEND_METRICS=false`. No real Jev, Luna, engineer or paid provider requests were made.

| Actual command | Final result |
| --- | --- |
| `npm run build` | PASS; web/MCP/host build and both TypeScript targets; largest MCP HTML **23,493,692 / 26,214,400 bytes** |
| `npm run typecheck` | PASS |
| `npm test` | **56 passed / 8 files**, including geometry/LOD/rigs, apertures, connected body, circuits, physics, timing and mock brains |
| `CAR_REVIEW_DIR=realism-v7/after/cars CIRCUIT_REVIEW_DIR=realism-v7/after npm run test:e2e` | **9 passed**, headed Chromium; shared races on both circuits, both agent matchups in mock mode, radio/pit/laps/results, all car/circuit cameras and scene switching |
| `npm run test:mcp` | **2 passed**; independent MCP app contexts, invitation join, clipboard fallback, browser invite joining/spectator, both circuits, strict CSP |
| `npm run test:worker` | **2 passed**, local workerd/Durable Objects; physics, both intents, radio, disconnect/ownership and MCP resource; paid calls 0 |
| `npm run worker:check` | PASS; **dry-run only**, no deployment |
| `npm run test:handling` | PASS; fixed-step handling and calibration |
| `PORT=5577 npm run test:performance` | PASS; Monza mean FPS **84.07 / 84.55 / 85.66**, minimum sampled smoothed FPS **67.21 / 67.96 / 69.46** |
| `RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance` | PASS; Vegas means **91.64 / 91.50 / 91.39**, minima **75.93 / 76.00 / 77.66** |
| `PORT=5579 npm run demo:smoke` | PASS; 3 independent windows, both seats connected, mock decisions, racing phase, HTTP health; own resources closed |
| `curl --fail --silent http://127.0.0.1:5477/health` | PASS; existing server remains reachable, mock, **paidCalls: 0** |
| `curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/` | **HTTP 200** |
| `python3 scripts/measure-car.py` | PASS; actual GLB bounds saved to `measurements.json` |
| `python3 scripts/review-v7.py after` | All final reference pairs, before/after pairs and contact sheets generated and visually inspected |

Performance order is Vector / Chaos / Broadcast. Three independent headed contexts, each **1100×850**, Apple M4 Pro / ANGLE Metal, 50 samples at 500 ms after warmup, no overlapping Blender or browser-test work. Means and minimum smoothed samples exceed 60 FPS. These are HUD EMA measurements, not a per-frame guarantee. **Performance is lower than v6** (Monza approximately 97 FPS; Vegas approximately 100 FPS): transparent leaf coverage and additional lighting cost rendering time despite the lower Monza triangle count. The earlier 110 FPS Monza stretch target remains unmet. Raw samples and a concise JSON summary are in the round folder.

Visual iteration evidence: pass 1 rejected lumpy halo roots, sparse far foliage and clipped wordmarks; pass 2 caught a white underside strip in the cockpit close-up; pass 3 rejected a triangular paint-mask artifact; pass 4 verified a continuous rolled liner with clean edges. Final `after/` captures were freshly taken by the full suite. The earlier verification sequence was stopped for that visual defect and the entire sequence rerun after correction. Extra focused Playwright capture runs are retained in `logs/captures-pass-*.log`.

Remaining gaps are explicit in `artifacts/realism-v7/REVIEW.md`: body ripples in macro views, chunky controls and fingers, approximate studio/cube-map reflections, repeated foliage forms, sparse undergrowth and insufficient Vegas street-level density. This is not a claim of reference-level photorealism or surveyed circuit scenery. Gameplay, radio, server/provider logic, MCP/invite, Worker and mock architecture remain intact. Local commit only; no push, publishing or deployment.


## Helmet-visible T-cam and refined driver’s-eye view — 2026-11-17

Baseline `16be387`; final source and both LODs rebuilt using **Blender 5.2.2 LTS**, hash `d13f752e3b9c`, `-b --factory-startup`, Cycles CPU AO baking. No Blender crash, reinstall or backend fix was needed. The final high LOD has **244,480 triangles**, within the existing 245,000 limit. Both helmets now carry the correct 44/23 team numbers.

Final complete command: `zsh artifacts/onboard-v8/verify.sh` — **exit 0**. The script sets Node 24.14.0 on PATH, `JEV_MOCK=1 ENGINEER_MOCK=1`, both screenshot directories and `WRANGLER_SEND_METRICS=false`. All provider calls were mocked; paid calls stayed **0**. No push, publication or deployment.

| Actual command | Final result |
| --- | --- |
| `npm run model:build` | PASS; Blender source, GLBs/LODs, gzip assets and AO/contact textures exported |
| `npm run build` | PASS; web/MCP/host bundles and both TypeScript targets; largest dist/mcp/mcp-app.html, 23589303 / 26214400 bytes |
| `npm run typecheck` | PASS |
| `npm test` | **59 passed / 9 files**; includes actual exported-mesh ray tests for helmet visibility, tyre/dashboard framing and glove/liner clearance through physical steering limits |
| `CAR_REVIEW_DIR=onboard-v8/after/cars CIRCUIT_REVIEW_DIR=onboard-v8/after npm run test:e2e` | **9 passed**, headed Chromium; real WebSockets, full races, radio, pits/laps/results, both circuits/matchups, all cameras/finishes; final screenshots include both teams and ±0.42 rad steering |
| `npm run test:mcp` | **2 passed**; two independent MCP contexts join by invite, browser spectator agrees, clipboard fallback and browser invite joining, both circuits |
| `npm run test:worker` | **2 passed**; local workerd/Durable Object/MCP/physics/driver/radio checks |
| `npm run worker:check` | PASS; **dry-run only** |
| `npm run test:handling` | PASS; handling and calibration |
| `PERF_UNCAPPED=1 PERF_DEMO_PROCESSES=1 PORT=5577 npm run test:performance` | PASS; Monza means 119.87 / 119.85 / 119.95 FPS; minima 117.67 / 118.96 / 118.14 |
| `PERF_UNCAPPED=1 PERF_DEMO_PROCESSES=1 RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance` | PASS; Vegas means 119.55 / 119.82 / 119.79 FPS; minima 116.66 / 118.31 / 118.58 |
| `PORT=5579 npm run demo:smoke` | PASS; three independent windows, both seats/decisions, racing and HTTP health |
| `curl --fail --silent http://127.0.0.1:5477/health` | PASS; existing server reachable, mock, paidCalls 0 |
| `curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/` | **HTTP 200** |
| `python3 scripts/measure-car.py` | PASS; exported geometry measurements saved |
| `python3 scripts/review-onboard.py after` | Reference pairs, before/after pairs, glove crops and camera contact sheet generated and visually inspected |

Performance order: Vector / Chaos / Broadcast. Each headed viewport was 1100×850, on Apple M4 Pro / ANGLE Metal. The final benchmark uses **three independent browser processes, matching `npm run demo`**, with frame-rate limits disabled to measure capacity; it samples the existing HUD EMA 50 times at 500 ms, with its 120 FPS ceiling. It does not establish that every frame exceeds 60 FPS, nor that a 60 Hz display presents 120 FPS.

The earlier display-synchronised shared-browser run averaged approximately 60 FPS but failed the strict minimum at 59.41. Uncapped contexts sharing one browser also fluctuated below 60. Those failures and the later topology change are preserved and explained in `artifacts/onboard-v8/REVIEW.md`; they were not silently discarded. Small decals/buttons/stitches now use baked occlusion instead of redundant dynamic shadow casting; major car and driver forms still cast shadows. No resolution or geometry quality reduction was used to obtain the final result.

Final screenshots are under `artifacts/onboard-v8/after/cars/`, especially `reference-vs-tcam.jpg`, `before-after-cockpit-onboard.jpg`, `clean-tcam-a.png`, `clean-tcam-b.png`, `clean-cockpit-a.png`, and `full-lock-left.png` / `full-lock-right.png`. Before shots, rejected camera/driver iterations, Blender logs and exact test outputs are preserved in the same round directory. The reference comparison uses the photo’s exact aspect ratio without cropping or retouching.

Remaining gaps: stylised fabric/pressure deformation, chunkier wheel controls, simpler lighting/material response, and the prior approved white/red upper-body livery differs from the new photo. The T-cam hides more of the steering wheel behind the helmet than the photographed corner. This is a substantial POV/driver correction, not a claim of photoreal equivalence. Monza/Vegas geometry, authoritative gameplay, engineer/driver providers, radio and invitations remain intact.
