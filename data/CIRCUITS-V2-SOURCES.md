# Circuit scenery and terrain sources

The only selectable circuits remain **Monza** and **Las Vegas**, defined in `src/race/track.ts`. Their existing bacinger/f1-circuits GeoJSON, metre projection, race stationing, DRS zones, pit strategy and physics are preserved. `scripts/export-circuit.ts` exports that same rendered/control centreline at 2 m intervals; no rescaling or hand-drawn replacement.

## Elevation

`*-dem-source.json` records the actual request URL and response from [OpenTopoData's Mapzen API](https://www.opentopodata.org/datasets/mapzen/), sampled at roughly 100 m along the race path. Mapzen terrain is a composite, **not track-level LiDAR or a road survey**. Source and attribution: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) and [Tilezen source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Underlying datasets retain their individual terms. The downloaded samples are retained for reproducibility.

Median filtering and a Gaussian kernel suppress likely canopy/building artefacts; periodic cubic interpolation closes the lap smoothly. Cars, cameras, sparks and the Blender road use the identical profile. This gives broad grades around Lesmo/Ascari/Parabolica and the Vegas streets, **not verified corner camber, bumps or exact gradients**. Elevation currently affects visualization, not the authoritative longitudinal force model. Vegas is relatively flat, not perfectly level: the official [2024 media kit](https://www.fia.com/sites/default/files/2024-officialmediakit_booklet-digital-11.15.24.pdf), page 14, lists nonzero maximum street slopes. These maximum slopes were not imposed on the downloaded profile.

## Photographic comparison references

Downloaded locally under ignored `reference/circuits/`. These photos are reference-only, not bundled textures or game assets. The local review contact sheets show labelled, reduced excerpts alongside our renders; they are not matched-camera photographs or an architectural survey.

- Monza operator's [2025 hospitality brochure](https://www.monzanet.it/wp-content/uploads/2025/03/2025-Experience-HU-brochure-ENG.pdf): grandstand supports, pit frontage, glass hospitality tower, kerb/asphalt detail. Pages 8, 15 and 17, one-based PDF pages. Rights retained by Monzanet/photographers.
- [Prima Monza Parabolica photograph](https://primamonza.it/media/2019/03/21909266_GP-Parabolica.jpg), from its [2019 event report](https://primamonza.it/attualita/per-la-festa-dellautomobilista-lautodromo-punta-a-una-parata-da-record/): sweeping bend, outside gravel, dense park woodland and inside spectator areas. This is an older photograph; it does not establish the current kerb specification.
- [Monza operator's circuit page](https://www.monzanet.it/tracciato-pista-monza/) confirms 5,793 m. Its linked `Monza_parabolica.jpg` is a historical banking photograph: inspected and explicitly **not used as a modern layout reference**.
- [BBC Sphere race-night photo](https://c.files.bbci.co.uk/4f6f/live/672b79d0-a5b9-11ef-8860-8b2612f9752e.jpg): spherical display, floodlit lattice bridge, close concrete walls and mesh fencing. Photographer/rightsholder retains rights.
- [Getty / Road & Track Strip aerial](https://hips.hearstapps.com/hmg-prod/images/gettyimages-1806155924-6583efa405c92.jpg): amber hotel bands, tower lattice, lake/fountains and white track corridor. Reference only.
- [Official Las Vegas 2024 media kit](https://www.fia.com/sites/default/files/2024-officialmediakit_booklet-digital-11.15.24.pdf), page 60: photographed pit complex, three storeys plus roof, covered stands, dense illumination. Its branding is not copied into the models.

All generated texture atlases and Blender circuit models are original. Fictional NEXUS/Jev signage replaces real sponsors. Hotel footprints/landmark positions are approximate geographic anchors, not surveyed architecture. Barrier setbacks, runoff footprints and grandstand positions remain approximations. The pre-existing asphalt/grass/HDRI sources and licences remain in the README; no reference photograph is used as a PBR map.
