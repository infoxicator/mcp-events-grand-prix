# Jev Grand Prix visual acceptance

Measured on the same machine using the production MCP host and the renderer instrumentation bundled with the benchmark. Baseline commit `a93a39c`. Phase 0 commit `c902bd9`. Phase 1 commits `f1bee7e`, `d488dea` and `8385fa6`.

## Visual and geometry evidence

| Gap | Implementation | Commit | Before | After | Measurement |
|---|---|---|---|---|---|
| Expensive gloves and unused pit parts | Reduced glove triangles and removed obsolete exported equipment | `c902bd9` | [Cockpit](before/steer-a-centre.jpg) | [Cockpit](phase1/cockpit/steer-a-centre.jpg) | [GLB counts](phase0/geometry.json). Gloves 32,530 → 13,642. Pit kit 18,582 → 12,210. |
| Duplicated garage staff and repeated props | Shared prototype and tint, instanced palm crowns and streetlight poles, simpler crowd, JPEG gravel | `c902bd9` | [Vegas](before/las-vegas-strip.jpg) | [Vegas](phase1/visual/las-vegas-strip.jpg) | [Both embedded circuit meshes](phase0/geometry.json). Monza 8,686,773 → 6,700,532 bytes. Vegas 8,174,169 → 6,020,408 bytes. |
| Cockpit draw calls and carbon sampling | One instanced steering-light batch per steering wheel and reuse of carbon normals | `c902bd9` | [Onboard](before/steer-b-centre.jpg) | [Onboard](phase1/cockpit/steer-b-centre.jpg) | [Phase 0 Drive render profile](../perf-check/phase0-revised/drive.json) |
| Serrated tyre stripe, cowling UVs, hinge motion and mirrors | Shader sidewall markings and tread grain, metric UVs, flap and paddle hinges, chassis-relative mirrors, field DRS and wheel-on colour timing | `f1bee7e`, `d488dea` | [Onboard](before/steer-a-left.jpg), [AI field](before/field-1.jpg) | [Onboard](phase1/cockpit/steer-a-left.jpg), [AI field](phase1/visual/field-1.jpg) | [Asset tests](phase1/unit.log). Hero 223,145 triangles after removing the stripe geometry. |
| Pit crew staging and equipment shading | Garage-side approach, visor colour and service-nose shadows | `f1bee7e` | [Entry](before/monza-pits/entry.png), [night repair](before/vegas-pits/wing-repair.png) | [Entry](phase1/monza-pits/entry.png), [night repair](phase1/vegas-pits/wing-repair.png) | [Cross-phase comparison](phase1/comparison.jpg) |
| Signal panels, crowd visibility and circuit alignment | LED orientation, Vegas rules board, crowd LOD and phone flashes, engineer and flag motion, canopy light and tower yaw | `f1bee7e` | [Monza](before/monza-front.jpg), [Vegas](before/las-vegas-strip.jpg) | [Monza](phase1/visual/monza-front.jpg), [Vegas](phase1/visual/las-vegas-strip.jpg) | [Monza clearance](phase1/monza-clearance.txt), [Vegas clearance](phase1/vegas-clearance.log) |
| Repeated traversal on every circuit render | Reuse static world transforms across the main, mirror and shadow passes | `8385fa6` | [Drive profile](../perf-check/before/drive.json) | [Drive profile](../perf-check/phase1-revised/drive.json) | See frame timings below. |

Screenshots show each scene at its captured state. Geometry and shader tests cover details that a single still image cannot establish. Per-case performance figures apply to the cumulative phase.

## Phase 0 MCP iframe results

Each row links the raw renderer profile and reports the change against [the frozen baseline](../perf-check/before). Lower timing, heap, draw-call and triangle counts indicate improvement. Case order is alphabetical.

| Case | Before FPS | After FPS | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ time to 3D ms | Δ heap MiB | Δ calls/frame | Δ triangles/frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [drive-stress](../perf-check/phase0-revised/drive-stress.json) | 43.61 | 43.37 | +1.20 | +0.70 | +0.00 | -109.50 | -0.60 | -16.74 | -34,199.40 |
| [drive](../perf-check/phase0-revised/drive.json) | 60.00 | 60.00 | +0.20 | +0.50 | +0.00 | -43.30 | -1.00 | -17.00 | -35,948.74 |
| [lifecycle](../perf-check/phase0-revised/lifecycle.json) | 59.95 | 59.96 | -0.10 | -0.40 | -0.40 | -15.80 | -0.63 | -7.95 | -15,505.21 |
| [monza-expanded](../perf-check/phase0-revised/monza-expanded.json) | 59.96 | 59.96 | +0.20 | +0.40 | -1.70 | -51.80 | -0.63 | -8.23 | -19,647.57 |
| [monza-inline-stress](../perf-check/phase0-revised/monza-inline-stress.json) | 57.07 | 55.92 | +0.60 | +2.00 | -7.90 | -145.60 | -0.62 | -13.40 | -27,352.81 |
| [monza-inline](../perf-check/phase0-revised/monza-inline.json) | 59.95 | 59.96 | +0.00 | -0.40 | -3.40 | -162.40 | -0.62 | -7.68 | -16,018.41 |
| [vegas-expanded-stress](../perf-check/phase0-revised/vegas-expanded-stress.json) | 51.92 | 53.64 | -1.00 | -0.10 | -1.20 | -129.20 | -0.34 | -4.33 | -28,235.56 |
| [vegas-expanded](../perf-check/phase0-revised/vegas-expanded.json) | 60.00 | 59.99 | -0.30 | -0.80 | -0.90 | -7.40 | -0.31 | -4.97 | -24,883.66 |
| [vegas-inline](../perf-check/phase0-revised/vegas-inline.json) | 60.01 | 60.01 | +0.20 | +0.20 | +3.50 | -33.90 | -0.32 | -5.44 | -20,868.85 |

## Phase 1 MCP iframe results

Each row links the raw renderer profile and reports the change against [the frozen baseline](../perf-check/before). Lower timing, heap, draw-call and triangle counts indicate improvement. Case order is alphabetical.

| Case | Before FPS | After FPS | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ time to 3D ms | Δ heap MiB | Δ calls/frame | Δ triangles/frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [drive-stress](../perf-check/phase1-revised/drive-stress.json) | 43.61 | 44.45 | -0.30 | -0.80 | +0.00 | -244.50 | -3.11 | -25.40 | -126,677.81 |
| [drive](../perf-check/phase1-revised/drive.json) | 60.00 | 60.00 | +0.30 | +0.70 | +0.00 | -64.70 | -3.38 | -25.37 | -126,847.82 |
| [lifecycle](../perf-check/phase1-revised/lifecycle.json) | 59.95 | 60.00 | -0.80 | -1.30 | -3.60 | -40.00 | -3.08 | -11.58 | -17,649.13 |
| [monza-expanded](../perf-check/phase1-revised/monza-expanded.json) | 59.96 | 60.01 | -0.10 | -0.10 | -4.80 | -68.20 | -3.04 | -10.86 | -21,772.09 |
| [monza-inline-stress](../perf-check/phase1-revised/monza-inline-stress.json) | 57.07 | 58.96 | -0.20 | -1.20 | -17.80 | -185.10 | -3.09 | -9.71 | -21,940.27 |
| [monza-inline](../perf-check/phase1-revised/monza-inline.json) | 59.95 | 60.00 | -0.30 | -0.80 | -8.30 | -207.50 | -3.10 | -11.10 | -18,507.44 |
| [vegas-expanded-stress](../perf-check/phase1-revised/vegas-expanded-stress.json) | 51.92 | 54.14 | -1.70 | -2.00 | -8.10 | -275.40 | -2.75 | -6.49 | -20,042.26 |
| [vegas-expanded](../perf-check/phase1-revised/vegas-expanded.json) | 60.00 | 60.00 | -0.10 | -0.60 | -5.00 | -27.70 | -2.76 | -6.31 | -3,777.43 |
| [vegas-inline](../perf-check/phase1-revised/vegas-inline.json) | 60.01 | 60.00 | -0.00 | +0.00 | -2.40 | -80.50 | -2.80 | -7.61 | -4,355.70 |

## Desktop qualification

| Configuration | Monza minimum | Vegas minimum | Gate |
|---|---:|---:|---|
| Original checkout, display-synchronised three-context run | [44.8](before/desktop-monza.log) | [54.9](before/desktop-vegas.log) | Failed |
| Phase 1, display-synchronised three-context run | [47.7](phase1/desktop-monza.log) | [52.3](phase1/desktop-vegas.log) | Failed |
| Phase 1, independent-browser uncapped GPU capacity | [68.0](phase1/capacity-monza.log) | [81.8](phase1/capacity-las-vegas.log) | Passed |

See [the build and asset budgets](phase1/build.log), [unit results](phase1/unit.log), [desktop Playwright](phase1/e2e.log), [MCP Playwright](phase1/mcp-revised.log), and [five-cycle lifecycle resource measurements](../perf-check/phase1-revised/lifecycle.json).

## Phase 2 visual and geometry evidence

Verified local commit `86756e6` on `exp/jev-human-driving`.

| Gap | Change | Render or measurement |
|---|---|---|
| Blank halo transfer and soft front-wing markings | Alpha-tested halo ink writes depth. The nose and front-wing transfers use higher-resolution artwork. | [Halo close-up](phase2/visual/hero-a-halo.jpg), [front wing](phase2/visual/hero-a-front.jpg) |
| Cockpit and wheel detail | Revised telemetry, shift indicators, driver and suspension motion, brake hardware and rotor glow. | [Constructor A](phase2/visual/steer-a-centre.jpg), [constructor B](phase2/visual/steer-b-centre.jpg), [hot rotor](phase2/visual/brake-rotor.jpg) |
| Road contact, braking and impacts | Sparks follow the pavement profile. A controlled braking capture checks that the main camera draws brake dust. Impacts deform individual panels. | [Plank sparks](phase2/visual/bottoming-sparks.jpg), [brake dust](phase2/visual/brake-dust.jpg), [left impact](phase2/visual/impact-left.jpg), [capture state](phase2/visual/shots.json) |
| Field, safety car and wet conditions | Revised field-car surfaces, rain lights, safety-car details and wet-track effects. | [Field flank](phase2/visual/field-left.jpg), [safety car](phase2/visual/safety-car.jpg), [wet Las Vegas](phase2/visual/las-vegas-wet-reflections.jpg) |
| Embedded rendering cost | The iframe shares the livery atlas, uses simpler field and damage shading, and omits small fittings at distance. Field LODs share instance transforms across materials. Shadow and mirror updates are staggered. Under frame pressure, the elevated T-cam uses its telemetry overlay and skips the small physical dashboard behind the helmet. Drive updates individual timing gaps in place. | [Distant field build](phase2/field-build.log), [near field build](phase2/field-near-build.log), [desktop](phase2/visual/hero-b-front.jpg), [MCP](../perf-check/phase2/monza-expanded-broadcast.png) |

## Phase 2 MCP iframe results

Each case used a 22-second sampling window in Chromium 158.0.8127.18 on Apple M4 Pro. The stress cases used device scale factor 2 and fourfold CPU throttling. FPS columns compare the three builds directly. Timing, heap and per-frame rendering deltas use the frozen baseline. Lower values are better in those delta columns. [Baseline profiles](../perf-check/before), [Phase 1 profiles](../perf-check/phase1-revised), [Phase 2 profiles](../perf-check/phase2).

| Case | Before FPS | Phase 1 FPS | Phase 2 FPS | Δ FPS vs before | Δ FPS vs Phase 1 | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ time to 3D ms | Δ heap MiB | Δ calls/frame | Δ triangles/frame |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [monza-inline](../perf-check/phase2/monza-inline.json) | 59.95 | 60.00 | 59.99 | +0.04 | -0.01 | -0.6 | -0.9 | -4.6 | -226.8 | -1.48 | -18.2 | -15,092.5 |
| [monza-expanded](../perf-check/phase2/monza-expanded.json) | 59.96 | 60.01 | 59.96 | 0.00 | -0.05 | -0.1 | -0.1 | -2.1 | -77.5 | -1.41 | -17.8 | -18,267.9 |
| [vegas-inline](../perf-check/phase2/vegas-inline.json) | 60.01 | 60.00 | 60.00 | 0.00 | 0.00 | -0.1 | -0.2 | +2.7 | -75.3 | -1.23 | -18.5 | -4,086.1 |
| [vegas-expanded](../perf-check/phase2/vegas-expanded.json) | 60.00 | 60.00 | 60.00 | +0.01 | 0.00 | -0.1 | -0.7 | +0.8 | -75.8 | -1.25 | -16.7 | -1,902.0 |
| [drive](../perf-check/phase2/drive.json) | 60.00 | 60.00 | 60.00 | 0.00 | 0.00 | -0.1 | +0.3 | 0.0 | -81.7 | -1.96 | -28.6 | -123,201.1 |
| [lifecycle](../perf-check/phase2/lifecycle.json) | 59.95 | 60.00 | 59.95 | 0.00 | -0.05 | -0.8 | -1.1 | -0.9 | -60.3 | -1.48 | -18.5 | -14,770.9 |
| [monza-inline-stress](../perf-check/phase2/monza-inline-stress.json) | 57.07 | 58.96 | 58.92 | +1.85 | -0.05 | -1.8 | -2.3 | -22.3 | -223.2 | -1.60 | -21.7 | -25,375.8 |
| [vegas-expanded-stress](../perf-check/phase2/vegas-expanded-stress.json) | 51.92 | 54.14 | 52.83 | +0.91 | -1.31 | -0.7 | +1.0 | -12.3 | -315.1 | -1.39 | -20.3 | -20,677.3 |
| [drive-stress](../perf-check/phase2/drive-stress.json) | 43.61 | 44.45 | 43.54 | -0.07 | -0.91 | +0.8 | +0.3 | 0.0 | -192.5 | -1.58 | -40.6 | -126,775.7 |

### Change since Phase 1

| Case | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ time to 3D ms | Δ heap MiB | Δ calls/frame | Δ triangles/frame |
|---|---:|---:|---:|---:|---:|---:|---:|
| monza-inline | -0.3 | -0.1 | +3.7 | -19.3 | +1.62 | -7.1 | +3,414.9 |
| monza-expanded | 0.0 | 0.0 | +2.7 | -9.3 | +1.62 | -7.0 | +3,504.2 |
| vegas-inline | -0.1 | -0.2 | +5.1 | +5.2 | +1.57 | -10.9 | +269.6 |
| vegas-expanded | 0.0 | -0.1 | +5.8 | -48.1 | +1.50 | -10.4 | +1,875.5 |
| drive | -0.4 | -0.4 | 0.0 | -17.0 | +1.42 | -3.2 | +3,646.7 |
| lifecycle | 0.0 | +0.2 | +2.7 | -20.3 | +1.61 | -6.9 | +2,878.2 |
| monza-inline-stress | -1.6 | -1.1 | -4.5 | -38.1 | +1.49 | -12.0 | -3,435.6 |
| vegas-expanded-stress | +1.0 | +3.0 | -4.2 | -39.7 | +1.36 | -13.8 | -635.1 |
| drive-stress | +1.1 | +1.1 | 0.0 | +52.0 | +1.53 | -15.2 | -97.9 |

## Phase 2 qualification

| Desktop GPU capacity | Vector mean FPS | Chaos mean FPS | Broadcast mean FPS | Lowest sampled FPS |
|---|---:|---:|---:|---:|
| [Monza](phase2/capacity-monza.log) | 98.0 | 96.4 | 111.5 | 70.5 |
| [Las Vegas](phase2/capacity-las-vegas.log) | 95.4 | 96.6 | 104.1 | 73.9 |

Each circuit used three independent 1100 × 850 Chromium processes with uncapped rendering. All three view means and the lowest sample across 150 smoothed observations per circuit cleared 60 FPS. Playwright suites and GPU benchmarks ran sequentially.

| Gate | Result | Proof |
|---|---|---|
| Production build | Both TypeScript targets, web, MCP and host bundles passed | [Build log](phase2/build.log) |
| Asset budgets | Largest shipped file 7,315,647 bytes (<26,214,400). MCP template 9,649 bytes (≤65,536). High-detail hero 228,714 triangles (≤245,000). | [Budget checks](phase2/build.log) |
| Unit and asset tests | 295/295 | [Vitest](phase2/unit.log) |
| Browser suites | Desktop 44/44 and MCP 13/13, including the five-cycle human and autopilot tests | [Desktop](phase2/e2e.log), [MCP](phase2/mcp.log) |
| Lifecycle | All five suspensions recorded 0 geometries, 0 textures, 0 pending RAFs and 0 RAF callbacks while hidden. Every renderer resumed with a live context. | [Raw lifecycle cycles](../perf-check/phase2/lifecycle.json) |
| Visual capture | Three visible halo transfers, sparks under the plank, 8 brake-dust particles submitted by the main camera, and left-front damage of 0.297 with the other three panels at zero. Both cockpit mirrors and the safety car are visible. | [Halo](phase2/visual/hero-a-halo.jpg), [capture state](phase2/visual/shots.json), [all stills](phase2/visual) |

All nine cases reduced time to first 3D, post-GC heap, mean draw calls and mean triangles relative to the frozen baseline. Monza inline stress gained 1.85 FPS and Las Vegas expanded stress gained 0.91 FPS. The largest remaining camera-cut increase was 2.7 ms in Las Vegas inline. Las Vegas expanded stress p99 was 1.0 ms higher in the full run and 0.8 ms lower in the separate run of the same build. [Full benchmark log](phase2/benchmark-final.log), [focused Las Vegas profile](../perf-check/phase2-drive-validation/vegas-expanded-stress.json).

Drive stress averaged 43.54 FPS in the full run against 43.61 before. The same build reached 46.78 FPS in the focused run. The archived baseline repeat measured 41.97 FPS. The original nine-case result is retained above. [Full Drive profile](../perf-check/phase2/drive-stress.json), [focused Drive profile](../perf-check/phase2-drive-validation/drive-stress.json), [archived control](../perf-check/control-repeat/drive-stress.json).

Across three runs of the final build, Drive stress measured 43.54, 46.78 and 48.25 FPS. The median was **46.78 FPS**. [Third Drive profile](../perf-check/phase2-drive-confirmation/drive-stress.json).

## Phase 3 pit lane and trackside acceptance

Phase 3 uses the Phase 2 checkout at `86756e6` as its implementation base. Both circuits and the service equipment were rebuilt with Blender 5.2.2 LTS. The visual review used the matched 1920 × 1080 cameras.

| Gap | Change | Visual proof |
| --- | --- | --- |
| Rigid crew torsos, overlapping carriers and loose jack grips | Eleven weighted bones, articulated collar, forearm-aligned gloves, staggered carrier foot positions and individual suit sizes. Two complete 20-person rigs can serve any constructor simultaneously. | [Monza crew](phase3/monza-pits/crew.png), [parallel stops](phase3/monza-pits/parallel.png) |
| Indistinct equipment and floating release lamp | Helmet radios, knee pads, controller, backup jack, hooked rear jack, front lifting linkage, damped PBR hoses, torque LEDs and printed spare sidewalls. Two clamps attach the release pod to the fixed boom. | [Repair at Monza](phase3/monza-pits/wing-repair.png), [illuminated crew in Vegas](phase3/vegas-pits/crew.png) |
| Flat pit-stop motion and sparse lane markings | The front jack leads by 60 ms. Both axles settle after the drop. Wheel guns expel air and brake dust, and the departing car lays rubber over its first three metres. Resin mats, yellow targets, hatching, speed boards and exit signals delineate the working lane. | [Monza exit](phase3/monza-pits/exit.png), [Vegas exit](phase3/vegas-pits/exit.png), [Vegas parallel service](phase3/vegas-pits/parallel.png) |
| Generic garages, timing monitors and hospitality | Canopies match their constructor. Epoxy floors, warm glazing and two shared rack batches dress the eleven bays. Pit-wall and garage monitors share four live dashboard views, refreshing within 120 m at 4 Hz on desktop and 2 Hz embedded. The fixed stop clock identifies the driver and corner readiness. | [Monza entry](phase3/monza-pits/entry.png), [Monza timing stand](phase3/monza-pits/timing-stand.png), [idle gantries](phase3/monza-pits/idle-gantries.png) |
| Dark night stops | Two existing bay spotlights use 470 candela and broader cones while a service position is active. | [Vegas repair](phase3/vegas-pits/wing-repair.png), [entry](phase3/vegas-pits/entry.png), [timing stand](phase3/vegas-pits/timing-stand.png), [idle gantries](phase3/vegas-pits/idle-gantries.png) |
| Static crowds, sparse marshals and absent Vegas television | The crowd reacts to the passing cars and the finish in the vertex shader. Monza has 13 marshal posts. Each circuit has 14 instanced 520-triangle photographers. Each handheld flag uses 40 triangles. Officials display race-control flag colours and SC/VSC boards. | [Monza crowd](phase3/visual/monza-grandstand.jpg), [blue flag](phase3/visual/monza-marshal-post.jpg), [Vegas crowd](phase3/visual/las-vegas-grandstand.jpg), [Vegas live screen](phase3/visual/las-vegas-giant-tv.jpg) |
| Wheel wordmark touched the LED recess | Raised the Mercedes wordmark by three source pixels. | [Mercedes cockpit](phase3/visual/steer-b-centre.jpg) |

Both clearance sweeps passed. Monza checked 34,059 woodland instances. Las Vegas checked the racing surface and pit route over 3,115 survey stations. The production build reports a 9,649-byte MCP HTML template, a largest shipped asset of 7,011,618 bytes and 228,714 high-detail hero triangles. The shipped, cluster-indexed circuit archives measure 7,011,618 bytes for Monza and 6,321,000 bytes for Las Vegas.

| Desktop GPU capacity | Driver A mean FPS | Driver B mean FPS | Broadcast mean FPS | Lowest sampled FPS |
| --- | ---: | ---: | ---: | ---: |
| [Monza](phase3/capacity-monza.log) | 102.2 | 99.5 | 111.8 | 75.4 |
| [Las Vegas](phase3/capacity-las-vegas.log) | 100.1 | 102.4 | 110.3 | 74.3 |

The desktop harness ran three independent Chromium processes with uncapped presentation and sampled each view 50 times. The minimum column uses the harness's smoothed FPS sample.

### Phase 3 MCP iframe measurements

The production benchmark used Chromium 158 on an Apple M4 Pro. Each case measured 22 seconds of racing. The three stress profiles additionally used 4× CPU throttling and device scale factor 2. All delta columns after the Phase 2 FPS comparison use the archived before measurement. Lower values are better for timings, heap, draw calls and triangles.

| Case | Before FPS | Phase 2 FPS | Phase 3 FPS | Δ FPS vs before | Δ FPS vs Phase 2 | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ first 3D ms | Δ heap MiB | Δ calls/frame | Δ triangles/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [monza-inline](../perf-check/phase3/monza-inline.json) | 59.95 | 59.99 | 59.96 | +0.01 | -0.03 | -0.7 | -1.4 | -4.1 | -237.7 | -0.61 | -13.7 | -13,351 |
| [monza-expanded](../perf-check/phase3/monza-expanded.json) | 59.96 | 59.96 | 59.95 | 0.00 | -0.01 | -0.4 | -0.6 | -2.6 | -60.0 | -0.56 | -13.8 | -16,696 |
| [vegas-inline](../perf-check/phase3/vegas-inline.json) | 60.01 | 60.00 | 60.01 | 0.00 | 0.00 | -0.3 | -0.4 | +1.8 | -89.9 | -0.41 | -14.2 | -3,329 |
| [vegas-expanded](../perf-check/phase3/vegas-expanded.json) | 60.00 | 60.00 | 59.96 | -0.04 | -0.04 | -0.3 | -0.4 | +0.8 | -56.5 | -0.30 | -11.0 | -795 |
| [drive](../perf-check/phase3/drive.json) | 60.00 | 60.00 | 60.00 | 0.00 | 0.00 | -0.8 | -0.9 | 0.0 | -28.2 | -0.92 | -15.7 | -114,358 |
| [lifecycle](../perf-check/phase3/lifecycle.json) | 59.95 | 59.95 | 60.00 | +0.05 | +0.05 | -1.0 | -1.4 | -2.3 | -44.6 | -0.59 | -13.6 | -14,125 |
| [monza-inline-stress](../perf-check/phase3/monza-inline-stress.json) | 57.07 | 58.92 | 58.71 | +1.63 | -0.21 | -1.2 | -0.9 | -27.0 | -259.3 | -0.77 | -22.4 | -42,169 |
| [vegas-expanded-stress](../perf-check/phase3/vegas-expanded-stress.json) | 51.92 | 52.83 | 56.92 | +5.00 | +4.09 | -2.5 | -2.4 | -23.1 | -397.4 | +0.31 | -24.1 | -51,110 |
| [drive-stress](../perf-check/phase3/drive-stress.json) | 43.61 | 43.54 | 46.83 | +3.22 | +3.29 | -2.1 | -2.3 | 0.0 | -161.1 | -0.64 | -30.8 | -128,360 |

All five suspensions released every geometry and texture, cancelled every pending RAF and delivered zero RAF callbacks while hidden. Each resume created a live WebGL context. [Lifecycle samples](../perf-check/phase3/lifecycle.json).

The production bundle and all 296 unit and asset tests passed. [Build and budget checks](phase3/build.log), [unit results](phase3/unit.log), [Monza clearance](phase3/clearance-monza.log), [Las Vegas clearance](phase3/clearance-las-vegas.log).

The desktop suite passed 44/44, and the MCP suite passed 13/13, including five offscreen cycles for each of autopilot and human driving. [Desktop browser results](phase3/e2e.log), [MCP browser results](phase3/mcp.log).

All nine cases improved p95 and p99 frame time, first 3D presentation, draw calls and submitted triangles against the archived before build. All six display-synchronised cases averaged 59.95–60.01 FPS. In the largest negative mean-FPS difference, Las Vegas expanded measured 59.96 vs 60.00. Its worst camera cut rose by 0.8 ms, and the inline Las Vegas worst cut rose by 1.8 ms. Post-GC heap was 0.31 MiB higher in Las Vegas expanded stress and lower in the other eight cases. [Nine-case log](phase3/benchmark.log).

The three throttled cases gained 1.63, 5.00 and 3.22 FPS over the archived baseline. Their p95 frame times improved by 1.2, 2.5 and 2.1 ms. Against Phase 2 they changed by −0.21, +4.09 and +3.29 FPS respectively. Under sustained frame pressure, the embedded renderer uses framebuffer resolution to select detail for distant cars and scenery. The focus car in close-up and stopped field cars retain their service detail. Hidden rig transforms are deferred until the camera selects the model, including mirror passes. Constructor suit atlases upload one per frame before use.

During tuning, the first full run measured 41.90, 37.13 and 32.24 FPS in the three stress cases. A consecutive rerun of the frozen build measured 54.56, 50.90 and 41.21 FPS. Before the final LOD changes, Phase 3 measured 53.76, 46.27 and 42.95 FPS in a full run. The table above uses one subsequent complete nine-case run of the final build. [First full run](phase3/benchmark-first-complete.log), [frozen build control](phase3/control.log).

### Change since Phase 2

| Case | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ first 3D ms | Δ heap MiB | Δ calls/frame | Δ triangles/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| monza-inline | -0.1 | -0.5 | +0.5 | -10.9 | +0.87 | +4.5 | +1,741 |
| monza-expanded | -0.3 | -0.5 | -0.5 | +17.5 | +0.86 | +4.0 | +1,572 |
| vegas-inline | -0.2 | -0.2 | -0.9 | -14.6 | +0.82 | +4.3 | +758 |
| vegas-expanded | -0.2 | +0.3 | 0.0 | +19.3 | +0.96 | +5.7 | +1,107 |
| drive | -0.7 | -1.2 | 0.0 | +53.5 | +1.03 | +12.9 | +8,843 |
| lifecycle | -0.2 | -0.3 | -1.4 | +15.7 | +0.89 | +5.0 | +646 |
| monza-inline-stress | +0.6 | +1.4 | -4.7 | -36.1 | +0.83 | -0.7 | -16,793 |
| vegas-expanded-stress | -1.8 | -3.4 | -10.8 | -82.3 | +1.69 | -3.8 | -30,433 |
| drive-stress | -2.9 | -2.6 | 0.0 | +31.4 | +0.95 | +9.8 | -1,584 |

### Las Vegas repeat and visual review

A separate repeat of the same production build measured 60.00 FPS inline and 60.00 FPS expanded. Their worst cuts were 0.3 ms and 1.7 ms faster than the archived before run. Expanded stress reached 54.46 FPS, 2.54 FPS above before, and used 0.32 MiB less post-GC heap. The small higher cut times and heap reading in the complete nine-case run reversed in this repeat. [Inline profile](../perf-check/phase3-vegas-validation/vegas-inline.json), [expanded profile](../perf-check/phase3-vegas-validation/vegas-expanded.json), [stress profile](../perf-check/phase3-vegas-validation/vegas-expanded-stress.json).

All 19 requested matched stills were inspected after the final build. Both seven-shot pit reviews show the release equipment and driver display on the boom, the distinct constructor trim and the two teams servicing cars simultaneously. The five trackside and steering views show the grandstands, blue flag, Las Vegas live timing screen and raised Mercedes wordmark. The seven iframe benchmark captures also show the hero cars, circuit, cockpit and pit crew after camera changes. [Trackside capture state](phase3/visual/trackside-shots.json).

## Phase 4 circuit surfaces, lighting and rain

Both venues were rebuilt from the surveyed paths on the Phase 3 base at `91d9efa` with Blender 5.2.2 LTS and Node 24.14.0. The 13 desktop captures use the 1920 × 1080 review fixture with high quality selected. In the race view, `?quality=high` selects the half-resolution bloom pass, 512 × 288 wet reflection and expanded shadow casters. Automatic desktop quality and the MCP iframe use environment reflections. The front, Rettifilo, Strip, Sphere, television and wet Strip views reuse earlier review cameras. The remaining views frame the new work. [Capture settings and frame state](phase4/visual/shots.json)

| Gap | Change | Visual proof |
| --- | --- | --- |
| Uniform asphalt and a sparse grid | Angular aggregate shares its relief with the albedo tile. A second rotated sample breaks up repetition. Rubber collects away from the racing line. All 22 grid boxes follow the same road crown and share their paint, number sheet and yellow stop marks. | [Aggregate and rubber](phase4/visual/monza-aggregate.jpg), [grid and finish band](phase4/visual/monza-gridline.jpg) |
| Hard kerb shoulders and straight gravel furrows | Kerbs have rolling shoulders and rounded raised sections. Behind them sit turf, drainage and a scalloped gravel margin. A curved rake pattern crosses the gravel. | [Kerb and trap](phase4/visual/monza-kerb-edge.jpg), [Rettifilo onboard](phase4/visual/monza-rettifilo.jpg) |
| Uniform woodland and sparse trackside landmarks | Oak, hornbeam, poplar and pine use four cutout maps on the existing canopy LODs. The woodland floor extends around the lap. The banked oval crosses the Serraglio, and recovery vehicles and camera towers sit beside the gravel and spectator stands. | [Foliage](phase4/visual/monza-front.jpg), [Sopraelevata](phase4/visual/monza-banking.jpg), [recovery stand](phase4/visual/monza-recovery-stand.jpg) |
| Repeating Strip panels, window blocks and intersecting lettering | A shared sponsor sheet changes the barrier advertising. Storefront marquees project beyond the piers. Three architectural elevations carry lit windows across the district, with animated LED signs and multi-head lamps along the boulevard. | [Strip at night](phase4/visual/las-vegas-strip.jpg) |
| Flat Plaza roof and unframed television site | Continuous illuminated roof bands identify the pit building. A paved terrace grounds the live television. The Sphere wordmark reaches HDR bloom while its mascot keeps its programmed colours. | [Grand Prix Plaza](phase4/visual/las-vegas-plaza.jpg), [television](phase4/visual/las-vegas-giant-tv.jpg), [Sphere](phase4/visual/las-vegas-finish-sphere.jpg), [colour and tracking test](phase4/sphere-test.log) |
| Blue storm sky, dry paint and coarse wet reflections | Heavy rain uses a storm sky, wet paint and barriers, a central diffuser plume, and instanced red lamp footprints. Desktop high quality renders a 512 × 288 planar reflection and a bloom bright target capped at 960 × 540. The iframe shades the water film with the venue environment. | [Monza storm](phase4/visual/monza-wet-reflections.jpg), [wet Strip](phase4/visual/las-vegas-wet-reflections.jpg) |

Both wet captures recorded a 512-pixel reflection width, a 960-pixel bloom width and an active storm sky. The spray batch submitted 4,263 packets at Monza and 4,449 at Las Vegas. The review checked all 13 exported frames. [Frame measurements](phase4/visual/shots.json)

The circuit authoring run exported 358 Monza chunks and 703 Las Vegas chunks. [Blender build summary](phase4/circuit-build-summary.log)

The Monza sweep checked 34,059 woodland instances. The Las Vegas racing surface and pit route passed at 3,115 survey stations. [Monza clearance](phase4/clearance-monza.log), [Las Vegas clearance](phase4/clearance-vegas.log)

| Asset and GPU gate | Measured result |
| --- | --- |
| MCP HTML | 9,649 bytes of 65,536 |
| Largest shipped asset | Monza MCP circuit, 6,792,908 bytes of 26,214,400 |
| Las Vegas MCP circuit | 5,829,003 bytes |
| High-detail hero | 228,714 triangles of 245,000 |
| Monza desktop | 98.0 / 96.5 / 113.6 mean FPS for driver A, driver B and broadcast. Minimum sampled FPS was 67.9. |
| Las Vegas desktop | 97.0 / 97.9 / 107.9 mean FPS for driver A, driver B and broadcast. Minimum sampled FPS was 73.5. |

The desktop tests used three independent Chromium processes, uncapped presentation and 50 samples per view. Both venues cleared the 60 FPS mean and sampled minimum gates. [Asset budgets](phase4/build.log), [Monza capacity](phase4/capacity-monza.log), [Las Vegas capacity](phase4/capacity-las-vegas.log)

All 296 unit tests, 44 desktop browser tests and 13 MCP tests passed with `JEV_MOCK=1`. The rain scenarios exercised the automatic and high desktop tiers. The MCP suite exercised five full offscreen cycles each for human and autopilot. [Unit suite](phase4/unit.log), [desktop suite](phase4/e2e.log), [MCP suite](phase4/mcp.log)

### Phase 4 iframe performance

On the final production build, 56 of 72 metric comparisons met the frozen `before` measurements. 3 of the nine cases met all eight metrics. The strict zero-regression gate failed. Bold cells identify slower frame rates, longer times or higher resource use. Each row links to its full profile. [Benchmark log](phase4/benchmark.log)

#### Compared with the frozen before run

| Case | FPS | Δ FPS | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ first 3D ms | Δ calls/frame | Δ triangles/frame | Δ heap MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [monza-inline](../perf-check/phase4/monza-inline.json) | 59.9985 | +0.0496 | -0.30 | -1.10 | -19.10 | -281.5 | -10.7 | -17716 | -1.029 |
| [monza-expanded](../perf-check/phase4/monza-expanded.json) | 59.9598 | +0.0030 | +0.00 | -0.10 | -12.10 | -98.3 | -11.2 | -25654 | -1.203 |
| [vegas-inline](../perf-check/phase4/vegas-inline.json) | 59.9986 | **-0.0080** | +0.00 | -0.10 | -12.90 | -120.6 | -32.0 | -30985 | -0.788 |
| [vegas-expanded](../perf-check/phase4/vegas-expanded.json) | 60.0047 | +0.0076 | -0.10 | -0.30 | -14.30 | **+7.4** | -43.0 | -52505 | -1.216 |
| [drive](../perf-check/phase4/drive.json) | 59.9968 | **-0.0041** | **+0.10** | **+0.50** | +0.00 | **+2.7** | -10.2 | -136209 | -0.987 |
| [lifecycle](../perf-check/phase4/lifecycle.json) | 60.0069 | +0.0556 | -0.90 | -1.30 | -16.80 | -36.4 | -10.7 | -17492 | -1.292 |
| [monza-inline-stress](../perf-check/phase4/monza-inline-stress.json) | 52.9303 | **-4.1409** | **+2.30** | **+5.00** | -54.60 | -365.2 | -22.8 | -63448 | -1.574 |
| [vegas-expanded-stress](../perf-check/phase4/vegas-expanded-stress.json) | 49.0535 | **-2.8643** | **+2.30** | **+2.60** | -24.10 | -113.9 | -49.0 | -113040 | -1.342 |
| [drive-stress](../perf-check/phase4/drive-stress.json) | 39.7501 | **-3.8593** | **+4.80** | **+6.30** | +0.00 | **+345.3** | -22.7 | -140569 | -0.619 |

#### Compared with Phase 3

| Case | FPS | Δ FPS | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ first 3D ms | Δ calls/frame | Δ triangles/frame | Δ heap MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [monza-inline](../perf-check/phase4/monza-inline.json) | 59.9985 | +0.0393 | **+0.40** | **+0.30** | -15.00 | -43.8 | **+2.9** | -4364 | -0.420 |
| [monza-expanded](../perf-check/phase4/monza-expanded.json) | 59.9598 | +0.0055 | **+0.40** | **+0.50** | -9.50 | -38.3 | **+2.7** | -8958 | -0.644 |
| [vegas-inline](../perf-check/phase4/vegas-inline.json) | 59.9986 | **-0.0075** | **+0.30** | **+0.30** | -14.70 | -30.7 | -17.8 | -27656 | -0.379 |
| [vegas-expanded](../perf-check/phase4/vegas-expanded.json) | 60.0047 | +0.0447 | **+0.20** | **+0.10** | -15.10 | **+63.9** | -32.1 | -51710 | -0.918 |
| [drive](../perf-check/phase4/drive.json) | 59.9968 | **-0.0030** | **+0.90** | **+1.40** | +0.00 | **+30.9** | **+5.5** | -21851 | -0.063 |
| [lifecycle](../perf-check/phase4/lifecycle.json) | 60.0069 | +0.0082 | **+0.10** | **+0.10** | -14.50 | **+8.2** | **+2.9** | -3367 | -0.703 |
| [monza-inline-stress](../perf-check/phase4/monza-inline-stress.json) | 52.9303 | **-5.7758** | **+3.50** | **+5.90** | -27.60 | -105.9 | -0.4 | -21279 | -0.801 |
| [vegas-expanded-stress](../perf-check/phase4/vegas-expanded-stress.json) | 49.0535 | **-7.8633** | **+4.80** | **+5.00** | -1.00 | **+283.5** | -25.0 | -61930 | -1.648 |
| [drive-stress](../perf-check/phase4/drive-stress.json) | 39.7501 | **-7.0788** | **+6.90** | **+8.60** | +0.00 | **+506.4** | **+8.1** | -12209 | **+0.017** |

All five lifecycle cycles released every tracked geometry and texture, removed the canvas, lost the suspended WebGL context and recorded zero pending or executed animation frames while hidden. Each resumed context rendered again. [Lifecycle measurements](../perf-check/phase4/lifecycle.json)

#### Same-build repeat

The six cases that missed at least one metric were run again from fresh browser contexts. Monza inline stress recovered to 59.25 FPS. Las Vegas expanded stress and Drive stress remained below the archived before run at 50.57 and 38.15 FPS. The primary table retains all nine measurements from the uninterrupted production run. [Repeat log](phase4/benchmark-repeat.log)

| Case | FPS | Δ FPS | Δ p95 ms | Δ p99 ms | Δ worst cut ms | Δ first 3D ms | Δ calls/frame | Δ triangles/frame | Δ heap MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [vegas-inline](../perf-check/phase4-repeat/vegas-inline.json) | 60.0006 | **-0.0060** | **+0.20** | **+0.50** | -3.30 | -29.4 | -32.3 | -31602 | -1.232 |
| [vegas-expanded](../perf-check/phase4-repeat/vegas-expanded.json) | 60.0069 | +0.0098 | -0.10 | -0.20 | -14.90 | -55.2 | -43.1 | -52546 | -0.546 |
| [drive](../perf-check/phase4-repeat/drive.json) | 60.0135 | +0.0126 | **+0.40** | **+0.90** | +0.00 | -77.7 | -10.1 | -136098 | -1.231 |
| [monza-inline-stress](../perf-check/phase4-repeat/monza-inline-stress.json) | 59.2488 | +2.1776 | -1.10 | -1.00 | -54.60 | -381.3 | -23.9 | -58763 | -1.536 |
| [vegas-expanded-stress](../perf-check/phase4-repeat/vegas-expanded-stress.json) | 50.5716 | **-1.3462** | **+1.20** | **+1.10** | -28.70 | -470.0 | -51.2 | -110637 | -1.424 |
| [drive-stress](../perf-check/phase4-repeat/drive-stress.json) | 38.1477 | **-5.4618** | **+5.80** | **+6.40** | +0.00 | **+105.8** | -23.3 | -141710 | -0.444 |

The desktop visuals and seven embedded captures were inspected after the final build. The wet images show the red lamp footprint and diffuser plume. The kerb camera shows the bevel, turf and raked gravel. Gravel spill is represented by a textured, irregular margin. [Desktop captures](phase4/visual), [iframe captures](../perf-check/phase4)

#### Archived-build stress control

The archived production build from `a93a39c` was sampled immediately after the Phase 4 repeat. Its Monza, Vegas and Drive stress results were 44.95, 52.28 and 43.28 FPS. This shows substantial variation at Monza. Vegas and Drive still ran slower on both final-build measurements than on this control. Calls, triangles and post-GC heap fell in every case in the complete Phase 4 run, and its worst camera-cut time was equal or lower in all nine. The remaining acceptance failures are frame pacing and first-3D latency. [Control log](phase4/benchmark-control.log), [control profiles](../perf-check/phase4-control)
