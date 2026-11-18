# Jev Grand Prix realism review

[Open the matched shots](index.html) · [Watch the Rettifilo replay](rettifilo-comparison.mp4)

The starting build was `eaff3f8`. The SF-26 video shows a stationary car in colour, clay, wireframe and cutaway. Its moving camera reveals how highlights travel along the body and how much light the laminate reflects. The circuit, camera and suspension comparisons below use the game’s road geometry and telemetry. [SF-26 reference video](https://x.com/reach_vb/status/2096271854193271229)

| Priority | Issue in the previous build | Change and evidence |
| --- | --- | --- |
| 1 | Runoff ended abruptly, the catch-fence line lacked circuit equipment, and the same advertising repeated along the street circuit. Braking distances read sideways. | Blender-authored tapered aprons, impact modules, protected marshal stations, intermittent advertising, reflectors, storm drains and approach-facing braking boards. [Monza](01-runoff-after.jpg) · [Las Vegas](06-street-after.jpg) · [150 m board](07-board-after.jpg) |
| 2 | Broad highlights flattened the sidepod and carbon. In Las Vegas a lamp illuminated its own housing and bloomed across the skyline. | Longitudinal studio reflections and distinct lacquer and laminate roughness in the game and Blender. Downward-facing floodlights illuminate the road and fade between fixed rows. [Paint](02-paint-after.jpg) · [Native Blender render](11-blender-after.jpg) · [Night straight](08-lights-after.jpg) |
| 3 | The driver and TV cameras shared a periodic vibration. The driver looked straight over the nose at turn-in. | The driver looks into the approaching road curvature with damped movement under braking and lateral load. The TV lens follows the sprung chassis. [Driver’s view](03-driver-after.jpg) · [TV mount](13-tcam-after.jpg) |
| 4 | The nose rose under braking, the hubs followed the body’s pitch and roll, and tyre lettering strobed at speed. | Corrected load transfer, independent hub heights over the modelled kerbs, progressive DRS movement and angular filtering of the moving tyre print. [Braking](04-braking-after.jpg) · [Under power](10-acceleration-after.jpg) · [Sidewall](05-tyre-after.jpg) · [Rear-wing sequence](12-drs-after.jpg) |

## How to read the captures

Each numbered image has a matching before and after. The camera station, framing and supplied car telemetry are fixed within a pair. Some pairs use consecutive intermediate builds to isolate an individual change. The Blender studio pair uses the native render camera. The other pairs use the game renderer. The close crops use the same pixel rectangle on both images.

The film runs at 24 fps. Each view replays the same 110 samples of a 120 Hz simulated approach to Rettifilo, from 797 m to 976 m. Peak deceleration in the sequence is 36.0 m/s². The first half shows the driver’s view and the second shows the chassis from the side.

## Remaining gaps

The elevation data smooths out short pavement bumps. Kerb contact follows the authored profiles and the suspension uses estimated response rates. Trackside people remain static. The SF-26 clip provides no driving footage for a direct comparison of body or camera motion.
