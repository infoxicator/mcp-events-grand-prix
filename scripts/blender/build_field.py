"""Bake the editable JGP car into an instanced, exterior-only racing mesh.
Run blender -b scripts/blender/jgp26.blend --python scripts/blender/build_field.py.
The source .blend uses Y up and +Z forward, including the wheel pivots.
"""
import bpy
import gzip
import math
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

assets = Path(__file__).resolve().parents[2] / 'src/race/assets'
near = '--near' in sys.argv
groups = {'Chassis', 'Floor', 'FrontL', 'FrontR', 'RearL', 'RearR', 'Helmet'}
layers = {key: ([], [], []) for key in ('Paint', 'Accent', 'Trim', 'HelmetTint', 'Visor')}
if near:
    for layer in ('Tyre','WheelMetal','BrakeRotor','Carbon','Visor'):
        layers[layer]=([],[],[])
normals={key:[] for key in layers}
omit = {
    'MarkWhite', 'BrandBlue', 'BrandGold', 'CompoundInk', 'GloveStitch',
    # Sealed under-cowling engine, transmission, and removable-fairing internals
    'Ground steel', 'Transmission alloy', 'Machined gear web',
    'Machined intake bell', 'Power unit casting', 'Formed heat shield',
    'PortRecess', 'Turned shaft steel', 'CowlingEdge',
    'CowlingReturn', 'Cowling spring steel', 'Cowl inner laminate',
    # Deep cockpit interior occluded at AI field distances
    'SeatFoam', 'Seat pan laminate', 'Seat edge satin', 'Knee bolster', 'Cockpit liner',
}
groups.update(corner+'Knuckle' for corner in ('FrontL','FrontR','RearL','RearR'))
if near:
    omit.remove('CompoundInk');layers['CompoundInk']=([],[],[]);normals['CompoundInk']=[]
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH' or not obj.parent or obj.parent.name not in groups:
        continue
    if all(m.name in omit for m in obj.data.materials):
        continue
    # Collapse in object space before baking wheel, helmet and wing transforms.
    dec = obj.modifiers.new('Field exterior', 'DECIMATE')
    dec.ratio = .075 if obj.parent.name in {'FrontL','FrontR','RearL','RearR'} else .052
    if near:
        # Keep the nose and tyre profiles smooth at the near-field transition.
        dec.ratio = .25 if obj.name.startswith(('Chassis_Livery','Front','Rear')) else .095
    if obj.parent.name=='Helmet':
        dec.ratio=.54 if near else .25
    geo = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    geo.calc_loop_triangles()
    lookup = {}
    normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
    for tri in geo.loop_triangles:
        mat = geo.materials[tri.material_index]
        if mat.name in omit:
            continue
        if mat.name in {'Livery','DeepLivery'}: layer = 'Paint'
        elif mat.name == 'Ivory': layer = 'Accent'
        elif mat.name == 'HelmetPaint': layer = 'HelmetTint'
        elif mat.name=='HelmetVisor': layer='Visor'
        elif near and mat.name=='CompoundInk': layer='CompoundInk'
        elif near and mat.name=='SlickRubber': layer='Tyre'
        elif near and mat.name=='BrakeDisc': layer='BrakeRotor'
        elif near and mat.name in ('WheelDish','Titanium','OxidisedTitanium'): layer='WheelMetal'
        elif near and mat.name in ('AeroLaminate','Carbon','Visor'): layer='Carbon'
        else: layer = 'Trim'
        vertices, faces, colors = layers[layer]
        face = []
        for loop,index in zip(tri.loops,tri.vertices):
            direction=tuple((normal_matrix @ geo.corner_normals[loop].vector).normalized()) if near else ()
            key = (layer, index, mat.name,tuple(round(n,4) for n in direction))
            if key not in lookup:
                lookup[key] = len(vertices)
                point=obj.matrix_world @ geo.vertices[index].co
                if mat.name=='SlickRubber' and point.y<.060:
                    # Slight load flattening only in the bottom few centimetres.
                    point.y=max(.002,point.y-.004*(1-point.y/.060))
                vertices.append(tuple(point))
                normals[layer].append(direction)
                if not near and mat.name=='SlickRubber': colors.append((.018,.020,.023,1))
                elif mat.name=='WheelDish': colors.append((.016,.020,.023,1))
                elif mat.name=='BrakeDisc': colors.append((.18,.16,.14,1))
                elif layer in ('Trim','WheelMetal'): colors.append(tuple(mat.diffuse_color))
                else: colors.append((1,1,1,1))
            face.append(lookup[key])
        faces.append(face)
if not near:
    # An unbroken bead seat with radially averaged spoke values stays readable
    # at race speed, without spinning subpixel spokes in the far batch.
    vertices,faces,colors=layers['Trim']
    for side in (-1,1):
        for axle in (1.55,-2.05):
            start=len(vertices)
            for radius,depth,shade in [(.054,-.012,.19),(.072,-.015,.071),
                                       (.184,-.008,.047),(.201,-.004,.078),(.219,-.004,.17),(.228,-.008,.045)]:
                for i in range(24):
                    angle=math.tau*i/24
                    vertices.append((side*(.971+depth),.36+radius*math.cos(angle),axle+radius*math.sin(angle)))
                    colors.append((shade,shade*.98,shade*.95,1))
            for row in range(5):
                for i in range(24):
                    a=start+row*24+i;b=start+row*24+(i+1)%24
                    face=(a,a+24,b+24,b)
                    faces.append(face if side>0 else tuple(reversed(face)))
if near:
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from wheel_trim import spoke_faces
    relief,relief_faces,finish=spoke_faces(sectors=32)
    rim_verts,rim_faces,rim_colors=layers['WheelMetal']
    for side in [-1,1]:
        for axle in [1.55,-2.05]:
            start=len(rim_verts)
            rim_verts.extend((side*(.970+x),.36+y,axle+z) for x,y,z in relief)
            for face in relief_faces:
                rim_faces.append(tuple(start+i for i in (face if side>0 else reversed(face))))
            rim_colors.extend(finish);normals['WheelMetal'].extend([(side,0,0)]*len(relief))
    # A soft undertray occlusion patch complements the four tyre contacts.
    vertices=[];faces=[];colors=[]
    for scale,alpha in [(0.05,.30),(.67,.23),(1.,0.)]:
        for i in range(32):
            angle=i*math.tau/32
            vertices.append((.96*scale*math.cos(angle),.008,2.56*scale*math.sin(angle)-.1))
            colors.append((.009,.011,.013,alpha))
    faces.append(tuple(reversed(range(32))))
    for ring in range(2):
        for j in range(32):
            a=ring*32+j;b=ring*32+(j+1)%32;faces.append((a,a+32,b+32,b))
    layers['UndertrayShadow']=(vertices,faces,colors)
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
    if near and name in normals: mesh.normals_split_custom_set_from_vertices(normals[name])
    if name in ('Trim','WheelMetal','UndertrayShadow'):
        color = mesh.color_attributes.new(name='Finish', type='BYTE_COLOR', domain='POINT')
        for vertex, value in zip(color.data, colors): vertex.color = value
    print(name, len(faces), 'triangles')
with TemporaryDirectory() as temp:
    raw = Path(temp)/'field.glb'
    bpy.ops.export_scene.gltf(filepath=str(raw), use_selection=True, export_yup=False,
        export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=True)
    if near:
        sys.path.insert(0,str(Path(__file__).resolve().parent))
        from pack_glb import pack
        pack(raw,assets/'field-near.glb.gz')
    else: (assets/'field.glb.gz').write_bytes(gzip.compress(raw.read_bytes(), compresslevel=9, mtime=0))
