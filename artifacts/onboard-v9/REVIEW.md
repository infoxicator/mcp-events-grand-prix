# Gloves and stable helicopter — 2026-11-17

Baseline: local commit `51b88c4`. Scope: glove fit/materials, aerial tracking, regression coverage. Both onboard cameras, helmet, circuits and gameplay are retained.

## Visual iterations

- Before: spherical palms, a separate rounded cuff, large oval reinforcement and thick thumb produced the balloon/Mickey-glove appearance. `before/` preserves the preceding committed captures.
- Round 1: replaced overlapping spheres and voxel smoothing with one tapered, flattened palm/wrist shell; slimmed digits and removed the oval badge. The wrist improved, but the upper glove still read as a pointed mitten. Rejected as the final shape.
- Round 2: narrower palm, exposed proximal knuckles, shorter finger cross-sections and stronger baked contact occlusion. Individual digits read better at steering lock, but the broad back remained too featureless.
- Round 3: flush sewn stretch panels, narrow cuff fastening and reduced pale sheen broke up the backhand, but the enlarged comparison still exposed a pointed upper palm and a protruding finger seam.
- Round 4: shortened the upper shell to expose the curled knuckles and removed that seam. The hard bevel normals looked rigid, so the final export restores smooth textile shading.
- Final: flatter continuous palm/wrist, blunter upper silhouette, slim thumb and curled fingers, flush stretch panels and a narrow cuff fastening. Both teams are captured in driver's-eye and T-cam views, with normal and full ±0.42-rad steering poses. The finger pivots and elbow-to-wrist articulation remain active.

Blender **5.2.2 LTS**, hash `d13f752e3b9c`, ran with `-b --factory-startup`; Cycles CPU baked AO. No crash, reinstall or fallback. Final high LOD: **235,538 triangles**, down from 244,480. All geometry remains Blender-exported GLB.

## Why the helicopter bounced

The previous camera used the instantaneous local tangent as a lever for a 125 m horizontal camera offset, copied its position every frame, switched leader focus without hysteresis, and jumped from 35% rival framing to 0% at a 55 m gap. The underlying track is already interpolated; residual small tangent changes were amplified by the camera offset. This was a camera issue, not a reason to alter steering or physics.

The new rig measures direction across a 110 m road corridor, damps yaw over 0.9 s and lateral offset over 0.18 s using elapsed time, and frames close battles symmetrically. A smooth 35–90 m blend follows the leader as the gap grows. Longitudinal progress follows the existing interpolated telemetry directly, avoiding camera lag at 4×/18× race speeds. Cuts, long frame interruptions and teleports reinitialise the rig. Automatic broadcast helicopter shots use the same implementation.

`aerial-before-after.json` compares old/new math using identical Monza and Vegas straight telemetry, deliberately oscillating lateral offsets and swapping leaders. Peak angular speed falls about **75% at Monza and 71% at Vegas**. Separate headed browser tests stream those updates through mocked WebSockets and record actual rendered camera poses. They require >300 m travel, >100 samples and peak rotation below **0.03 rad/s**; the old camera math peaks at about 0.054/0.066 rad/s. Full-lap unit checks also cover turns, lap wrap, cuts and accelerated travel.

## Remaining limits

The gloves are still an articulated realtime mesh: no pressure-driven skin or cloth deformation, and some digit transitions are simplified in close-up/full-lock poses. The backhand panels and finger transitions remain somewhat angular in magnified views, and fabric is less detailed than real onboard footage. The T-cam framing and visible helmet remain as previously approved; it naturally hides much of the wheel. The aerial deliberately eases into bends instead of matching each instantaneous chassis yaw. Its straight-line measurements are reproducible mock scenarios, not a guarantee for every possible network stall.

Before/after images are unretouched. `after/cars/before-after-gloves.jpg` uses the same crop and scale on both captures. `after/aerial/` holds the recorded motion and frame-by-frame measurements. Full commands/results are in `verify.sh`, `logs/` and the repository `VERIFICATION.md`. No paid calls, push, publish or deployment.
