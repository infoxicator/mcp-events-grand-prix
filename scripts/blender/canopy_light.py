"""Bake long-range sunlight occlusion from the authored Monza tree crowns."""
import math
import struct
import zlib
import bpy
import numpy as np
from mathutils.kdtree import KDTree


def bake_canopy_light(directory, samples, height):
    # One texel per metre. The view-independent mask covers the whole course.
    x_min, z_min = -128, -1536
    width, depth = 1536, 2560
    light = np.ones((depth, width), dtype=np.float32)
    path = samples[::4]
    tree = KDTree(len(path))
    for i, p in enumerate(path):
        tree.insert((p['x'], p['z'], 0), i)
    tree.balance()
    for crown in bpy.context.scene.objects:
        if not crown.name.startswith('Instance_Canopy'):
            continue
        x, minus_z, y = crown.location
        z = -minus_z
        _, index, distance = tree.find((x, z, 0))
        if distance > 65:
            continue
        h = max(0, y - height(path[index]['d']))
        # Fixed directional light in scene.ts is (-80, 89, -50).
        cx = x + h * (80 / 89) - x_min
        cz = z + h * (50 / 89) - z_min
        rx, rz = max(2, crown.scale.x*1.45), max(2, crown.scale.y*1.43)
        x0, x1 = max(0, int(cx-rx)-1), min(width, math.ceil(cx+rx)+1)
        z0, z1 = max(0, int(cz-rz)-1), min(depth, math.ceil(cz+rz)+1)
        if x1 <= x0 or z1 <= z0:
            continue
        zz, xx = np.ogrid[z0:z1, x0:x1]
        radius = ((xx-cx)/rx)**2 + ((zz-cz)/rz)**2
        holes = np.sin(xx*.89+np.sin(zz*.51))*np.sin(zz*.61+xx*.13)
        shade = np.clip((1-radius)*1.45+holes*.24, 0, 1)
        region = light[z0:z1,x0:x1]
        np.minimum(region, 1-.68*shade, out=region)
    # Indexed levels compress the unused land while keeping penumbras smooth.
    pixels = np.round(light*47).astype(np.uint8)
    def chunk(key, data):
        return struct.pack('>I',len(data))+key+data+struct.pack('>I',zlib.crc32(key+data)&0xffffffff)
    rows = b''.join(b'\x00'+line.tobytes() for line in pixels)
    palette = bytes(v for i in range(48) for v in [round(i/47*255)]*3)
    encoded = (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,depth,8,3,0,0,0))
               +chunk(b'PLTE',palette)+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b''))
    (directory/'monza-canopy-light.png').write_bytes(encoded)
