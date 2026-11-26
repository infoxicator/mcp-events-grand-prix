"""Validate the authored woodland against both sides of every Monza barrier."""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


def barrier_distance(data, station):
    length = data['length']
    edge = 16.
    for corner in data['corners']:
        delta = abs((station - corner['d'] + length / 2) % length - length / 2)
        radius = 275 if corner['name'] == 'Parabolica' else 144
        edge = max(edge, 24 + 8 * math.cos(math.pi * min(1, delta / radius)))
    finish = abs((station + 155 + length / 2) % length - length / 2)
    return max(edge, 16 + 15 * (1 - min(1, max(0, (finish - 255) / 100))))


def check(data):
    path = data['samples']
    tree = KDTree(len(path))
    limits = [barrier_distance(data, point['d']) for point in path]
    for index, point in enumerate(path):
        tree.insert((point['x'], -point['z'], 0), index)
    tree.balance()
    maximum = max(limits)
    checked = 0
    for obj in bpy.context.scene.objects:
        if not obj.name.startswith(('Instance_Trunk', 'Instance_Canopy')):
            continue
        checked += 1
        world = obj.matrix_world
        centre = world.translation
        radius = max(math.hypot(p.x-centre.x, p.y-centre.y)
                     for p in (world @ Vector(corner) for corner in obj.bound_box))
        for _, index, distance in tree.find_range((centre.x, centre.y, 0), maximum + radius + 1):
            if distance < limits[index] + radius + 1:
                raise ValueError(f"{obj.name} enters barrier clearance at {path[index]['d']} m")
    if not checked:
        raise ValueError('Expected a populated Monza woodland')
    print(f'Monza clearance passed for {checked} trunk, branch and canopy instances')


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    check(json.loads((root / 'data/monza-render-path.json').read_text()))
