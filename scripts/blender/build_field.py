"""Bake the editable JGP car into an instanced, exterior-only racing mesh.
Run blender -b scripts/blender/jgp26.blend --python scripts/blender/build_field.py.
The source .blend uses Y up and +Z forward, including the wheel pivots.
"""
import bpy
import gzip
from pathlib import Path
from tempfile import TemporaryDirectory

assets = Path(__file__).resolve().parents[2] / 'src/race/assets'
groups = {'Chassis', 'Floor', 'FrontL', 'FrontR', 'RearL', 'RearR', 'DRS', 'Helmet'}
layers = {key: ([], [], []) for key in ('Paint', 'Accent', 'Trim', 'HelmetTint')}
omit = {'MarkWhite', 'BrandBlue', 'BrandGold', 'CompoundInk', 'GloveStitch'}
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH' or not obj.parent or obj.parent.name not in groups:
        continue
    if all(m.name in omit for m in obj.data.materials):
        continue
    # Collapse in object space before baking wheel, helmet and wing transforms.
    dec = obj.modifiers.new('Field exterior', 'DECIMATE')
    dec.ratio = .075 if obj.parent.name in {'FrontL','FrontR','RearL','RearR'} else .052
    geo = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    geo.calc_loop_triangles()
    lookup = {}
    for tri in geo.loop_triangles:
        mat = geo.materials[tri.material_index]
        if mat.name in omit:
            continue
        if mat.name in {'Livery','DeepLivery'}: layer = 'Paint'
        elif mat.name == 'Ivory': layer = 'Accent'
        elif mat.name == 'HelmetPaint': layer = 'HelmetTint'
        else: layer = 'Trim'
        vertices, faces, colors = layers[layer]
        face = []
        for index in tri.vertices:
            key = (layer, index, mat.name)
            if key not in lookup:
                lookup[key] = len(vertices)
                vertices.append(tuple(obj.matrix_world @ geo.vertices[index].co))
                colors.append(tuple(mat.diffuse_color) if layer == 'Trim' else (1,1,1,1))
            face.append(lookup[key])
        faces.append(face)
bpy.ops.object.select_all(action='DESELECT')
for name, (vertices, faces, colors) in layers.items():
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.select_set(True)
    for poly in mesh.polygons:
        poly.use_smooth = True
    if name == 'Trim':
        color = mesh.color_attributes.new(name='Finish', type='BYTE_COLOR', domain='POINT')
        for vertex, value in zip(color.data, colors): vertex.color = value
    print(name, len(faces), 'triangles')
with TemporaryDirectory() as temp:
    raw = Path(temp)/'field.glb'
    bpy.ops.export_scene.gltf(filepath=str(raw), use_selection=True, export_yup=False,
        export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=True)
    (assets/'field.glb.gz').write_bytes(gzip.compress(raw.read_bytes(), compresslevel=9, mtime=0))
