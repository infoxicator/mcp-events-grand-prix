# Circuit review: three rounds

Blender **5.2.2 LTS**, factory startup. Blender ran with normal local GPU access because its Metal initialization previously crashed inside the restricted sandbox. No modelling fallback, reinstall or addon was used. Every static circuit mesh comes from the saved `.blend`/GLB exports. Runtime code loads assets, applies PBR shaders, culls distant detail and animates light artwork; it does not generate replacement circuit geometry.

Before shots were captured before replacing either old renderer. All three rounds contain each circuit's straight chase, signature onboard, aerial, pit/grandstand and labelled photo comparisons. Fixed fixture telemetry keeps positions repeatable; these visual captures are not full-race evidence. The separate race/MCP tests exercise real WebSockets and agents in mock mode.

## Round 1

Monza: the baseline Blender ribbons/buildings exposed terrain triangles crossing the asphalt; garage apron was grass; chase camera cropped the lead car; sparse woodland read as isolated trees; the pit frontage lacked the curved hospitality tower. Kerb/gravel bands were too uniform and closeups showed crude foliage cards.

Vegas: export material suffixes prevented the intended Sphere shader from replacing the flat cyan material. Walls/mesh/trusses were present, but the pit and skyline were generic boxes. Main-straight framing had the same crop. Uncompressed exports were unnecessarily large.

Fixes: lower distant terrain and add a path-following verge, pave pit apron, frame both cars around their midpoint, clear material names between Blender exports, add compound hotel wings, denser layered leaf cards and Draco compression. Original round-one images retain those defects.

## Round 2

Monza: improved road and chase framing; denser trees now overlapped stands and showed horizontal card edges. Long garage modules still looked flat and repeated. Aerial framing showed too little of the corner. Brake boards were blank; no convincing tyre-wall detail.

Vegas: the Sphere was now absent because its GLSL fragment shader lacked a closing brace. A test that only listened to page errors missed the compile error; direct console inspection found it. White garage lighting overwhelmed the simple facade. Sponsor lettering on one wall faced backwards; pit complex lacked its third-floor glazing/roof activity.

Fixes: strict console-error capture, corrected shader, readable fictional Sphere artwork, reverse wall UVs, clear the stand/paddock tree envelope, smaller tilted crown cards, curved Monza hospitality tower, paddock modules, numbered brake boards, cylindrical tyre barriers, pit service markings, third-floor glass and rooftop accents. Aerial camera widened. Decoder workers now terminate after decoding; image tests wait for actual model readiness instead of generic network-idle.

## Round 3

Inspected all four views per circuit against the real photos. A dedicated Sphere close-up caught vertical inversion still present after the first UV correction and an intersecting city block. Corrected the remaining UV axis and excluded background blocks within 140 m of its centre. Also extended Parabolica's outside runoff while removing the inappropriate inside gravel strip, and made elevation/pitch continuous across start/finish. Added near-field static shadows and gravel bump. Re-shot final images after those corrections.

Remaining gaps are substantial: this is a detailed real-time demo, **not photorealistic parity**. Monza's forest remains much less dense and varied than the photograph, tree/crowd cards are visible, the garage facade repeats, and neither historic banking nor the full park/service-road network is rebuilt. Vegas lacks the real Strip's dense street-level signage, road furniture, hotel ornament and thousands of individual light sources; the hotel silhouettes, paddock and Sphere artwork are simplified. Kerb profiles, gravel footprints, barrier offsets and grandstand placement are approximate, not an exact current-year reconstruction. Night sheen uses PBR roughness and local lighting, not ray-traced wet-road reflections. Coarse DEM supports broad elevation only; no surveyed Lesmo/Ascari/Parabolica camber or physical suspension response to elevation is claimed.

The first comparison sheets used whole brochure pages. All final sheets use tighter photo excerpts and clearly label camera mismatch. The historical Monzanet banking photo was rejected as a modern reference. Photo source/rights details: `data/CIRCUITS-V2-SOURCES.md`.

MCP uses the **same Blender geometry** in gzip-compressed uncompressed GLB form. A direct byte parser and data-URI image loader avoid fetch(data:), blob workers and WASM inside the strict host CSP. Browser views use Draco GLBs. This is asset-transport compatibility, not a procedural or lower-quality model fallback.
