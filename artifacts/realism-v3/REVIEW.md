# Car review rounds 2 and 3 — 2026-11-16

Reference: approved local SF–26 video. Comparison files use front 00:01, wheel 00:04.25, steering 00:05.25 and rear 00:18. The video contains no driving onboard: the onboard comparison is explicitly previous/current, not evidence of a real onboard match.

## Round 2

Implemented subdivision on the nose/pods/engine cover, an open letterbox intake tunnel, closed cambered aerofoil sections with bevels, distinct suspension joints/clevises/uprights and brake scoops, 96-segment bulged tyre shoulders, Blender-modelled gloves, a 0.69m eye camera, rectangular studio lighting and Cycles CPU AO baking.

Inspection found: (1) ground receiver cube UVs overlapped, producing a white bake; multiply blending also generated WebGL errors and a visible rectangle; (2) paint assigned after subdivision created a saw-tooth white/red boundary; (3) the wheel filled too much of the low camera's road view; (4) the old solid tub concealed the wheel when lowered; (5) high mesh grew to 191k triangles and failed the existing 130k budget. These are recorded failures, not accepted results. The wheel/tyre shoulders are smoother but generic lettering remains much thinner than the video. The intake tunnel improves depth but has an overly rectangular mouth. The rear endplate shape is still simpler than the reference's curved skirt.

## Round 3

Rebaked on a single upward-facing planar receiver; shader converts actual AO to transparent black contact shading with no rectangular edge. Assigned engine-cover paint before subdivision. Opened the cockpit tub and added opaque carbon liners/bulkhead. Repositioned wheel/camera together (0.70m eye height, 68° vertical FOV). Hands follow the steering rig; `?visor` enables a restrained top-edge vignette. Optimized Blender topology to ~111k triangles, retaining a much lighter far LOD. Rear comparison camera raised and moved towards the reference angle. Re-shot all comparison views after fixes.

Remaining differences: body transitions still lack the reference's carefully hand-sculpted compound curvature; the inlet corners and floor-edge foils remain simplified. Suspension is anatomically more legible but not a specific team's measured kinematic linkage. Tyres have rounded/bulged shoulders and micro-bump but no force-dependent carcass deformation. Gloves are segmented sculpted forms, not anatomically realistic skinned hands/arms. Low driver's-eye view necessarily hides most of the front wing behind the nose; T-cam exposes it. The reference has richer reflection gradients, denser typography and a more convincing wheel-cover dish. The baked AO is 1024px/16 samples and the floor 512px; it approximates contact, not full ray-traced GI. No claim of photorealistic parity.

Validation: Blender 5.2.2 LTS, factory startup, CPU Cycles baking. Normal local GPU access avoids the previously diagnosed sandbox Metal startup crash. Build/typechecks, 46 unit tests and the headed GPU camera/studio test pass after corrections. Final regression/performance results are also recorded with Part B.
