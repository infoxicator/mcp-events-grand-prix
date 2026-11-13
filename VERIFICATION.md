# Verification record

Verified locally on 2026-11-12 with **Node.js 24.14.0**. No live provider key was used. No remote, push, publish, or deploy was performed.

The execution environment exposes different default Node versions inside and outside the command sandbox, so permissioned commands explicitly selected Node 24:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH npm run verify
```

This completed successfully, running these exact package commands in sequence:

| Command | Result |
| --- | --- |
| `npm run build` | PASS: strict TypeScript check and Vite production build |
| `npm test` | PASS: 2 Vitest files, 9 tests, real headless Chromium |
| `npm run test:provider` | PASS: actual SDK over local HTTP; valid structured action; 429, malformed answer, and 1500 ms timeout fall back visibly; no retries; provider selection checked |
| `npm run test:e2e` | PASS: 1 Playwright scenario, 23.3 seconds; production server, three separate contexts, 686 authoritative frames, point scored 0:1 after a 13-hit rally, 112/98 left/right agent intent messages, reconnect preserved score |

The e2e also verified that spectators send no agent requests or intents, duplicate seats become spectators, live paddles move in response to accepted intents, replay enters/exits, title card opens, reset clears score, a 480px window has no horizontal overflow, and the full layout fits at 1280×800. It reported zero browser page errors. A final `npm run build` also typechecked the provider-verification script after expanding the TypeScript include list.

Launcher verification:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH PORT=5178 JEV_MOCK=1 npm run demo:smoke
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH PORT=5178 JEV_MOCK=1 npm run demo:smoke -- --headed
```

Both passed: three independent Chromium sessions opened, both player sockets connected, mock decision cards appeared, the game entered play, and HTTP health was OK. The second run exercised visible desktop app windows and window positioning. Both smoke runs closed their own windows and server successfully.

Dev-server reachability:

```sh
env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH npm run dev
curl --fail --silent http://127.0.0.1:5177/health
curl --fail --silent -o /dev/null -w '\nGET / → HTTP %{http_code}\n' http://127.0.0.1:5177/
```

PASS: health returned `ok: true`, `mode: mock`, `physicsHz: 120`, `snapshotHz: 30`, Node `24.14.0`, and an advancing tick. The page returned HTTP 200. The shared browser also loaded the app and its local fonts successfully. The verification server was stopped afterward so `npm run demo` can own the default port.

The initial default-port attempt found an unrelated app on 5173. This demo was moved to 5177; that app was left untouched. Vite HMR was moved to game port + 1000 to avoid another default-port collision. An early physics test fixture incorrectly put a ball beyond the left boundary while moving right; correcting the velocity produced the expected score. The final complete suite above passed.

A direct scan of the built JavaScript found no `TypeSafeClient`, `apiKey`, provider key environment variable names, or TypeSafe API endpoint. `.env.local.example` is tracked; `.env.local` and all actual environment files are ignored. `git remote -v` was empty.

Visual artifacts from the final Playwright run are under:

```text
test-results/arena-two-independent-brow-56f8c--match-replay-and-reconnect/
  arena-live.png
  arena-scored.png
  title-card.png
  narrow-window.png
  laptop-window.png
```

These images were inspected for layout and readability. Test artifacts are intentionally ignored in Git.

## Limits

Offline verification establishes that the integration uses the installed official SDK correctly against a documented HTTP response fixture and that the complete game works in mock mode. A paid Jev call through OpenRouter or Vercel was not made. Provider key validity, model availability, real latency, playing strength, and upstream billing require a real key. The configured provider remains visible while individual failures are labeled as fallback.

## Run it

```sh
npm run demo
```

From a new checkout: Node 22+, `npm ci`, then the command above. No key is needed. See README.md and .env.local.example to enable real Jev decisions.

## 2026-11-13: Jev versus Luna mode

Added a selectable `jev-vs-luna` matchup while preserving `jev-vs-jev`. The server selects one authoritative matchup for all windows; mode changes reset score, replay, and pending decision generations. The right player calls OpenAI's documented `POST /v1/decisions` with `gpt-6-luna`; the left player keeps the official Jev SDK. UI model names, header, title card, and provider attribution update together. Credentials remain server-side, and each player can independently be live or mocked.

Verification commands used Node 24.14.0, with the same explicit PATH selection described above:

| Command | Result |
| --- | --- |
| `npm run build` | PASS: strict TypeScript and Vite production build, including new server adapters and verification script |
| `npm test` | PASS: 11 tests across 3 files in Chromium, including matchup validation and side assignment |
| `npm run test:provider` | PASS: original Jev SDK success and error/timeout checks preserved |
| `npm run test:luna` | PASS: real local HTTP request to `/v1/decisions`, pinned model, JSON state, three choice questions, named-answer decoding, per-side real/mock configuration; success plus 9 failure cases |
| `npm run test:e2e` | PASS: 2 scenarios in 48.8 seconds, each opening left/right/spectator in separate browser contexts |
| `PORT=5188 npm run demo:luna -- --smoke` | PASS: launcher selected Jev-vs-Luna, opened three independent sessions, both players connected, visible mock decisions, phase play |

The final original-mode scenario observed 689 authoritative snapshots and 112/91 player intent messages, scored 1:0 after a 12-hit rally, and passed replay/reconnect/reset/laptop checks. The Luna scenario scored 0:1 after a 17-hit rally, verified both engine labels and the `gpt-6-luna` model across all views, checked both accepted agent intents, refreshed a player without changing mode, checked the Luna title card, switched back to Jev-vs-Jev with a clean score, switched again while decisions could be in flight, and passed a 480px overflow check. No browser errors were reported.

Luna HTTP failure cases: 429, 503, invalid lane, refusal, missing answer, duplicate answer, invalid confidence, wrong response model, and timeout. Every case produced an explicitly Luna-labeled heuristic fallback with exactly one HTTP attempt; the timeout completed in approximately 1502 ms. Real/mock metadata tests confirmed no credentials are included in public player metadata. A scan of built JavaScript found no OpenAI/Jev key variable names, provider API URL, fixture credential, or TypeSafeClient.

The first expanded e2e run exposed an existing replay timing edge: a WebSocket replay response can arrive after the current animation frame's timestamp, producing a negative replay index. Clamping that index to zero fixed the crash; both final e2e scenarios passed afterward. The mode selector query was also restricted to buttons so the body's diagnostic matchup attribute does not receive button ARIA state.

Screenshots under the ignored `test-results/arena-Jev-versus-Luna-is-s-f71f8-t-and-switches-back-cleanly/` folder were inspected at full and narrow widths. No paid OpenAI or Jev call was made. Real model access requires a server-side `OPENAI_API_KEY` for Luna and a supported provider key for Jev; without keys, both sides are clearly marked as mock. The Cloudflare deployment thread is integrating this local commit into its separate adapter and owns its Workers-runtime and deployment verification.

Run the new matchup with `npm run demo:luna`, or choose **Jev vs Luna** in the existing arena. Set `PONG_MATCHUP=jev-vs-luna` for server startup selection. See README.md and .env.local.example for keys and per-player mock settings.

## 2026-11-13: Direct TypeSafe Jev keys

Added `JEV_PROVIDER=typesafe` with server-side `TYPESAFE_API_KEY`, the official `https://api.typesafe.ai` endpoint, and the SDK's `jev-latest` default. Direct TypeSafe takes precedence when auto-selecting among configured keys. Explicit provider selection and model overrides remain available. Added a blank key entry to the ignored local environment file without changing existing settings.

`env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH npm run verify` passed: TypeScript/Vite build, 11 unit tests, Jev SDK HTTP fixtures including the exact direct URL and authorization, Luna fixtures including direct-Jev/Luna player metadata, and both three-context scored WebSocket Playwright scenarios (48.3 seconds). The original match scored 1:0 with a 12-hit rally; the Luna match scored 0:1 with a 17-hit rally. A production JavaScript scan confirmed no credential variable names, direct endpoint, fixture key, or TypeSafeClient in browser bundles. No paid provider call was made.

An initial run under the shell's Node 20 was stopped by the sandbox's local socket restriction during the HTTP fixture setup; the complete successful verification used Node 24 with local server access.

## 2026-11-13: Live Luna quota investigation and cooldowns

The running demo was observed via a passive spectator WebSocket: 30 unique successful Jev decisions versus 32 Luna fallbacks. A real diagnostic request to the configured `https://api.openai.com/v1/decisions` endpoint returned HTTP 429, `rate_limit_exceeded`, with a 60,000 tokens/minute limit and a 735-token request. Five requests/second could demand approximately 220,500 TPM. After pausing the launcher, the provider also reported a daily request limit of 50, all 50 used, and `Retry-After: 1728`. Its request ID was `req_224ed4b96cd9473db948ede7d4bb48bf`. This is an account-capacity blocker; inference latency and account allowance are separate. No billing or account settings were changed.

Reduced Luna request size with rounded coordinates and concise descriptions, preserving all three typed questions and all 17 paddle lanes. Added a configurable minimum 600ms pause after live Luna responses and token-usage pacing with 20% headroom and provider TPM headers. HTTP failures include safe status/request metadata and specific quota warnings. `Retry-After` is honored, with bounded exponential backoff otherwise. Server and browser both enforce the delay; server cooldown survives player reconnect, match reset, and matchup changes within the same process. The header now shows `API FALLBACK` on failed provider decisions rather than continuing to imply live success. Call timing details are available on the response-time tooltip and in public WebSocket decision metadata.

`env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH npm run verify` passed: build/typecheck, 11 unit tests, Jev adapter fixtures, Luna success plus 10 failure cases, the new quota integration test, and both scored Playwright scenarios (48.3 seconds). The quota integration test uses three browser contexts, a real local HTTP fixture and WebSockets: one successful Luna decision, then a 30-second daily-limit 429. It confirms >=600ms pacing, the correct UI warning/header, continued left-player intents, no additional provider calls during cooldown, and cooldown enforcement after a raw WebSocket player reconnect and reset. Total fixture requests remained exactly two. The first verification run caught a trailing comma in quota-limit parsing; corrected it and reran the complete suite successfully. A final wording-only change to the decision-rate footnote was followed by another successful build.

Restarted `npm run demo:luna` with the existing real keys. HTTP health returned 200 and both player windows were connected. A six-second passive WebSocket observation saw 11 unique successful Jev decisions (latest 130ms) and exactly one unchanged Luna fallback, sequence 1, HTTP 429, a 1,728,000ms cooldown and `50 requests/day`. The real request ID was `req_239f16798d5d45f48311a03290ca1714`. This confirms the real quota error is visible and no repeated Luna decision requests run during that observation. A successful real Luna decision remains unverified because the account's daily allowance is exhausted; local fixture success does not establish available account quota.

## 2026-11-13: MCP App alongside the web app

Added a stateless Streamable HTTP `/mcp` endpoint to the existing Node server using the official MCP 2.x server/client and Node transport packages plus `@modelcontextprotocol/ext-apps` 2.0.4. `open_pong` links to `ui://jev-pong/arena.html` with MIME `text/html;profile=mcp-app`; `pong_status` exposes the same authoritative state that web spectators receive. The UI is a single HTML bundle with the existing renderer, styles and fonts, mounted after the MCP tool result. The normal web entry calls the same mount function, preserving its routes and behavior. Embedded controllers and spectators use the same native WebSocket protocol with a random process-local capability so ordinary foreign-origin connections remain blocked. Provider keys remain server-side.

Added a local SDK AppBridge host and separate-origin double-iframe sandbox. The MCP view supports host styles, safe areas, fullscreen, opening web links, optional AI controllers, visibility pause, and teardown. Opening read-only does not start AI calls. The MCP demo command defaults to mock even when local keys exist; configured live providers require explicit `JEV_MOCK=0`.

Commands used Node 24.14.0 through `env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH`:

| Command | Result |
| --- | --- |
| `npm run verify` | PASS: all three Vite builds/typecheck, 11 Vitest tests, Jev and Luna HTTP adapter fixtures, quota integration, web e2e, and MCP integration |
| `npm run test:e2e` (inside verify) | PASS: both original and Luna three-context web scenarios; 45.5s total, scored points, replay/reconnect/reset/layout |
| `npm run test:mcp` (inside verify) | PASS: real MCP SDK initialization/discovery/call/resource read; sandboxed AppBridge view; ball and paddle motion, both accepted intents, score 1:0 with best rally 12 and 1,711 observed frames; web spectator and MCP tool agree |
| `PORT=5197 npm run demo:mcp` | RUNNING: mock game/MCP on 5197, MCP Apps host on 5198, isolated sandbox on 5199 |
| Real SDK client against `http://127.0.0.1:5197/mcp` | PASS: connected to `Jev Pong` v1.0.0, discovered `open_pong` and `pong_status`, invoked read-only open, read bundled app resource |
| HTTP reachability checks | PASS: original web port 5177, new game/MCP 5197 and host 5198 all return 200 |

The MCP protocol test confirms text fallback, UI resource linkage/MIME, no external script references, inline fonts, no provider keys/endpoints in the bundle, and rejected untrusted HTTP/WebSocket origins. Playwright also verifies replay, fullscreen, Luna selection shared with the web view, stop/start, preserving an already-claimed web player seat, and teardown disconnecting only MCP-owned controllers. No browser errors were observed. The first MCP test checked paddle movement too early; replaced the immediate assertion with a bounded wait for actual motion and reran the full suite successfully. A later test-only addition waits for both embedded scoreboard values before recording the scored screenshot; `npm run test:mcp` passed again with score 0:1, best rally 17 and 2,161 frames.

The shared browser preview was opened at `http://localhost:5198/?autoplay=1`. Its snapshot showed a completed MCP initialize/tool-input/tool-result handshake, the rendered neon canvas inside the sandbox, mock controllers and a connected WebSocket view, with no console errors. Local screenshot: `artifacts/mcp-app-scored.png` (ignored). Verification used real protocol/network/browser/physics; AI provider decisions were mocked and no paid provider requests were made for this milestone. This verifies the included local MCP Apps host, not registration inside a third-party desktop client or remote hosted connector. No deployment, push or publication was performed.


## 2026-11-13: Cloudflare-hosted MCP App

Integrated the previously deployed Workers/Durable Object room implementation into this repository, retaining the local Node web and MCP app. Added a Web-standard stateless Streamable HTTP `/mcp` adapter using the real MCP 2.x server transport. The Worker serves the bundled MCP HTML resource. Each hosted tool invocation creates an isolated mock-only Durable Object room; owner/seat/sandbox capabilities are supplied privately in `_meta`, with no provider keys in the resource or model-visible result. Public web rooms remain mock-only, with private live room creation separately gated by the existing administrator secret. Room expiry is 15 minutes, private paid calls have a durable 1,200-attempt budget, and disconnect/stop/teardown pauses physics so idle sockets may hibernate. Real provider secrets were not uploaded or used for this deployment verification.

Deployed URL: https://jev-vs-jev-pong.mcp-ui-flows-nanobanana.workers.dev
MCP endpoint: https://jev-vs-jev-pong.mcp-ui-flows-nanobanana.workers.dev/mcp
Worker version: `7e8c600c-fa66-42eb-ab8b-ab73a6c23e10`.

Commands used Node 24.14.0 through `env PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH`. Wrangler testing used `WRANGLER_LOG_PATH=/tmp/jev-pong-wrangler.log WRANGLER_SEND_METRICS=false`; deployment unset the stale `CLOUDFLARE_API_TOKEN` override and used existing browser OAuth. Tests use mock brains or local HTTP fixtures, never the local file’s real credentials.

| Exact command (after environment prefixes) | Result |
| --- | --- |
| `npm run verify` | PASS: three production builds + Node/Worker typechecks; 11 Vitest tests; Jev and Luna HTTP fixtures; quota integration; both scored three-context web scenarios; sandboxed local MCP integration |
| `npm run build` | PASS after final hosted UI changes: web, single-file MCP UI, local SDK host; strict Node/Worker typechecks |
| `npm run typecheck` | PASS, including new hosted e2e test sources |
| `node --import tsx scripts/verify-clock.ts` | PASS: irregular Workers scheduling preserves 120 Hz, catch-up capped to 30 steps; invalid/malformed/oversized room options rejected |
| `npm run test:worker` | PASS: 7 tests, 1 explicitly opt-in full-match test skipped; 2.3 minutes. SDK/Luna success and failure fixtures in workerd, scored web/MCP games, room/seat isolation, replay, pause/reconnect, durable budget, checkpoint recovery and layout |
| `npm run test:mcp` | PASS again with final shared UI: scored 1:0, best rally 24, 2,989 state frames; real SDK protocol, sandbox, web synchronization, replay/fullscreen/mode switch, seat preservation and teardown |
| `npx wrangler deploy --dry-run --outdir /tmp/jev-pong-worker-bundle` | PASS: bundles Worker, 23 assets, DO/rate-limit/assets bindings; no upload |
| `npx wrangler deploy` | PASS: deployed existing Worker, 51 ms startup, 1,251.36 KiB upload / 222.04 KiB gzip, version above |
| `curl --fail --silent --show-error https://jev-vs-jev-pong.mcp-ui-flows-nanobanana.workers.dev/health` | PASS: HTTP 200, cloudflare-workers, 120 Hz physics, 30 Hz snapshots, publicMode mock |
| `curl --silent --show-error -o /dev/null -w 'web HTTP %{http_code}\n' https://jev-vs-jev-pong.mcp-ui-flows-nanobanana.workers.dev/` | PASS: web HTTP 200 |

The first Workers regression run caught a laptop-height overflow because the room launch links stayed expanded during play. Restored the hosted panel’s auto-collapse on leaving the lobby, then reran all enabled Workers tests successfully. Restricted-sandbox server binds initially failed; the successful test runs used authorized local socket access. Port 8787 belongs to a different workspace’s application and was left untouched; these Workers tests use 8797 and sandbox host ports 5398/5399.

Public deployment verification command:

```sh
LIVE_URL=https://jev-vs-jev-pong.mcp-ui-flows-nanobanana.workers.dev npm run test:worker -- e2e-worker/mcp.spec.ts e2e-worker/hosted.spec.ts --grep 'public MCP|Cloudflare room:'
```

PASS: both tests, 1.1 minutes. The real public web app completed a scored three-context match (1:0), measured 121.2 Hz physics, and verified pause/reconnect/reset permissions and layout. The real HTTPS MCP endpoint initialized and exposed both tools and its self-contained UI resource. The sandboxed SDK AppBridge app connected over public WSS, scored 0:1 with 120 accepted intents per player and 2,298 frames, shared its score with a separate web spectator, and passed replay, fullscreen, Jev/Luna switching, invalid capability rejection, isolated room checks and teardown. Hosted mode was mock and the room's paid-call counter stayed exactly zero. Screenshot: `worker-test-results/mcp-public-MCP-on-Workers-d-*/cloudflare-mcp-app.png` (ignored test artifact).

Temporary browser contexts and all local Pong/Workers/MCP test servers shut down after verification. The hosted test rooms paused with both player seats offline; the expiry alarm later removes them. The README records how to add the public `/mcp` URL in ChatGPT with no authentication. Registration/rendering inside the user's ChatGPT account was not performed; the deployed protocol and app were verified using the real MCP SDK/Apps host. No Git push was performed.

## 2026-11-13: One player per MCP host, shared-room invitations

Added `player: left|right|both|spectator` to the hosted and local `open_pong` tools. Hosted `invite` input joins a specific existing room and seat; it never grants owner/opponent credentials. The first app shows a copyable other-player invitation privately from tool-result `_meta`. The second app receives only its own seat link and cannot reset or change the matchup. Existing both-player mode, standalone web and public spectator links continue working. Public decisions remain mocked and the paid-call counter stays zero. README includes ChatGPT → Claude → browser instructions and connector-refresh guidance.

The new split-host Playwright test uses two independent real MCP SDK/AppBridge browser contexts plus a normal browser spectator. It checks left-only lobby/start, right-seat invitation joining, bad credentials and wrong-side rejection, shared room/score, independent intents, zero spectator intents, denied owner controls, and teardown leaving the other player connected while physics pauses. It does not automate registration in real ChatGPT/Claude accounts.

The first split-host run uncovered a real interpolation bug: pausing immediately after scoring could change phase without advancing the physics tick, leaving the browser stuck on the point overlay. Interpolation now accepts new snapshots even at the same tick and switches across phase/point boundaries once their buffered arrival time passes. Two focused unit regressions cover same-tick pause, normal interpolation and reset.

Commands used the same Node 24 environment prefix as above:

| Command | Result |
| --- | --- |
| `npm run build` | PASS: strict Node/Worker typechecks and all three production bundles |
| `npm run verify` | PASS: 13 unit tests, Jev/Luna provider fixtures, quota integration, both scored three-context web e2e cases (48.5s), and local MCP integration (score 1:0, rally 12, 1,784 frames) |
| `npm run test:worker -- e2e-worker/mcp.spec.ts` | PASS: both original and split-host MCP scenarios, 1.5m; split match 1:0, 253 intents per player, zero paid calls, independent teardown |
| `npx wrangler deploy` | PASS: Worker version `f0dfd995-0cfd-453a-bd83-0c6ecaa44a42`, same public endpoint, 52ms startup |
| `LIVE_URL=https://jev-vs-jev-pong.mcp-ui-flows-nanobanana.workers.dev npm run test:worker -- e2e-worker/mcp.spec.ts --grep 'two independent'` | PASS against deployment: 28.2s; same room across two MCP apps and browser spectator, score 0:1, 115 accepted intents per player, zero spectator intents/paid calls; invitation restrictions and independent teardown |

All test contexts and temporary local servers were closed after the public test. Local Git commit only; no push. The same `/mcp` URL now advertises the new inputs; refresh existing host connections before starting a new split-host match.
