"""Check for solid scenery in the Las Vegas driving corridor.

From the repository root:
blender -b scripts/blender/las-vegas.blend --python-exit-code 1 -P scripts/blender/check_vegas_clearance.py
"""
import json
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[2]
path = json.loads((ROOT / 'data/las-vegas-render-path.json').read_text())
heights = json.loads((ROOT / 'src/race/assets/circuits/las-vegas-manifest.json').read_text())['heights']
samples = path['samples']


def road_height(station):
    t = station % path['length'] * len(heights) / path['length']
    a, b, c, d = [heights[(int(t) + k) % len(heights)] for k in (-1, 0, 1, 2)]
    u = t % 1
    return .5 * (2*b + (c-a)*u + (2*a-5*b+4*c-d)*u*u + (3*b-a-3*c+d)*u**3)


# Sweep horizontal cross-sections between consecutive two-metre survey samples.
# A thin wall crossing between samples still cuts a face of the sweep.
vertices, faces, locations = [], [], []
near_road = KDTree(2 * len(samples))
for lane in ('track', 'pit'):
    for level in (.16, .55, 1.2, 2.1, 3.7):
        previous = None
        for index, p in enumerate(samples):
            station = p['d']
            if lane == 'pit' and path['pitExit'] < station < path['pitEntry']:
                previous = None
                continue
            offset = p['pit'] if lane == 'pit' else 0
            half = 1.2 if lane == 'pit' else p['width'] - .04
            if level == .16:
                near_road.insert((p['x']-p['tz']*offset, -p['z']-p['tx']*offset, 0), index)
            start = len(vertices)
            for x in (offset-half, offset+half):
                vertices.append((p['x']-p['tz']*x, -p['z']-p['tx']*x, road_height(station)+level))
            if previous is not None:
                faces.append((previous, previous+1, start+1, start))
                locations.append((lane, int(station)))
            previous = start
near_road.balance()
corridor = BVHTree.FromPolygons(vertices, faces)

if not any(obj.type == 'MESH' and 'Sphere' in obj.name for obj in bpy.context.scene.objects):
    raise RuntimeError('Load the Las Vegas circuit before running the clearance check')

offenders = {}
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or obj.name.startswith('LOD_'):
        continue
    matrix = obj.matrix_world
    if obj.name.startswith('Instance_'):
        # The isolated props and people are small. All structural meshes,
        # including long resort walls, are checked across their entire extent.
        p = matrix.translation
        if near_road.find((p.x, p.y, 0))[2] > 16:
            continue
    mesh = obj.data
    tree = BVHTree.FromPolygons([matrix @ v.co for v in mesh.vertices],
                                [tuple(p.vertices) for p in mesh.polygons])
    for face_index, _ in corridor.overlap(tree):
        lane, station = locations[face_index]
        offenders.setdefault((lane, obj.name), set()).add(station)

for (lane, name), stations in sorted(offenders.items()):
    print(f'{lane} intersects {name} between stations {min(stations)} and {max(stations)} m')
if offenders:
    raise RuntimeError(f'{len(offenders)} mesh/lane intersections in Las Vegas')
print(f'Las Vegas racing surface and pit route clear across {len(samples)} survey stations')
