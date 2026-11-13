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
