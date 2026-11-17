# Continuous side camera — 2026-11-17

Baseline: `187bee4`.

The old trackside camera planted its anchor 70 m ahead, then replaced it when the car was more than 105 m from that anchor. Each replacement moved the viewpoint roughly 175 m in a single frame. At the accelerated race clock these resets were frequent. Broadcast also cycled shots every 11 seconds, cut on overtakes and near misses, switched its focus when the leader changed, and abruptly changed zoom at a 55 m gap.

Broadcast now holds a single side-follow rig. It follows interpolated longitudinal travel, damps road-corridor yaw and lateral motion in elapsed time, blends smoothly around the two cars, and uses a fixed 48-degree lens. The camera rides 26 m beside, 10 m behind and 14 m above its target, clearing the street barriers. Events still update the broadcast graphics; they do not switch the camera. Chase and Aerial remain manual choices using the same stable tracking implementation. Both onboard views, showroom and replay remain available. No car, glove, circuit geometry, physics or provider changes were made.

## Motion review

`e2e/side-camera.spec.ts` drives the actual production renderer with deterministic mock WebSocket updates. Each recording spans 13.5 seconds, including the old timed-cut boundary, multiple former anchor-reset distances, repeated lead swaps, gaps crossing 55 m, steering/lateral oscillation and an overtake event every second. Assertions require a constant SIDE / STABILISED shot and fixed lens, bounded translation and rotation, movement over 300 m, and no browser errors. These controlled fixtures supplement the full authoritative-server race tests; they are not live API runs.

I inspected the Monza and Vegas screenshots and six-frame motion sheets from both the focused and final full-suite runs. Road orientation and scale stay continuous through the lead changes. Cars move relative to each other without camera flips or zoom pulses. The more distant car can leave the fixed frame when the gap opens; that is preferable to an abrupt lens change. Vegas lamp posts and catch fencing can still pass in front of the shot naturally. This change addresses camera discontinuities, not all material aliasing or lighting variation in the renderer.

Final motion data and recordings are in `recordings/`. Full regression output is in `logs/`; performance reports describe three independent headed Chromium processes and the existing smoothed HUD metric, not a per-frame guarantee. Build/unit logs were recorded before `verify.sh`; the script runs the remaining typecheck, browser, MCP, local Worker, handling, performance and demo checks. Worker bundling is dry-run only. Nothing is pushed or deployed.
