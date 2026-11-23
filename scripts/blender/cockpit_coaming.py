"""Form the rolled cockpit shoulder on the car and its inspection mesh."""

import math
from mathutils import Vector

# Longitudinal station, outward movement and rise in metres, fitted to the
# two visible sides of the cockpit aperture in frame 012.
COAMING_STATIONS = (
    (-.360, 0, 0), (-.290, .0011, 0), (-.150, .0040, .0049),
    (-.055, .0019, .0101), (.025, .0002, .0144), (.100, -.0003, .0137),
    (.190, .0006, .0083), (.290, .0003, .0005), (.312, 0, 0),
)


def formed_coaming(position):
    x, y, z = position
    if not (-.360 < z < .312 and .520 < y < .770):
        return position

    # Match the superellipse cut into the monocoque. The shoulder blends
    # into the deck over 115 mm and into the narrower inner liner over 55 mm.
    width = .286 * max(0., 1. - abs((z + .21) / .523) ** (2 / .81)) ** (.73 / 2)
    across = abs(x) - width
    wrap = max(0., 1. - abs(across) / (.115 if across >= 0 else .055))
    height = min(1., (y - .520) / .095, (.770 - y) / .072)
    weight = 1.12 * wrap * wrap * (3 - 2 * wrap) * height * height * (3 - 2 * height)
    for start, end in zip(COAMING_STATIONS, COAMING_STATIONS[1:]):
        if z <= end[0]:
            fraction = (z - start[0]) / (end[0] - start[0])
            outward = start[1] + (end[1] - start[1]) * fraction
            rise = start[2] + (end[2] - start[2]) * fraction
            return Vector((x + math.copysign(1., x) * weight * outward, y + weight * rise, z))
    return position
