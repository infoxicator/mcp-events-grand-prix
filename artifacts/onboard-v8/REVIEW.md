# Onboard reference rebuild — 2026-11-17

Baseline: local commit `16be387`. The user's attached 738×375 image is the authority for the **T-cam composition**. The approved SF-26 video remains the car/wheel/livery reference. Both the lower driver's-eye view and the T-cam remain available, for both teams. Monza, Las Vegas and the race/provider/network code are retained.

## What was changed

Blender 5.2.2 LTS (`d13f752e3b9c`), `-b --factory-startup`, Cycles CPU AO baking, GLB high/low LOD exports. No crash, reinstall or backend workaround was necessary. The existing USD cache-line warning and future Blender 6 material API deprecation are warnings; exports completed. No procedural Three.js replacement model.

- The original white ellipsoid driver became a shaped helmet with a curved visor and seals, hinges, chin ventilation, crown vents, binding, red/white pinlines and original NEXUS/team-number markings. The seated pose brings the head forward into the cockpit. Team A has a yellow helmet and gloves; team B has ivory equipment.
- Rebuilt gloves use broad joined palms, embedded knuckles, short tapered phalanges curling around the outside/front of the grips, shorter opposed thumbs, suede panels, seams and cuffs. Ten finger pivots keep their small steering-dependent motions. Forearms aim between seated elbows and the moving cuffs.
- The T-cam uses a forward lens, slight lateral offset and downward pitch. The camera follows the chassis slope and heading, with restrained speed-dependent vibration. The airbox is physically behind its sightline; no bodywork is hidden to obtain the view.
- The eye camera still hides the head, as required when viewing from inside it. It now sees the front tyres and mirrors above the coaming, with the wheel and hands below. The wheel is raised 6 cm, with its original longitudinal position retained after a failed forward-placement experiment.
- Small original NEXUS/AEROLAB/VECTOR marks conform to the halo in Blender. No real sponsor logos were copied. Both teams have T-cam buttons; their telemetry follows the selected driver.

## Visual review iterations

1. **Round 1:** helmet finally visible, but too large; halo too high relative to tyre tops; crown wordmark upside down. The new fingers removed the long exposed loops, but thumbs were still too long and palms too egg-shaped. Screenshots retained in `round1/`.
2. **Round 2:** shortening thumbs and adding knuckles improved the gloves. Moving the lens higher and backward improved halo placement but brought the airbox back across most of the helmet. Rejected. A single ray to the crown had missed this; the final regression now samples the rear crown too. `round2/`.
3. **Round 3:** forward lens plus revised seated head pose cleared the airbox. Helmet top and halo height approached the supplied image at the same aspect ratio. The crown still needed smaller vents and cleaner lettering. `round3/`.
4. **Round 4:** smaller vents, yellow gloves and offset framing improved the match. Raising **and moving** the wheel forward caused the glove backs to enter the narrowing cockpit liner. Rejected; a new glove sightline regression reproduced this failure. `round4/`.
5. **Round 5 / final:** kept the wheel's height adjustment and restored its longitudinal position. Both glove backs remain visible at centre, ±0.20 rad steering and the physical ±0.42 rad limits (where the same-side forearm can naturally obscure part of the glove), and hands/sleeves stay attached. Added the conforming halo marks and kept the existing 245,000-triangle limit. Final captures and full verification are under `after/` and `logs/`.

The final contact sheet also caught the shared helmet's 44 on team B. Separate Blender-exported helmet number groups now select 44/23 per team; the complete suite and screenshots were repeated after that correction. Final high LOD: **244,480 triangles**. The extra physical-limit regression initially rejected a sleeve naturally hiding part of the glove; it now permits only that same-side sleeve at ±0.42, while continuing to reject cockpit/body obstruction. Both full-lock screenshots were visually inspected.

The first camera-only web build removed the MCP host output, so Playwright's host startup timed out. Rebuilding all three bundles fixed test setup. A screenshot-style cleanup had a TypeScript `Node.remove` error; it was corrected to `parentNode.removeChild`. These initial failures and rejected geometry/placement tests are retained in the logs, not counted as passing checks.

## Reference comparison and remaining gaps

`after/cars/reference-vs-tcam.jpg` places the supplied image beside the final 1476×750 render, reduced to exactly the same aspect. No cropping, warping, generative image enhancement or photo compositing is used. `reference-vs-tcam-turning.jpg` applies steering to the same straight-track fixture; it is not a claim to recreate the photographed corner. The opponent is 8 m ahead for the final composition fixture. Full live races are verified separately.

Approximate manual landmarks: the reference's halo apex is around 38% of image height and helmet crest around 69%; the final framing places these around 38% and 68%. The helmet is right of centre, as in the photo. Tyre tops remain roughly 4 percentage points lower in frame. These are perspective/composition checks, not a camera calibration from surveyed measurements.

The result is still a realtime game render, not photoreal footage. Specific gaps:

- The approved video livery has broad white upper-body panels; the new onboard photograph has mostly red cockpit shoulders. Those white panels were retained rather than silently replacing the prior approved livery.
- The photographed wheel/raised glove is more visible above the helmet during that corner. Our T-cam keeps most controls behind the helmet; the lower camera exposes them fully.
- Glove forms and knuckle placement are much less tubular, but fabric folds and pressure deformation remain stylised; there is no cloth simulation or physical hand-contact solver.
- The SF-26 wheel comparison still shows chunkier button collars/rotaries and flatter cabin shading in the game. Its control colours, butterfly outline and display layout are retained, but this is not a claim of an exact sculpt or ray-traced material match.
- The helmet has fewer painted graphic layers and surface imperfections. Real camera lens effects, motion blur, exposure behaviour and video compression are not reproduced.
- Monza's woodland, asphalt and light remain the prior realtime scene. The supplied photograph shows a different location, more cars, closer barriers and different weather. This task did not replace the circuit or add fake background cars to the two-team race.
- Both mirrors share the existing rear-facing render feed; they are not separate optical ray-traced mirrors.

## Reproduce

`npm run model:build` rebuilds the Blender model and baked AO. `zsh artifacts/onboard-v8/verify.sh` runs the full mock checks and saves new final screenshots. `python3 scripts/review-onboard.py after` rebuilds the comparison sheets from unedited captures. `ONBOARD_ONLY=1 CAR_REVIEW_DIR=onboard-v8/round5 npx playwright test e2e/realism-v2.spec.ts` runs the shorter camera review after a full build.

All checks use `JEV_MOCK=1 ENGINEER_MOCK=1`; no paid provider calls, push or deployment.

## Performance methodology and rejected measurements

The original display-synchronised three-context benchmark averaged **60.05 / 60.03 / 60.05 FPS**, but its strict minimum assertion failed at **59.41**. This is retained in `performance-monza-display-synced.json` and its log. Disabling frame-rate/vsync limits while sharing one browser produced uneven **55.99 / 76.09 / 84.99** mean FPS and a minimum around **40.3**; this was not counted as a pass.

The renderer now omits redundant shadow draws for millimetre-scale decals, button caps, stitch lines and similar hardware. These surfaces still receive shadows and the Blender AO bake; the body, tyres, wings, helmet, glove fabric and sleeves retain dynamic casting. The shared-browser uncapped repeat improved Vector's average but remained uneven (**70.01 / 66.85 / 88.37**, minimum **42.9**); that result is retained too.

`npm run demo` uses **three independent Chromium processes**, whereas the old performance helper used three contexts in one process. The helper now supports `PERF_DEMO_PROCESSES=1` to measure the actual demo process arrangement, and `PERF_UNCAPPED=1` to distinguish rendering capacity from the monitor refresh limit. The first run with both flags passed at roughly **119.6 / 119.5 / 119.9 FPS**, minimum **114.0**, without reducing image resolution, model quality, or the existing 60 FPS assertion. Final results are in `performance-monza.json` and `performance-vegas.json` and recorded in `VERIFICATION.md`.

These readings are the existing HUD's smoothed rAF FPS, capped at 120 before averaging, over 50 samples at 500 ms intervals. They are not GPU timer queries, an every-frame guarantee, or a claim that a 60 Hz display presents 120 frames. The prior single-browser failures remain relevant if a user runs all views as contexts within one browser process instead of the demo launcher.
