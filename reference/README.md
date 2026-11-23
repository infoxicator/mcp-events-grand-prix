# Approved visual reference

Source: https://x.com/reach_vb/status/2096271854193271229
Direct video: https://video.twimg.com/amplify_video/2096271783850827776/vid/avc1/1440x1080/ksn4OydgqipScx_l.mp4

Downloaded locally for the user-requested visual comparison. The tweet endpoint returned HTTP 403; the MP4 worked. Inspected all 20 one-second frames and 4 fps detail ranges 04–07 / 12–14. Step 0 was approved by Ruben. The comparison sheets retain the corresponding video frames. The game ships a reconstructed mesh with selected sponsor and tyre markings traced or rectified from those frames.

Key frames: 01 Colour assembled; 02 Clay; 03 Wireframe; 04.25 wheel; 05.25 steering; 12–13 `Illustrative internal layout`; 14 `117 parts`. Approved corrections: white front/red rear fin; carbon halo/wings; white tyre letters; green/yellow/blue steering rotaries from the driver's left. The clip uses a blank wheel display; race mode adds telemetry and subdued shift lights.

The original Blender generation script is `scripts/blender/build_car.py`. All car geometry comes from its GLB exports. The Three.js runtime only changes materials, poses, LOD and the live display/LED surface.

## Reproducing the VB comparison

The [comparison review](../artifacts/vb-car/review.md) links to the measured passes. The 40 original 2 fps JPEGs and the registered shots, including the three wipe positions, are in [vb-ferrari](vb-ferrari/).

From the project root, rebuild the game, render both 1440 × 1080 sets, and score the original pixels with Pillow and NumPy.

```sh
npm run model:build
npm run build
CAR_MATRIX_DIR="$PWD/artifacts/vb-check/blender" /Applications/Blender.app/Contents/MacOS/Blender -b scripts/blender/jgp26.blend --python-exit-code 1 --python scripts/blender/reference_views.py
CAR_MATRIX_DIR="$PWD/artifacts/vb-check/game" CAR_REVIEW_WIDTH=1440 npx playwright test e2e/reference-review.spec.ts
python3 scripts/measure-vb-frames.py artifacts/vb-check/blender artifacts/vb-check/game
```

The saved native comparisons used Cycles with `CAR_REVIEW_DEVICE=METAL`. The score excludes the video interface. Each result gives the Blender and game errors in that order, including the measured crops and cap-centre displacement on frame 010.
