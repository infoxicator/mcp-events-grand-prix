# Jev Grand Prix visual comparison

[Matched stills](index.html) · [22-second side-by-side film](comparison.mp4) · [Suspension trace](ride-response.png)

The left side uses local revision `2b07199`. The right side uses `d4ee62e`. Both builds rendered the same race state, lighting, camera, viewport and presentation times. The film runs at 24 fps. The trackside, surface and tail shots use fixed inspection cameras. The kerb sequence uses the game's side and on-board cameras.

| Shot | Change to look for |
| --- | --- |
| Opening lap and finish | The flag hand, pole and hoist swing together. The free edge follows. The finish marshal uses a separate chequered flag. |
| Grandstand and garage | Spectators shift their upper bodies and turn their heads. Crew members breathe, shift their weight and adjust their tool grip. Boots and seats stay planted. |
| Monza and Las Vegas pavement | Resurfaced sections have sealed edges, a different surface finish and a shallow crown that reaches the wheels. |
| Kerb crossing | The left wheels meet the kerb ribs. The tub rises, rolls and settles as the car returns to the tarmac. |
| Rear close-up | The titanium exhaust has an inner wall and recessed throat. The rain light sits on a carbon impact structure above the diffuser. |

## Ride measurement

Both simulations used Monza at 45 m/s with identical distance, lateral position and loads. The straight runs from station 150 m to 240 m. The kerb crossing starts at station 2537 m, moves from a 4.65 m offset toward the kerb and returns. Samples were taken at 120 Hz. On the straight, chassis travel increased from 0.0 to 3.6 mm peak to peak. Across the kerb the readings were 19.9 and 35.6 mm. The graph plots raw vertical chassis position and the revised left-front contact height.

The SF-26 studio rotation shows the tail assembly at roughly 12–14 seconds. The reference contains no on-track kerb strike or pit-crew movement. Those motions were tuned using the matched driving replay and the suspension trace. The road profiles are authored approximations. [Original reference video](https://x.com/reach_vb/status/2096271854193271229)

## Capture

The adjacent `stage.html` and `capture.mjs` use the game's ordinary scene and assets. To reproduce the shots, serve the stage with the repository's Vite configuration and run `node artifacts/people-and-ride/capture.mjs PORT OUTPUT marshal,finish,crowd,crew,road,rear,ride,driver,marshal:las-vegas,crew:las-vegas,road:las-vegas`. For a historical comparison, use the same two capture files with the earlier source tree.

The remaining gaps are facial and clothing detail in close-up, variation across the stands and coordinated crew movement during pit stops.

## Performance

Three independent Chromium processes on an Apple M4 Pro rendered at 1100 × 850 each. Each circuit had 50 samples per view. These values use the game's smoothed FPS counter, capped at 120.

| Circuit | Vector mean | Chaos mean | Broadcast mean | Lowest sample, any view |
| --- | ---: | ---: | ---: | ---: |
| Monza | 119.3 | 119.9 | 119.7 | 113.3 |
| Las Vegas | 118.9 | 118.6 | 119.3 | 115.0 |
