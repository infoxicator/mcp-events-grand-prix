# Las Vegas: geometry and visual references

Research and inspection: 16 November 2026. The demo deliberately uses the **2025 circuit / DRS format**, consistently with its existing 2025-style cars and Monza race. It does not claim to implement the 2026 sporting regulations.

## Geometry

- [Tomislav Bacinger, `f1-circuits/circuits/us-2023.geojson`](https://github.com/bacinger/f1-circuits/blob/master/circuits/us-2023.geojson), **MIT**, copyright © 2019–2025 Tomislav Bacinger. The original geometry is included as `data/las-vegas.json`; licence in `data/LICENSE-f1-circuits.txt`.
- The unscaled equirectangular projection at the first vertex measures **6,227.823 m**, **0.433%** above the official **6,201 m**. Timing follows the measured centreline, not an artificial scale factor. The local smoothing used for driving preserves its length to within 1%.
- [FIA 2025 Las Vegas circuit map, version 2](https://www.fia.com/system/files/decision-document/2025_las_vegas_grand_prix_-_event_notes_-_circuit_map_v2_pit_lane_drawing_emergency_map_exits_quarantine_zone_and_red_zones.pdf): 17 numbered turns; sector 1 90 m after T5; sector 2 140 m after T12; speed trap 140 m before T14. DRS detection 1 is 10 m after T2 and activation 20 m after T4. Detection 2 is 710 m after T12; activation is 870 m before T14. Corner stations are hand-annotated on the GeoJSON, so the derived locations are approximate. Each activation ends before its braking corner.
- Pit lane, track widths, wall offsets and landmark footprints are approximations. The pit lane uses the existing offset-path model, not a separately surveyed racing surface.

## Photographs actually inspected

These photographs were downloaded to temporary files and visually inspected. They are **reference only**: the photos are not redistributed as textures, bundled assets, or relicensed.

| Reference | Observations used in the original model |
| --- | --- |
| [BBC Sport: Las Vegas Grand Prix night-race photograph](https://www.bbc.com/sport/formula1/articles/cwyg38jn9g3o) ([image](https://c.files.bbci.co.uk/4f6f/live/672b79d0-a5b9-11ef-8860-8b2612f9752e.jpg)) | Sphere looming over T5–T9, sharp white floodlights, concrete walls, mesh catch fencing, narrow red/white kerbs, dark sky and colourful emissive screen. |
| [Road & Track: Sneaking, Spying, and Prying at the Las Vegas Grand Prix](https://www.roadandtrack.com/car-culture/a46190397/las-vegas-grand-prix-too-rich-for-f1s-blood/) ([Getty photograph](https://hips.hearstapps.com/hmg-prod/images/gettyimages-1806155924-6583efa405c92.jpg)) | Bright continuous race corridor, warm hotel façades, Bellagio lake/fountain arcs, Paris lattice tower, High Roller, layered Strip skyline and dark surroundings. |
| [Severud Associates, Sphere structural project](https://www.severud.com/icons/sphere/) | Structural scale: **516 ft / 157.277 m diameter**, **366 ft / 111.557 m above ground**. The model is a sphere clipped at ground level, not a full ball balanced on the road. |

## Original rendered assets

The Sphere shell, animated LED pattern, original “Las Vegas / Jev Grand Prix” screen artwork, city window/parking textures, signage, hotel masses, tower, observation wheel, fountains, fencing, floodlights and spark effect are generated locally by the code in `src/race/vegas-scenery.ts` and `src/race/sparks.ts`. The reference photographs inform the composition and structures; this is not photogrammetry or a licensed architectural digital twin. The existing [CC0 asphalt assets](../src/race/assets/ATTRIBUTION.md) are reused.

Sparks represent brief titanium skid contact under high speed / load and road excitation. They are cosmetic deterministic ballistic streaks, suppressed at low speed and in the pits. There is no full suspension/bottoming simulation. Bloom, local light pools and nearby point lights approximate race floodlighting while keeping the scene practical in three simultaneous browser windows. No model download, proprietary game asset, runtime third-party image request or Blender dependency is required.

Geometry SHA-256: `47712beff7db4d5a5e9bb55e3717d0ff42965983d3e02b76a2bebfcba88442d1`.
