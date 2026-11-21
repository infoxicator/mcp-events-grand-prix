"""Bake linear incident radiance at car height from the authored Strip circuit."""
import bpy
import gzip
import json
import math
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(root/'scripts/blender/las-vegas.blend'))
scene = bpy.context.scene
path = json.loads((root/'data/las-vegas-render-path.json').read_text())['samples']
elevation = json.loads((root/'src/race/assets/circuits/las-vegas-manifest.json').read_text())
def position(station, offset, height):
    sample = path[station//2]
    h = elevation['heights']
    index = station/elevation['step']
    base = h[int(index)%len(h)]*(1-index%1)+h[(int(index)+1)%len(h)]*(index%1)
    return (sample['x']-sample['tz']*offset,-sample['z']-sample['tx']*offset,base+height)

station = 3870
camera = bpy.data.cameras.new('Strip reflection point')
probe = bpy.data.objects.new(camera.name,camera)
scene.collection.objects.link(probe)
probe.location = position(station,0,.82)
probe.rotation_euler = (math.pi/2,0,math.pi)
camera.type = 'PANO'
camera.panorama_type = 'EQUIRECTANGULAR'
camera.clip_end = 3500
scene.camera = probe
# The realtime lamps are punctual sources. Give the corresponding physical
# luminaires enough radiance to resolve in the clearcoat and visor convolution.
for mat in bpy.data.materials:
    shader = mat.node_tree.nodes.get('Principled BSDF') if mat.use_nodes else None
    if shader and mat.name=='Ice':
        shader.inputs['Emission Color'].default_value=(.91,.95,1.,1.)
        shader.inputs['Emission Strength'].default_value=24
for d in range(station-90,station+91,45):
    for side in [-1,1]:
        light=bpy.data.lights.new('Road luminaire','AREA')
        light.shape='RECTANGLE';light.size=2.6;light.size_y=.7;light.energy=1400
        fixture=bpy.data.objects.new(light.name,light);scene.collection.objects.link(fixture)
        fixture.location=position(d,side*7.5,12.45)
world=bpy.data.worlds.new('Dry night sky');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.034,.048,.081,1)
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.max_bounces=3
scene.render.resolution_x=512;scene.render.resolution_y=256;scene.render.resolution_percentage=100
scene.render.film_transparent=False;scene.render.image_settings.file_format='HDR'
scene.view_settings.view_transform='Standard';scene.view_settings.exposure=0
with tempfile.TemporaryDirectory() as tmp:
    output=Path(tmp)/'strip.hdr'
    scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
    (root/'src/race/assets/strip-reflection.hdr.gz').write_bytes(gzip.compress(output.read_bytes(),mtime=0))
