# Realism v7 — review record

Baseline: `feb5baa`. Before PNGs were copied from its verified v6 capture set before editing. No gameplay/provider logic changed. Models are authored/exported in Blender 5.2.2 LTS using factory startup; Cycles CPU bakes the car AO. No procedural Three.js model fallback.

## Pass 1 — rejected details

Inspected all 16 car views and all eight circuit views, plus the Strip capture. Compared front, wheel, steering, rear, Clay and Wireframe against the approved video frames in `reference/`; compared circuit views to the local location photographs. The video has no driving onboard, and the reference/race cameras are not matched.

- The exact elliptical cockpit cut removed the hanging white facets seen in v6. A lower white fringe remained, and the new union/remesh halo roots reflected light in lumpy patches. Replaced those roots with a continuous radius-controlled Blender sweep, removed inner white paint, and kept the clean aperture.
- Sidepod lettering partly disappeared into the relaxed skin. Reprojected it onto the final body and protected conformal decals from mechanical-detail decimation.
- The first leaf sprays fixed solid crown silhouettes but made distant trees too sparse, especially in the aerial. Increased leaf coverage and changed the far prototype from 40 to 64 triangles (near remains 96). Both are open bent branchlet fans with leaf cutouts, not camera-facing billboards or closed crown shells.
- Glove cuffs, seams, reinforcement patches and finger-following seams are visible; the broad fingers still look stylised. Added a dedicated fine knit bump instead of reusing carbon twill. Wheel controls gain paddle/linkage hardware, index ticks and a readable white R on the blue button.
- Vegas façade variation and light streaks improve, but the city still has too much dark empty space and simple foreground structures compared with the Strip photo. Added a full-viewport landmark capture for a clearer comparison. The reference photograph is substantially denser and richer in small street-level detail.
- Studio floor remained too grey/light. Reduced and cooled its base reflectance while retaining the reflected area lights and Blender-baked contact AO.

## Proportion audit

The approved video remains the visual authority; no real sponsor marks are copied. Actual exported GLB bounds are audited with `scripts/measure-car.py` (see measurements.json). The approximately 5.627 m length, 2.000 m width and 3.600 m wheelbase remain. The 1.171 m maximum includes the T-camera; it is not a claim of a 0.95 m overall vehicle. Airbox/sidepod mouth dimensions retain the v6 measured approximation. A perspective video cannot establish survey-accurate metric proportions.

## Pass 2 — close-up correction

The clean tapered halo sweep removes the waxy/lumpy root highlights, and the NOVA lettering no longer clips. New full-viewport Strip and denser far foliage captures were inspected. The steering close-up still exposed a white underside strip below the carbon cut edge. The material boundary was extended over that hidden deck underside; this is a defect correction, not a camera change. Vegas aerials also exposed insufficient static road illumination away from the four nearby runtime lamps, so the existing floodlight-pool approximation was strengthened across the entire road. It remains an approximation, not a baked global-illumination solution.

The first complete verification sequence was stopped after the visual review found this residual edge. Its completed results are preserved as `logs/pass-2-*.log`; the final sequence is run again on the corrected export.

## Pass 3 — rejected paint mask

The underside paint extension removed the central white fringe but produced triangular black patches on the outer deck and did not cover the entire side fringe. Rejected that positional material mask. The correction uses a continuous rolled carbon liner with a seven-section cross-section, rising to meet the full aperture, so it physically covers the underside uniformly. The white outer deck keeps its original paint region. The pass-3 screenshots are retained rather than presented as the final result.

## Pass 4 — accepted geometry for final verification

The steering and halo close-ups now show one continuous rounded carbon rim, with no hanging white underside strip and no triangular paint patches. The halo feet taper smoothly into the deck instead of ending in separate bulbous caps. The white outer skin still shows small surface ripples near the airbox/sidepod join at this extreme magnification; it is not reference-level surfacing everywhere.

This pass re-shot all car views. Its circuit images are explicitly carried forward from pass 3, since no circuit asset, lighting or camera changed after those captures. Final `after/` images are all freshly captured by the complete verification run.

## Final visual assessment against the reference

| View | Improvement / remaining difference |
| --- | --- |
| Front beauty / Colour | Clean cockpit outline, readable fictional marks, satin highlights. Our nose/sidepod surfaces remain simpler; front-wing elements are more strongly scalloped than the video's. The studio floor is still greyer and less convincingly blurred. |
| Halo macro | Continuous swept feet and rolled coaming replace caps and ragged white edges. The extreme close-up still reveals body-skin ripples near the airbox/sidepod paint transition and some low-resolution highlight structure. |
| Steering macro | Black screen, coloured knurled rotaries, contrasting buttons, collars and paddle hardware. Controls remain chunkier than the video, carbon weave is too subdued, and the lower cockpit lacks the reference's detailed textile/carbon treatment. |
| Airbox / sidepod macros | Real open ducts remain intact. Mouth proportions retain the prior measured approximation; fillets/shoulders are less sculpturally refined than the video. |
| Wheel macro | Matte rubber, rounded shoulder, recessed dish, metal/red/yellow centre and generic white marks. The reference has richer rim reflections and finer sidewall/lettering detail. |
| Rear three-quarter | DRS/beam wing, suspension and diffuser remain visible. Our rear assembly and exhaust are less intricate; endplate curvature and surrounding surfaces differ from the video. |
| Side profile | Exported length, width and wheelbase remain consistent. This is a proportional interpretation; the video supplies no orthographic or metric reference. |
| Clay / Wireframe | Curvature and LOD topology are inspectable, but the triangulated union mesh is less orderly than the reference's visible topology. Clay contact shading remains approximate. |
| Onboard / left-lock / right-lock | Clean rim, readable live dash, central pillar/mirrors, seams/cuffs/reinforcement and finger-dependent articulation. Fingers still resemble smooth sculpted tubes at close range; no cloth/contact simulation. The source clip contains no driving onboard. |
| T-cam / chase | Readable race silhouette and retained camera/telemetry behaviour. Racing-distance detail is intentionally reduced by LOD. |
| Monza straight / pits | Preserved pit/grandstand/catch-fence context; improved open woodland silhouette behind it. Buildings and seated spectators remain repetitive compared with the real photos. |
| Monza signature onboard / aerial | Sky is visible through branchlet layers, with a denser distant canopy than pass 1 and trunks seated on terrain. Tree crowns remain too regular, leaves too coarse nearby, and the park's undergrowth/ground cover too sparse. |
| Vegas straight / pits | Wet-looking light streaks and warmer varied façade response. Strongest specular pools still come from nearby lamps; wall reflections lack spatially correct depth. |
| Vegas Sphere onboard / aerial | Existing Sphere, fence, lamps and circuit geometry retained. Surroundings remain too empty and clean versus the real location; the distant city is still dominated by atlas windows. |
| Vegas Strip landmarks | Curved resort, domes, campanile, stepped/curved towers, lattice tower and observation wheel distinguish silhouettes. The real Strip has much denser podiums, street furniture, layered signage and more continuous warm illumination. Fountain arcs are geometry, not water spray simulation. |

The studio environment is an authored softbox PMREM rig, not the unknown environment map used by the reference. Ground contact uses an actual Blender CPU AO bake; floor reflection is a blurred planar pass. Vegas reflections use the existing 64 px local cube probe and periodic refresh, with stronger PBR response and an approximate static road-light contribution. No ray-traced reflection or city-wide GI claim is made.

All final screenshots are inspected in full-camera contact sheets, with individual full-resolution checks for steering, halo roots, front, tyre, onboard, Monza foliage and Vegas landmarks. Reference pairs retain original video/photo images; only fictional graphics appear on game assets. This round is a visible improvement, not a claim of reference-level photorealism.

## Verification and performance outcome

Final full mock sequence passed: build/typecheck, 56 unit tests, 9 headed e2e, 2 MCP and 2 local Worker tests, handling, Worker dry-run, demo smoke and existing server HTTP 200. All paid-call counters are zero. Blender 5.2.2 LTS completed without a crash or workaround; no geometry fallback.

Three-window mean FPS (Vector / Chaos / Broadcast): Monza **84.07 / 84.55 / 85.66**, Vegas **91.64 / 91.50 / 91.39**. Minimum sampled smoothed FPS: Monza **67.21 / 67.96 / 69.46**, Vegas **75.93 / 76.00 / 77.66**. All exceed 60, but performance is lower than v6. Open foliage alpha coverage and the additional lighting have a cost; the 110 FPS stretch target is unmet. These are 50 HUD EMA samples per window, not a per-frame guarantee. See `performance-summary.json` and raw samples.
