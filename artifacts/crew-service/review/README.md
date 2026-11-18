# Jev Grand Prix personnel and pit service

[Film](comparison.mp4) · [Interactive before/after stills](index.html)

The left side of the film uses `06a75ce`. The right side uses `343868f`. Both sides use the same 1920 × 1200 game cameras, lighting setup and simulated inputs. The Las Vegas stop shows the updated garage lights. The film includes the Monza stop at race speed and half speed.

## In the game

Select **Pits** to watch the active box during arrival, service and release. Each team uses its own box. Four gun operators, four outgoing handlers, four incoming handlers and two jack operators work through the same 2.6-second stop that the race simulation measures. The clock, wheel visibility and crew poses also follow a mid-stop reconnect or replay.

The garage close-ups show a projected face texture on a sculpted head, a stitched suit and sponsor patches. The grandstand uses twelve Blender poses and four independently assigned portraits. Each row avoids the four most recent seated or standing poses. More distant views use lower-detail Blender meshes.

## Comparison conditions

The adjacent [capture scene](../stage.html) advances the game's own 120 Hz physics from pit entry through release. Team A starts 13 metres before its mark. Identical times relative to the first stopped tick select the comparison frames. The inspection cameras leave character and vehicle poses under game control.

The SF-26 reference shows material transitions and detail on a studio car. It contains no pit-stop sequence or spectator close-ups. The service timing comes from the game, and the human poses were judged in the gameplay cameras. [Reference video](https://x.com/reach_vb/status/2096271854193271229)

The four portraits and twelve silhouettes can still recur across distant sections. Close-ups retain fixed facial expressions, and the crews repeat a rehearsed clean stop.

## Texture sources

Built-in ImageGen supplied the face projections. Blender supplied the meshes, UVs, materials and equipment. The source texture files are [mechanic-face.jpg](../../../scripts/blender/textures/mechanic-face.jpg) and [spectators.jpg](../../../scripts/blender/textures/spectators.jpg). The [crew atlas builder](../../../scripts/blender/crew_atlas.py) adds the fictional patches, embroidery and surface weave.

<details><summary>Image generation prompts</summary>

> A single square studio face texture source for projecting onto a Blender game character. Perfectly front-facing symmetrical straight-on orthographic portrait of one fictional 35-year-old motorsport mechanic with olive medium tan complexion, brown eyes looking straight into camera, dark eyebrows, short trimmed stubble, no hair falling onto face, neutral closed lips. White-balanced cross-polarized flat albedo lighting, photographic fine pores and warm cheek coloration, no hard shadows or gloss. Tight crop from top of forehead to bottom of chin, both full cheeks and ears visible. No cap, headset, collar, letters, border or other elements. Even tan backdrop.

> Game character albedo texture source, a perfectly aligned 2 by 2 contact sheet of four individual orthographic front-on face portraits in identical square quadrants. Top left: adult woman with warm brown skin, dark eyes and tied back dark hair. Top right: middle-aged light-skinned man with sandy hair and light stubble. Bottom left: young adult East Asian woman with straight dark hair. Bottom right: older Black man with short grey hair and brown eyes. All are original fictional people, varied facial structure, neutral to gently smiling expressions. Each face fills its own entire quadrant, forehead at 12% height, eyes at 43%, nose at 61%, mouth at 77%, chin at 96%. Front projection, zero angle, no head tilts, even shadow-free skin albedo lighting, photographic natural skin and pores. Plain backdrop. No letters, border, frames, gutters, collage effects, clothing or visible shoulders.

</details>


## Verification

The production build passed its 25 MiB asset limit. The 86 unit tests, 15 browser tests, two MCP host tests and two Worker tests passed. The packed host circuit buffers were also restored and compared byte for byte with both Blender exports.

Three independent Chromium processes on an Apple M4 Pro each rendered at 1100 × 850. The table gives the mean of 50 samples per view. The game's smoothed counter caps each frame at 120 FPS.

| Circuit | Vector | Chaos | Broadcast | Lowest sampled FPS |
| --- | ---: | ---: | ---: | ---: |
| Monza | 119.5 | 119.6 | 119.7 | 112.7 |
| Las Vegas | 118.8 | 118.6 | 119.3 | 112.3 |

The active stop was also timed separately in a visible, display-synchronised 1920 × 1200 pit-box view. Over four seconds after warm-up, the previous and revised builds both averaged 60.0 FPS. The recorded film uses 30 original renders per second of simulated time.
