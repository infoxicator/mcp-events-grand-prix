"""Render the inspection angles for the SF-26 video, using the saved studio."""
from pathlib import Path
from math import radians, hypot, copysign
import sys
import os
import gzip
import json
import bmesh
from contextlib import contextmanager
import bpy
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

scene = bpy.context.scene
camera = scene.camera
out = Path(bpy.path.abspath('//../../artifacts/vb-car'))
scene.render.resolution_x = 1440
scene.render.resolution_y = 1080
scene.render.resolution_percentage = int(os.environ.get("CAR_REVIEW_SCALE",100))
scene.cycles.samples = 24 if scene.render.resolution_percentage==100 else 12
device_type=os.environ.get('CAR_REVIEW_DEVICE')
if device_type:
    preferences=bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type=device_type
    preferences.refresh_devices()
    devices=[d for d in preferences.devices if d.type==device_type]
    if not devices:raise RuntimeError(f'No Cycles {device_type} device')
    for d in preferences.devices:d.use=d.type==device_type
    scene.cycles.device='GPU'
for name in ('Helmet', 'SuitBody', 'Hands', 'UpperArmL', 'UpperArmR', 'ForearmL', 'ForearmR'):
    for part in bpy.data.objects[name].children_recursive:
        part.hide_render = True
floor = bpy.data.materials['Studio graphite'].node_tree.nodes.get('Principled BSDF')
floor.inputs['Base Color'].default_value = (.005,.008,.011,1)
floor.inputs['Roughness'].default_value = .17
floor.inputs['Specular IOR Level'].default_value = .34
floor.inputs['Emission Color'].default_value = (.007,.010,.013,1)
floor.inputs['Emission Strength'].default_value = .8
for light in bpy.data.lights:
    light.energy *= .52
    light.specular_factor *= .24
for obj in scene.objects:
    if obj.type=='LIGHT':obj.visible_glossy=False

# The floor laminate has a broad satin reflection in the inspection studio.
floor_mesh=bpy.data.objects['Floor_Carbon']
floor_laminate=floor_mesh.data.materials[0].copy()
floor_mesh.data.materials[0]=floor_laminate
laminate=floor_laminate.node_tree.nodes.get('Principled BSDF')
laminate.inputs['Base Color'].default_value=(.021,.023,.024,1)
laminate.inputs['Roughness'].default_value=.53

selected_views = set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()

matrix_dir=os.environ.get('CAR_MATRIX_DIR')
review_views=json.loads((Path(__file__).resolve().parents[2]/'src/race/assets/review-views.json').read_text())
service_fit=json.loads(Path(__file__).with_name('service-fit.json').read_text())
release_fit=json.loads(Path(__file__).with_name('breakdown-fit.json').read_text())
exploded_fit=json.loads(Path(__file__).with_name('exploded-fit.json').read_text())
finish='colour'
if matrix_dir:
    out=Path(matrix_dir)
    out.mkdir(parents=True,exist_ok=True)
registered_cameras=json.loads((Path(__file__).resolve().parents[2]/'src/race/assets/reference-cameras.json').read_text())
@contextmanager
def loaded_studio_tyres(assembled):
    # Match SuspensionRig's neutral 7 mm tyre deflection at rest. Work in wheel
    # coordinates so posed/exploded geometry and the exported source stay clean.
    changed={}
    hubs={}
    def smooth(lo,hi,v):
        t=min(1.,max(0.,(v-lo)/(hi-lo)))
        return t*t*(3.-2.*t)
    try:
        if assembled:
            for name in ('FrontL','FrontR','RearL','RearR'):
                hub=bpy.data.objects[name]
                hubs[hub]=hub.location.y
                hub.location.y-=.007
                for obj in hub.children:
                    if not obj.name.endswith(('_Rubber','_SlickRubber')):continue
                    original=obj.data
                    changed[obj]=original
                    obj.data=original.copy()
                    for vertex in obj.data.vertices:
                        x,y,z=vertex.co
                        if y>=-.28:continue
                        weight=(1.-smooth(-.36,-.28,y))*smooth(.23,.32,hypot(y,z))
                        vertex.co=(x+(copysign(.0028*weight,x) if x else 0.),max(y,-.353),z)
                    obj.data.update()
        yield
    finally:
        for obj,data in changed.items():
            loaded=obj.data
            obj.data=data
            bpy.data.meshes.remove(loaded)
        for hub,y in hubs.items():hub.location.y=y

def render(name, direction=None, target=None, width=None):
    if selected_views and name not in selected_views:
        return
    shot=registered_cameras.get(name)
    if shot:
        direction,target,width=shot['direction'],shot['target'],shot['width']
    back = Vector(direction).normalized()
    right = Vector((0,1,0)).cross(back).normalized()
    camera.rotation_euler = Matrix((right,back.cross(right),back)).transposed().to_euler()
    distance = 11
    camera.data.shift_x = 0
    camera.data.shift_y = 0
    if shot:
        distance=shot['distance']
        camera.data.shift_x,camera.data.shift_y=shot['shift']
        camera.rotation_euler.rotate_axis('Z',radians(shot['roll']))
    elif name == 'rear-wing':
        camera.data.shift_x = -.037
        camera.data.shift_y = .037
    camera.data.clip_start = shot.get('near',.007) if shot else .007
    camera.location = Vector(target) + back * distance
    camera.data.type = 'PERSP'
    camera.data.lens = distance * camera.data.sensor_width / width
    view = 'hero' if name in ('colour','clay','wireframe') else name
    filename=f'{view}-{finish}' if matrix_dir else name
    scene.render.filepath = str(out / (filename + '.png'))
    with loaded_studio_tyres(not review_views.get(view,{}).get('pose')):
        bpy.ops.render.render(write_still=True)

def fitted_motion(fit,progress=1.):
    shift=Vector(fit['shift'] if isinstance(fit,dict) else fit)*progress
    if not isinstance(fit,dict) or 'angles' not in fit:
        return Matrix.Translation(shift)
    rx,ry,rz=(radians(angle)*progress for angle in fit['angles'])
    about=Vector(fit['centre'])
    turn=Matrix.Rotation(rz,4,'Z')@Matrix.Rotation(ry,4,'Y')@Matrix.Rotation(rx,4,'X')
    return Matrix.Translation(about+shift)@turn@Matrix.Translation(-about)

# Recover the islands within the game draw-call batches so each tyre,
# suspension link and aerofoil can travel along its own assembly axis.
def explode(drs_angle, service=False, reassembly=False, wire_breakdown=False, binding=None, shell_only=False, progress=1., intro=0.):
    skin = bpy.data.objects['Chassis_TwoToneCover']
    panel_points = None
    # Correct each rigid rear blade about its own centre in the frame-020 breakdown.
    # The recorded angles fit its projected outline at 720 pixels, ordered XYZ.
    blade_poses={
        'drs':((0.02546, 1.86327, -3.29296),(70.1337, -2.5266, -20.2235),(-0.05931, -0.06009, 0.02513)),
        'rear-main':((0.00696, 1.57273, -2.9763),(-0.4227, 11.4868, -5.5407),(0.01366, -0.00922, 0.08816)),
        'near-fence':((-1.11004, 0.87048, -2.77613),(-98.433, 5.4227, 12.9076),(0.28635, 0.31759, -0.23332)),
        'far-fence':((1.11, 0.87048, -2.77613),(-16.006, -1.1146, -16.7103),(0.07235, 0.09799, -0.13127)),
    }
    # In frame 018 the side rails carry the rearward section of the floor.
    # The later diffuser inspection releases its vanes further forward.
    floor_joint=-1.93 if intro>.2 else -1.55
    panel_offsets = []
    panel_rotations = []
    panel_release = []
    pod_transforms = {}
    skin_transforms = []
    pose_fit=release_fit if intro>.2 else exploded_fit if wire_breakdown and not intro else {}
    # Rigid fits to the upper and lower cowl outlines in frame 025.
    # Angles about chassis X/Y/Z, followed by vertical and longitudinal travel.
    # Use the same scarf joint for the physical cut and ownership of its faces.
    cowl_height,cowl_bank,cowl_rake=.632,.17,.031
    def shoulder_height(x,z):
        return cowl_height+cowl_bank*(abs(x)-.60)-cowl_rake*z
    service_cowls={-1:(-2.0755, 21.8541, 70.5, 0.595, -0.55),1:(-5.6417, -13.0895, 25.0, 0.301, -0.4737)}
    for obj in [skin, *(o for o in scene.objects if o!=skin)]:
        if shell_only and obj!=skin:continue
        if obj.type != 'MESH' or obj.name == 'Graphite floor' or obj.hide_render:
            continue
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        source_faces=binding.original(obj,mesh) if binding else None
        matrix = obj.matrix_world
        local=matrix.inverted()
        inverse=local.to_3x3()
        # The running car uses a continuous watertight paint surface. Cut a
        # temporary inspection copy along its nose joint and pod shoulders.
        cowl_print=service and obj.name.startswith(('NumberA_','NumberB_','ConformalDecals_'))
        if obj==skin or obj.name.startswith('Floor_') or cowl_print:
            cuts = [(2,.58),(0,-.40),(0,.40),(2,-.69),(1,.72),(0,0)] if obj.name == 'Chassis_TwoToneCover' else [(2,floor_joint),(0,-.30),(0,.30)]
            if cowl_print:cuts=[]
            if service:
                if obj==skin or cowl_print:cuts.extend(((1,.59),(1,.728),(2,-1.11)))
                else:cuts.append((0,0))
            for axis,station in cuts:
                normal = Vector((0,0,0))
                normal[axis] = 1
                point = normal * station
                elements=list(mesh.verts)+list(mesh.edges)+list(mesh.faces)
                if obj.name.startswith('Floor') and axis==0:
                    # In the service shot each diffuser half slides independently.
                    # The other cuts release the forward side rails.
                    def forward(element):
                        verts=[element] if isinstance(element,bmesh.types.BMVert) else element.verts
                        return (all((matrix@v.co).z<=(floor_joint+.00002) for v in verts) if station==0 else
                                all((matrix@v.co).z>=(floor_joint-.00002) for v in verts))
                    elements=[element for element in elements if forward(element)]
                elif axis==2 and station==-1.11:
                    # The lacquered rear panel ends at the forward tip of its rolled flange.
                    def on_cowl(element):
                        verts=[element] if isinstance(element,bmesh.types.BMVert) else element.verts
                        return all(abs((matrix@v.co).x)<.40002 and .58998<=(matrix@v.co).y<=.72802+.045*((matrix@v.co).z+2.19) for v in verts)
                    elements=[e for e in elements if on_cowl(e)]
                elif obj==skin and axis==2 and station==-.69:
                    def on_spine(element):
                        verts=[element] if isinstance(element,bmesh.types.BMVert) else element.verts
                        return all(abs((matrix@v.co).x)<.40002 for v in verts)
                    elements=[element for element in elements if on_spine(element)]
                elif obj==skin and axis==0 and station==0:
                    def on_cowling(element):
                        verts=[element] if isinstance(element,bmesh.types.BMVert) else element.verts
                        return all((matrix@v.co).y>=.71998 or (matrix@v.co).z<=-.68998 for v in verts)
                    elements=[element for element in elements if on_cowling(element)]
                if service and axis==1 and station in (.59,.728):
                    def on_engine_cover(element):
                        verts=[element] if isinstance(element,bmesh.types.BMVert) else element.verts
                        return all(abs((matrix@v.co).x)<.40002 and (matrix@v.co).z<-.49998 for v in verts)
                    elements=[element for element in elements if on_engine_cover(element)]
                    if station==.728:
                        # The fin seam rises forward from the rear tip; race
                        # numbers are entirely on the removable central fin.
                        point=Vector((0,.728,-2.19))
                        normal=Vector((0,1,-.045))
                result = bmesh.ops.bisect_plane(mesh,
                    geom=elements,
                    plane_co=local @ point,
                    plane_no=matrix.to_3x3().transposed() @ normal,dist=.00001)
                edges = [e for e in result['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
                bmesh.ops.split_edges(mesh,edges=edges)
        if obj==skin:
            # The ivory shoulder stays with the upper cowling as the red
            # radiator fairing moves out in frames 001, 020 and 035.
            for side in (-1,1):
                elements=[]
                for element in [*mesh.verts,*mesh.edges,*mesh.faces]:
                    verts=[element] if isinstance(element,bmesh.types.BMVert) else element.verts
                    if all(side*(matrix@v.co).x>.39998 for v in verts):elements.append(element)
                cut=bmesh.ops.bisect_plane(mesh,geom=elements,dist=.00001,
                      plane_co=local@Vector((side*.60,cowl_height,0)),
                      plane_no=matrix.to_3x3().transposed()@Vector((-side*cowl_bank,1,cowl_rake)))
                bmesh.ops.split_edges(mesh,edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)])
        weights = mesh.verts.layers.deform.active
        roles = {g.index:g.name.removeprefix('Inspection ') for g in obj.vertex_groups if g.name.startswith('Inspection ')}
        if obj==skin:
            panel_points=KDTree(len(mesh.verts))
        if binding:
            rest={v:v.co.copy() for v in mesh.verts}
            transforms={}
        remaining = set(mesh.verts)
        for seed in mesh.verts:
            if seed not in remaining:continue
            remaining.remove(seed)
            pending = [seed]
            island = []
            while pending:
                vertex = pending.pop()
                island.append(vertex)
                for edge in vertex.link_edges:
                    other = edge.other_vert(vertex)
                    if other in remaining:
                        remaining.remove(other)
                        pending.append(other)
            centre = matrix @ (sum((v.co for v in island),Vector()) / len(island))
            x,y,z = centre
            # Keep fine surface marks near their corresponding panel.
            shift = Vector((x*.64, .52*max(0,y-.24), z*.24))
            if (obj.name == 'Chassis_TwoToneCover' or obj.name.startswith('ConformalDecals')) and abs(x)>.40 and -.55 < y < .76 and -2.0 < z < .58:
                shift.x += .47 if x>0 else -.47
            if obj.name.startswith('Floor'):
                shift.y -= .30
            elif abs(x) < .58 and y > .62 and z < .45:
                shift.y += .22
            if abs(x) > .65 and abs(z) > 1.4:
                shift.x += .23 if x > 0 else -.23
            side = 1 if x>0 else -1
            role = next((roles[k] for k in island[0][weights].keys() if k in roles),None) if weights else None
            shield=role=='engine-shield'
            intake_port=role=='engine-port'
            upper_rail=role=='engine-rail'
            if shield or intake_port or upper_rail:role='engine'
            if obj.parent and obj.parent.name in ('FrontL','FrontR','RearL','RearR'):
                axle=obj.parent.location.z
                # Tyres pull clear of the rim and centrelock in the breakdown.
                # The sidewall print travels with the rubber, the dish with the hub.
                loose_tyre=obj.name.endswith(('_Rubber','_SlickRubber','_CompoundInk'))
                # In the fully open wire shot the outboard cover remains recessed
                # in the tyre. The inboard cover and brake hardware follow the hub.
                outer_cover=(wire_breakdown and not intro and role=='wheel-cover' and
                             not loose_tyre and side*(x-obj.parent.location.x)>.04)
                loose_tyre=loose_tyre or outer_cover
                travel=.80 if loose_tyre or (service and role=='wheel-cover') else .38
                # In the wire orbit the visible dishes follow the tyres further
                # outboard, leaving the inner brake assemblies exposed.
                if wire_breakdown and not intro and role=='wheel-cover' and not loose_tyre:
                    travel=.65
                if outer_cover:travel-=.055
                if service and axle<0 and side<0 and travel>.4:
                    travel+=.88
                shift = Vector((side*travel,-.025 if service and axle<0 else .10,-.24 if axle>0 else -.21))
            elif role=='suspension' and wire_breakdown and not intro:
                # The separated wheel carrier keeps its four pickup links in frame 020.
                # The matching inner dish and upright follow the same rigid motion.
                shift=Vector((side*.65,.10,-.24 if z>0 else -.21))
            elif role in ('front-main','front-lower','front-upper','front-fence'):
                dx,dy,dz = {'front-main':(0,.16,.50),'front-lower':(.15,.14,.17),
                            'front-upper':(.17,.15,-.09),'front-fence':(.50,.15,.06)}[role]
                if not service:
                    dx,dy,dz={'front-main':(0,.70,.07),'front-lower':(.13,.60,-.13),
                              'front-upper':(.14,.67,-.32),'front-fence':(.64,.77,-.10)}[role]
                if role=='front-fence' and obj.name.startswith(('Chassis_AeroLaminate','Chassis_Upper flap laminate','Chassis_FrontFenceLaminate')):
                    heights=[(matrix@v.co).y for v in island]
                    if max(heights)-min(heights)<.10:
                        dx+=.17
                        dy+=-.085 if service else .04
                        if not service:dz+=.07
                shift = Vector((side*dx,dy,dz))
            elif role=='engine':
                shift=Vector((0,.48,.04)) if not service else Vector((0,.43,-.61))
            elif role=='impact':
                shift=Vector((0,.058,-.73)) if service else Vector((0,.048,-.66))
            elif role=='pipe':
                shift=Vector((0,.474,-.516))
            elif role=='lamp':
                shift=Vector((0,.082,-.92))
            elif role=='rear-beam':
                shift=Vector((0,.51,-.56)) if service else Vector((0,.26,-.67))
            elif role=='rear-stay':
                shift=Vector((0,.11,-.43))
            elif role=='output-drive' and service:
                shift=Vector((side*.54,.055,.05))
            elif role=='gear-cover':
                shift=Vector((-.30,1.60 if service else 1.28,.06))
            elif role in ('gearset','gear-housing'):
                shift=Vector((-.20,.27,-.731)) if service else Vector((-.20,.268,-.80))
                if service and role=='gear-housing':
                    shift+=Vector((.14,-.034,-.078))
            elif role == 'rear-main':
                shift = Vector((0,.34,-.53)) if service else Vector((0,.76,-.58))
            elif role == 'rear-fence':
                shift = Vector((side*.32,.16,-.39))
            elif obj.parent and obj.parent.name=='DRS':
                shift = Vector((0,.46,-.62)) if service else Vector((0,.91,-.77))
            elif obj.name.startswith('Floor'):
                shift = Vector((0,0.23 if service else -.04,-.41 if service else -.44)) if z<floor_joint else Vector((side*.70 if abs(x)>.30 else 0,-.22,0))
            elif obj.name=='Chassis_TwoToneCover' and z>.58:
                shift = Vector((0,.57,.63))
            elif obj.name=='Chassis_TwoToneCover' and abs(x)<.40 and z<-.50:
                shift=Vector((side*.32,.38,-.08)) if y>.72 else Vector((0,.27,.15))
            if not service and obj==skin and z<.58:
                if abs(x)>.40:
                    shoulder=y>shoulder_height(x,z)-.004
                    if shoulder:
                        shift=Vector((side*.21,.91,-.21))
                    else:
                        shift=Vector((-.78,.60,-.06)) if x<0 else Vector((.70,.19,-.73))
                elif z<-.69:
                    # Both sides of the high central fin lift as a single piece.
                    # The two lower skins nest beneath it, leaving the intake ports exposed.
                    shift=Vector((.29,1.28,-.31)) if y>.72 else Vector((.19+side*.115,1.13,-.35))
                else:
                    shift=Vector((0,1.04,-.07))
            elif not service and (role=='halo-fairing' or 'HaloComposite' in obj.name or obj.name.startswith('Steering_')):
                shift=Vector((0,1.04,-.07))
            if wire_breakdown:
                if obj.name.startswith('Floor') and z>floor_joint:
                    if x<-.30:
                        shift+=Vector((.10,0.49,-0.61))
                    elif abs(x)<.30:
                        shift+=Vector((0,0.13,-.27))
                elif obj==skin and abs(x)>.40 and y<shoulder_height(x,z)-.004:
                    shift+=Vector((0,.29,-.20)) if x<0 else Vector((.23,.36,.25))
                elif role=='front-fence' and side>0:
                    shift+=Vector((-.25,-.29,.06))
                elif role=='front-main':
                    shift+=Vector((0,-.27,0))
                elif role=='engine':
                    shift+=Vector((-.18,.36,-.05))
            if service and obj.name.startswith('Floor') and z<floor_joint and x>0:
                shift+=Vector((.16,-.12,.88))
            if service and obj==skin:
                if z<-.50 and abs(x)<.4:
                    if y>.728+.045*(z+2.19) or (z>-1.11 and y>.59):
                        shift=Vector((side*.28,.41,.48 if x<0 else .82))
                    elif y>.59:
                        shift=Vector((side*.27,*service_cowls[side][3:]))
                    else:
                        shift=Vector((side*.14,1.35,.70))
                elif abs(x)>.40 and z<.58:
                    shift+=Vector((0,.7,1.44))
            # In frame 035 the body has already closed around the power unit
            # while the tyres remain outboard and the sidepods are still open.
            fraction=1.
            if reassembly:
                wheel=obj.parent and obj.parent.name in ('FrontL','FrontR','RearL','RearR')
                fraction=.59 if wheel else .24 if obj==skin and abs(x)>.4 else .08
                shift*=fraction
            panel_rotation=None
            if service and obj==skin and z<-1.11 and abs(x)<.4 and .59<y<.728+.045*(z+2.19):
                rx,ry,rz=service_cowls[side][:3]
                rotation=(Matrix.Rotation(radians(rz),3,'Z')@Matrix.Rotation(radians(ry),3,'Y')@
                          Matrix.Rotation(radians(rx),3,'X'))
                panel_rotation=(Vector((0,.72,-2.19)),rotation)
            if obj==skin:
                panel_rotations.append(panel_rotation)
                panel_index=len(panel_offsets)
                panel_offsets.append(shift.copy())
                for vertex in island:
                    panel_points.insert(matrix@vertex.co,panel_index)
            elif role is None and (obj.name.startswith(('NumberA_','NumberB_','ConformalDecals_')) or
                                    obj.name.endswith(('_MarkWhite','_BrandBlue','_BrandGold'))):
                _,panel_index,distance=panel_points.find(centre)
                if distance<.042:
                    shift=panel_offsets[panel_index]
                    panel_rotation=panel_rotations[panel_index]
            if role=='cowl-edge':
                _,nearest,_=panel_points.find(centre)
                shift=panel_offsets[nearest].copy()
                panel_rotation=panel_rotations[nearest]
                if service:
                    rx,ry,rz=service_cowls[side][:3]
                    tilt=(Matrix.Rotation(radians(rz),3,'Z')@Matrix.Rotation(radians(ry),3,'Y')@
                          Matrix.Rotation(radians(rx),3,'X'))
                    panel_rotation=(Vector((0,.72,-2.19)),tilt)
                    shift=Vector((side*.27,*service_cowls[side][3:]))
            if service and obj.name.startswith('Floor') and z<floor_joint and x<=0:
                shift+=Vector((.028,.075,-.165))
            open_flap=obj.parent and obj.parent.name=='DRS'
            rear_floor=obj.name.startswith('Floor') and z<floor_joint
            if service and role in ('rear-main','rear-fence'):
                # The near endplate hangs upright; the mainplane and the
                # opposite fence have separate orientations in frame 025.
                if role=='rear-main':
                    pivot=Vector((0,.78,-2.39));tilt=Matrix.Rotation(radians(-14),3,'Z')@Matrix.Rotation(radians(-26),3,'X')
                    shift+=Vector((0,-.055,.115))
                elif x>0:
                    pivot=Vector((x,.94,-2.40));tilt=Matrix.Rotation(radians(15),3,'X')
                    shift+=Vector((0,.025,.08))
                else:
                    tilt=None
                if tilt is not None:panel_rotation=(pivot,tilt)
            if wire_breakdown and role=='rear-main':
                panel_rotation=(Vector((0,.78,-2.39)),Matrix.Rotation(radians(-12),3,'Z'))
            tilt=None
            if panel_rotation:
                pivot,tilt=panel_rotation
            elif role in ('gearset','gear-housing','impact') and service:
                pivot=Vector((0,.276,-2.18) if role!='impact' else (0,.231,-2.52))
                tilt=Matrix.Rotation(radians(-11 if role!='impact' else -11),3,'X')
                if role=='gear-housing':
                    tilt=tilt@Matrix.Rotation(radians(-160),3,'Z')
            elif role in ('pipe','lamp') and service:
                pipe=role=='pipe'
                pivot=Vector((0,.448,-2.68) if pipe else (0,.231,-2.72))
                tilt=Matrix.Rotation(radians(-7 if pipe else -23),3,'X' if pipe else 'Y')
            elif open_flap or rear_floor:
                hinge=Vector((0,.87,-2.42)) if open_flap else Vector((0,.18,-2.17))
                tilt=Matrix.Rotation(radians(fraction*(drs_angle if open_flap else (-13 if service else -17))),3,'X')
                if open_flap and wire_breakdown:
                    tilt=Matrix.Rotation(radians(-17),3,'Z')@tilt
                if rear_floor and service:
                    tilt=Matrix.Rotation(radians(13),3,'Y')@Matrix.Rotation(radians(19),3,'Z')@tilt
                pivot=hinge
            transform=(local@Matrix.Translation(pivot+shift)@tilt.to_4x4()@Matrix.Translation(-pivot)@matrix
                       if tilt is not None else Matrix.Translation(inverse@shift))
            if wire_breakdown and (open_flap or role in ('rear-main','rear-fence')):
                blade='drs' if open_flap else role if role=='rear-main' else 'near-fence' if side<0 else 'far-fence'
                centre,angles,travel=blade_poses[blade]
                rx,ry,rz=angles
                turn=(Matrix.Rotation(radians(rz),4,'Z')@Matrix.Rotation(radians(ry),4,'Y')@
                      Matrix.Rotation(radians(rx),4,'X'))
                about=Vector(centre)
                correction=Matrix.Translation(about+Vector(travel))@turn@Matrix.Translation(-about)
                transform=local@correction@matrix@transform
            if service:
                fit_part='rear-fence'+str(side) if role=='rear-fence' else 'diff'+str(side) if rear_floor else 'drs' if open_flap else role
                if panel_rotation and (obj==skin or role=='cowl-edge' or role is None and obj.name.startswith(('NumberA_','NumberB_','ConformalDecals_'))):
                    fit_part='cowl'+str(side)
                if obj.parent and obj.parent.name in ('RearR','RearL','FrontR','FrontL'):
                    fit_part=obj.parent.name
                # The near trumpets clear the cowling. The other bank stays seated on its casting.
                if intake_port and side<0:fit_part='engine-port'
                fit=service_fit.get(fit_part)
                if fit:
                    transform=local@fitted_motion(fit)@matrix@transform
            motion=progress
            if intro:
                # During the clay sequence the tyres slide off the dishes
                # before the rear aero pack rises to its full exploded pose.
                early=intro<.2
                motion=intro
                if obj.parent and obj.parent.name in ('FrontL','FrontR','RearL','RearR'):
                    if loose_tyre:motion=.22 if early else .83
                    else:motion=.045 if early else .39
                elif open_flap or role in ('rear-main','rear-fence','rear-beam','rear-stay'):
                    motion=.018 if early else .45
                elif role=='engine':motion=.12 if early else .83
            if motion!=1:transform=Matrix.Identity(4).lerp(transform,motion)
            if pose_fit:
                # Apply rigid travel after release. Frames 020–022 constrain
                # one exploded pose in three cameras, including the split wheels.
                part=role
                if obj==skin:
                    if z>.58:part='nose'
                    elif abs(x)>.40:
                        shoulder=y>shoulder_height(x,z)-.004
                        part=('upper-pod' if shoulder else 'lower-pod')+str(side)
                    elif z<-.69:part='fin' if y>.73 else 'cowl'
                    else:part='cockpit'
                elif obj.name.startswith('Floor'):
                    part='diff'+str(side) if rear_floor else 'floor'+str(side) if abs(x)>.30 else 'tray'
                elif open_flap:part='drs'
                elif role in ('front-fence','rear-fence'):part=role+str(side)
                elif role=='halo-fairing' or 'HaloComposite' in obj.name or obj.name.startswith('Steering_'):part='cockpit'
                if obj.parent and obj.parent.name in ('FrontL','FrontR','RearL','RearR'):
                    part=obj.parent.name+('-tyre' if loose_tyre else '-rim')
                if role=='suspension' and wire_breakdown and not intro:
                    station=('Front' if z>0 else 'Rear')+('L' if side<0 else 'R')
                    part=station+'-rim'
                adjust=fitted_motion(pose_fit.get(part,(0,0,0)),progress)
                if role in ('front-upper','front-lower','rear-stay'):
                    side_fit=pose_fit.get(role+str(side))
                    if side_fit:adjust=fitted_motion(side_fit,progress)@adjust
                if obj==skin and part=='cowl' and 'cowl'+str(side) in pose_fit:
                    adjust=fitted_motion(pose_fit['cowl'+str(side)],progress)@adjust
                # In the clay release the halo has lifted clear of its mounting
                # collars. Its bonded outer lip follows the same rigid motion.
                if (role=='halo-fairing' or 'HaloComposite' in obj.name) and 'halo' in pose_fit:
                    adjust=fitted_motion(pose_fit['halo'],progress)@adjust
                if shield and 'engine-shield' in pose_fit:
                    adjust=fitted_motion(pose_fit['engine-shield'],progress)@adjust
                if obj==skin:panel_release.append(adjust)
                elif obj.name.startswith(('NumberA_','NumberB_','ConformalDecals_')) or role=='cowl-edge':
                    _,nearest,distance=panel_points.find(centre)
                    if distance<.042 and role in (None,'cowl-edge'):adjust=panel_release[nearest]
                transform=local@adjust@matrix@transform
            # The complete inlet insert is bonded to the lower shell. Reuse
            # the shell's rigid motion, including its final fitted rotation.
            if obj==skin and abs(x)>.40 and z<.58 and y<shoulder_height(x,z)-.004:
                distance=min(((matrix@v.co)-Vector((side*.70,.49,.45))).length_squared for v in island)
                if side not in pod_transforms or distance<pod_transforms[side][0]:
                    pod_transforms[side]=(distance,matrix@transform@local)
            if obj==skin:skin_transforms.append(matrix@transform@local)
            if role=='outlet-detail':
                _,nearest,_=panel_points.find(centre)
                transform=local@skin_transforms[nearest]@matrix
            if (shield or upper_rail or intake_port and side>0) and service:
                # The carrier and its upper rails lift with the cowling,
                # exposing the detached intake trumpets below its rolled edge.
                _,nearest,_=panel_points.find(Vector((.09,.88,-1.61)))
                transform=local@skin_transforms[nearest]@matrix
            if role=='pod-inlet' and side in pod_transforms:
                transform=local@pod_transforms[side][1]@matrix
            for vertex in island:
                if binding:transforms[vertex]=transform
                vertex.co=transform@vertex.co
        if binding:binding.record(obj,mesh,source_faces,rest,transforms)
        if obj==skin:
            panel_points.balance()
        mesh.to_mesh(obj.data)
        mesh.free()
    bpy.data.objects['Graphite floor'].location.y -= .34*(.08 if reassembly else 1)*(intro or progress)


# A narrow reflected strip picks up the rolled inner edge of the wheel covers.
wheel_receivers=bpy.data.collections.new('Wheel cover receivers')
for obj in scene.objects:
    if obj.type=='MESH' and obj.name.endswith('_WheelDish'):
        wheel_receivers.objects.link(obj)
lamp=bpy.data.lights.new('Wheel bead strip','AREA')
lamp.shape='RECTANGLE';lamp.size=.26;lamp.size_y=.50;lamp.energy=115
wheel_strip=bpy.data.objects.new('Wheel bead strip',lamp);scene.collection.objects.link(wheel_strip)
wheel_strip.location=(-1.36,1.61,2.18)
wheel_strip.rotation_euler=(Vector((-.983,.20,1.405))-wheel_strip.location).to_track_quat('-Z','Y').to_euler()
wheel_strip.light_linking.receiver_collection=wheel_receivers
render('colour')
render('side',(-1,.015,0),(0,.52,.10),6.18)
render('front',(0,.12,1),(0,.47,0),2.60)
render('top',(-.0001,1,0),(0,.45,.08),6.22)
if not selected_views or 'front-corner' in selected_views:
    receivers=bpy.data.collections.new('Front wing softbox receivers')
    for obj in scene.objects:
        if obj.name in ('Chassis_AeroLaminate','Chassis_Upper flap laminate','Chassis_FrontFenceLaminate','ConformalDecals_BankInk','ConformalDecals_FlapInk','FrontL_CompoundInk','FrontR_CompoundInk'):
            receivers.objects.link(obj)
    fill=bpy.data.lights.new('Endplate softbox','AREA')
    fill.shape='RECTANGLE';fill.size=1.3;fill.size_y=.62;fill.energy=16
    box=bpy.data.objects.new('Endplate softbox',fill);scene.collection.objects.link(box)
    box.location=(-1.91,.78,2.52)
    box.rotation_euler=(Vector((-.785,.241,2.41))-box.location).to_track_quat('-Z','Y').to_euler()
    box.light_linking.receiver_collection=receivers
    slot_lamp=bpy.data.lights.new('Inboard flap return fill','AREA')
    slot_lamp.shape='RECTANGLE';slot_lamp.size=.37;slot_lamp.size_y=.065;slot_lamp.energy=.85
    slot=bpy.data.objects.new('Inboard flap return fill',slot_lamp);scene.collection.objects.link(slot)
    slot.location=(.31,.52,2.17)
    slot.rotation_euler=(Vector((-.21,.206,2.36))-slot.location).to_track_quat('-Z','Y').to_euler()
    slot.light_linking.receiver_collection=receivers
    # The studio card grazes the tyre shoulder and reflects in the deep wheel dish.
    bead=bpy.data.lights.new('Dish reflection card','AREA')
    bead.shape='RECTANGLE';bead.size=.067;bead.size_y=.106;bead.energy=2.960
    card=bpy.data.objects.new('Dish reflection card',bead);scene.collection.objects.link(card)
    card.location=(-1.493,0.5510,1.5500)
    card.rotation_euler=(Vector((-.980,.198,1.413))-card.location).to_track_quat('-Z','Y').to_euler()
    card.light_linking.receiver_collection=wheel_receivers
    stage_emission=floor.inputs['Emission Strength']
    original_stage_power=stage_emission.default_value
    stage_emission.default_value=1.40
    render('front-corner')
    stage_emission.default_value=original_stage_power
    bpy.data.objects.remove(card,do_unlink=True)
    bpy.data.objects.remove(slot,do_unlink=True)
    bpy.data.objects.remove(box,do_unlink=True)
    bpy.data.collections.remove(receivers)
# Broad grazing illumination reveals the graphite visor and seat opening in frame 012.
cockpit_receivers=bpy.data.collections.new('Cockpit inspection receivers')
for obj in scene.objects:
    if obj.type=='MESH' and (obj.name.startswith('Steering_') or
            any(m and m.name in ('Cockpit liner','SeatFoam','Knee bolster','Seat pan laminate') for m in obj.data.materials)):
        cockpit_receivers.objects.link(obj)
lamp=bpy.data.lights.new('Cockpit strip','AREA')
lamp.shape='RECTANGLE';lamp.size=.68;lamp.size_y=.23;lamp.energy=2
cockpit_strip=bpy.data.objects.new('Cockpit strip',lamp);scene.collection.objects.link(cockpit_strip)
cockpit_strip.location=(.22,1.07,-.40)
cockpit_strip.rotation_euler=(Vector((0,.46,.09))-cockpit_strip.location).to_track_quat('-Z','Y').to_euler()
cockpit_strip.light_linking.receiver_collection=cockpit_receivers
# Short grazing reflections on the moulded thumb pad and grip heel.
grip_receivers=bpy.data.collections.new('Moulded grip receivers')
grip_receivers.objects.link(bpy.data.objects['Steering_Rubber'])
grip_strips=[]
for pos,focus,width,height,power in [
    ((-.1809,.5489,.0657),(-.158,.535,.099),.011,.015,.01),
    ((-.073,.400,-.052),(.156,.524,.116),.11,.043,.08)]:
    data=bpy.data.lights.new('Grip reflection','AREA')
    data.shape='RECTANGLE';data.size=width;data.size_y=height;data.energy=power
    obj=bpy.data.objects.new('Grip reflection',data);scene.collection.objects.link(obj)
    obj.location=pos;obj.rotation_euler=(Vector(focus)-obj.location).to_track_quat('-Z','Y').to_euler()
    obj.light_linking.receiver_collection=grip_receivers
    grip_strips.append(obj)
# A narrow strip reflects along the pressed lip without lighting the whole pan.
seat_receivers=bpy.data.collections.new('Seat lip receivers')
seat_receivers.objects.link(bpy.data.objects['Chassis_Seat edge satin'])
seat_lamp=bpy.data.lights.new('Seat lip reflection','AREA')
seat_lamp.shape='RECTANGLE';seat_lamp.size=.044;seat_lamp.size_y=.006;seat_lamp.energy=.019
seat_strip=bpy.data.objects.new('Seat lip reflection',seat_lamp);scene.collection.objects.link(seat_strip)
seat_strip.location=(-.0735,.3207,-.0722)
seat_strip.rotation_euler=(Vector((-.0812,.3182,-.0157))-seat_strip.location).to_track_quat('-Z','Y').to_euler()
seat_strip.light_linking.receiver_collection=seat_receivers
# The top and side of the curved graphite brow catch different strips.
visor_receivers=bpy.data.collections.new('Steering visor receivers')
visor_receivers.objects.link(bpy.data.objects['Steering_Wheel graphite brow'])
visor_strips=[]
for focus,pos,width,height,watts in [
    ((.0882,.599,.144),(.2947,.7213,.1422),.128,.022,0.04687),
    ((-.1066,.5999,.135),(-.1273,.7695,-.0335),.155,.013,0.01553)]:
    light=bpy.data.lights.new('Graphite brow reflection','AREA')
    light.shape='RECTANGLE';light.size=width;light.size_y=height;light.energy=watts
    card=bpy.data.objects.new(light.name,light);scene.collection.objects.link(card)
    card.location=pos;card.rotation_euler=(Vector(focus)-card.location).to_track_quat('-Z','Y').to_euler()
    card.light_linking.receiver_collection=visor_receivers;visor_strips.append(card)
# A short grazing reflection reveals the dished part of the pressing below the lip.
pan_receivers=bpy.data.collections.new('Pressed seat pan receivers')
pan_receivers.objects.link(bpy.data.objects['Chassis_Seat pan laminate'])
pan_lamp=bpy.data.lights.new('Seat pressing reflection','AREA')
pan_lamp.shape='RECTANGLE';pan_lamp.size=.011;pan_lamp.size_y=.018;pan_lamp.energy=0.00406
pan_card=bpy.data.objects.new(pan_lamp.name,pan_lamp);scene.collection.objects.link(pan_card)
focus=Vector((.050,.3095,-.045));direction=(Vector((.096,.540,-.002))-focus).normalized()
pan_card.location=focus+.039*direction
pan_card.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler()
pan_card.light_linking.receiver_collection=pan_receivers
render('steering')
bpy.data.objects.remove(pan_card,do_unlink=True);bpy.data.collections.remove(pan_receivers)
for card in visor_strips:bpy.data.objects.remove(card,do_unlink=True)
bpy.data.collections.remove(visor_receivers)
bpy.data.objects.remove(seat_strip,do_unlink=True)
bpy.data.collections.remove(seat_receivers)
for obj in grip_strips:bpy.data.objects.remove(obj,do_unlink=True)
bpy.data.collections.remove(grip_receivers)
bpy.data.objects.remove(cockpit_strip,do_unlink=True)
bpy.data.collections.remove(cockpit_receivers)
bpy.data.objects.remove(wheel_strip,do_unlink=True)
bpy.data.collections.remove(wheel_receivers)
@contextmanager
def inspection_pose(angle, **options):
    originals={o:o.data for o in scene.objects if o.type=='MESH'}
    stage=bpy.data.objects['Graphite floor']
    stage_height=stage.location.y
    try:
        for o,data in originals.items():o.data=data.copy()
        explode(angle,**options)
        yield
    finally:
        for o,data in originals.items():
            temporary=o.data
            o.data=data
            bpy.data.meshes.remove(temporary)
        stage.location.y=stage_height

if selected_views=={'bake-poses'}:
    sys.path.insert(0,str(Path(__file__).parent))
    from inspection_poses import bake
    bake(Path(__file__).resolve().parents[2],bpy.data.objects['Chassis_TwoToneCover'],inspection_pose)
    sys.exit(0)

pose_options={'quarter':(28,{}),'overhead':(0,{'reassembly':True}),
              'service':(-7,{'service':True}),'exploded':(28,{'wire_breakdown':True}),
              'lift':(28,{'wire_breakdown':True,'intro':.10}),
              'breakdown':(28,{'wire_breakdown':True,'intro':.63})}
def matrix_views(names):
    for name in names:
        if selected_views and name not in selected_views:continue
        pose=review_views[name]['pose']
        if pose:
            angle,options=pose_options[pose]
            with inspection_pose(angle,progress=review_views[name].get('progress',1),**options):
                render(name)
        else:
            render(name)
if matrix_dir:matrix_views([k for k in review_views if k not in ('hero','front','side','top','steering','front-corner','rear-wing','rear-quarter','rear-overhead')])
if not selected_views or 'rear-quarter' in selected_views:
    with inspection_pose(28):
        render('rear-quarter')
if not selected_views or 'rear-overhead' in selected_views:
    with inspection_pose(0,reassembly=True):
        render('rear-overhead')
if not selected_views or 'rear-wing' in selected_views:
    with inspection_pose(-7,service=True):
        # Narrow rear inspection light catches the machined edges and diffuser vanes.
        # Link the strip to the rear hardware to keep the graphite stage dark.
        receivers=bpy.data.collections.new('Rear inspection light receivers')
        for obj in scene.objects:
            if obj.type=='MESH' and obj.name.startswith(('Chassis_Titanium','Chassis_Transmission','Chassis_Ground steel','Chassis_Turned shaft steel','Chassis_Machined gear web',
                                                        'Chassis_Machined intake bell','Chassis_PortRecess','Floor_Carbon','Chassis_OxidisedTitanium')):
                receivers.objects.link(obj)
        lamp=bpy.data.lights.new('Gearbox strip','AREA')
        lamp.shape='RECTANGLE';lamp.size=1.80;lamp.size_y=.38;lamp.energy=78
        strip=bpy.data.objects.new('Gearbox strip',lamp);scene.collection.objects.link(strip)
        strip.location=(-1.55,1.85,-3.95)
        strip.rotation_euler=(Vector((0,.42,-2.82))-strip.location).to_track_quat('-Z','Y').to_euler()
        strip.light_linking.receiver_collection=receivers
        shaft_receivers=bpy.data.collections.new('Shaft journal receivers')
        for material in ('Turned shaft steel','Ground steel','Machined gear web'):
            shaft_receivers.objects.link(bpy.data.objects['Chassis_'+material])
        journal_light=bpy.data.lights.new('Shaft journal reflection','AREA')
        journal_light.shape='RECTANGLE';journal_light.size=1.;journal_light.size_y=.043;journal_light.energy=8.
        journal_card=bpy.data.objects.new('Shaft journal reflection',journal_light);scene.collection.objects.link(journal_card)
        journal_card.location=(-.60,.744,-3.695)
        normal=(journal_card.location-Vector((-.245,.528,-3.132))).normalized()
        tangent=Vector((.05,.01,1));tangent=(tangent-normal*tangent.dot(normal)).normalized()
        journal_card.rotation_euler=Matrix((tangent,normal.cross(tangent),normal)).transposed().to_euler()
        journal_card.light_linking.receiver_collection=shaft_receivers
        edge_light=bpy.data.objects['Cool edge']
        edge_light.visible_glossy=False
        world=bpy.context.scene.world.node_tree.nodes.get('Background')
        world.inputs['Strength'].default_value=.19
        floor.inputs['Emission Strength'].default_value=.40
        deck_receivers=bpy.data.collections.new('Diffuser deck receivers')
        for obj in scene.objects:
            if obj.type=='MESH' and obj.name.startswith('Floor_Carbon'):deck_receivers.objects.link(obj)
        base_deck_color=tuple(laminate.inputs['Base Color'].default_value)
        base_deck_roughness=laminate.inputs['Roughness'].default_value
        base_stage_specular=floor.inputs['Specular IOR Level'].default_value
        laminate.inputs['Base Color'].default_value=tuple(.78*v for v in base_deck_color[:3])+(1,)
        laminate.inputs['Roughness'].default_value=.54
        floor.inputs['Specular IOR Level'].default_value=.33
        deck_lamp=bpy.data.lights.new('Diffuser softbox','AREA')
        deck_lamp.shape='RECTANGLE';deck_lamp.size=1.7;deck_lamp.size_y=.29;deck_lamp.energy=3
        deck_strip=bpy.data.objects.new('Diffuser softbox',deck_lamp);scene.collection.objects.link(deck_strip)
        deck_strip.location=(.78,1.58,-1.83)
        deck_strip.rotation_euler=(Vector((0,.25,-2.90))-deck_strip.location).to_track_quat('-Z','Y').to_euler()
        deck_strip.light_linking.receiver_collection=deck_receivers
        wing_receivers=bpy.data.collections.new('Rear wing studio receivers')
        for obj in scene.objects:
            if obj.type=='MESH' and (obj.name.startswith(('Chassis_Carbon','Chassis_RearFenceCarbon','Chassis_RearAero','Chassis_TwoToneCover')) or (obj.parent and obj.parent.name=='DRS')):
                wing_receivers.objects.link(obj)
        wing_lamp=bpy.data.lights.new('Rear blade softbox','AREA')
        wing_lamp.shape='RECTANGLE';wing_lamp.size=1.8;wing_lamp.size_y=.52;wing_lamp.energy=122
        wing_strip=bpy.data.objects.new('Rear blade softbox',wing_lamp);scene.collection.objects.link(wing_strip)
        wing_strip.location=(.25,2.25,-3.85)
        wing_strip.rotation_euler=(Vector((.15,1,-2.85))-wing_strip.location).to_track_quat('-Z','Y').to_euler()
        wing_strip.light_linking.receiver_collection=wing_receivers
        # Keep the soft reflection on the paint independent of the gear-tooth strip.
        cowl_receivers=bpy.data.collections.new('Exposed fairing receivers')
        for obj in scene.objects:
            if obj.name.startswith(('Chassis_TwoToneCover','Chassis_Cowling')):cowl_receivers.objects.link(obj)
        cowl_light=bpy.data.lights.new('Fairing strip','AREA')
        cowl_light.shape='RECTANGLE';cowl_light.size=2.7;cowl_light.size_y=.39;cowl_light.energy=175
        cowl_strip=bpy.data.objects.new('Fairing strip',cowl_light);scene.collection.objects.link(cowl_strip)
        cowl_strip.location=(-1.85,1.65,-3.25)
        cowl_strip.rotation_euler=(Vector((0,1.12,-2.40))-cowl_strip.location).to_track_quat('-Z','Y').to_euler()
        cowl_strip.light_linking.receiver_collection=cowl_receivers
        accent_light=bpy.data.lights.new('Rolled edge reflection','AREA')
        accent_light.shape='RECTANGLE';accent_light.size=.44;accent_light.size_y=.12;accent_light.energy=7.5
        accent=bpy.data.objects.new('Rolled edge reflection',accent_light);scene.collection.objects.link(accent)
        # Align the reflector along the curvature of the rolled enamel lip.
        accent.location=(.224,1.799,-1.910)
        normal=(accent.location-Vector((.202,1.098,-1.856))).normalized()
        along=Vector((-.19,.06,.34))
        along=(along-normal*along.dot(normal)).normalized()
        accent.rotation_euler=Matrix((along,normal.cross(along),normal)).transposed().to_euler()
        enamel_receivers=bpy.data.collections.new('Rolled enamel receivers')
        enamel_receivers.objects.link(bpy.data.objects['Chassis_CowlingEdge'])
        accent.light_linking.receiver_collection=enamel_receivers
        diffuser_receivers=bpy.data.collections.new('Rear diffuser and blade supports')
        for name in ('Floor_Carbon','Chassis_Carbon'):
            diffuser_receivers.objects.link(scene.objects[name])
        diffuser_light=bpy.data.lights.new('Far diffuser reflection','AREA')
        diffuser_light.shape='RECTANGLE'
        diffuser_light.size=.88
        diffuser_light.size_y=.45
        diffuser_light.energy=22
        diffuser_panel=bpy.data.objects.new('Far diffuser reflection',diffuser_light)
        scene.collection.objects.link(diffuser_panel)
        diffuser_panel.location=(.30,1.08,-1.59)
        diffuser_panel.rotation_euler=(Vector((-.38,.43,-2.15))-diffuser_panel.location).to_track_quat('-Z','Y').to_euler()
        diffuser_panel.light_linking.receiver_collection=diffuser_receivers
        render('rear-wing',(-1,.19,-.44),(-.60,.70,-3.03),2.04)
        bpy.data.objects.remove(diffuser_panel,do_unlink=True)
        bpy.data.collections.remove(diffuser_receivers)
        bpy.data.objects.remove(journal_card,do_unlink=True)
        bpy.data.collections.remove(shaft_receivers)
        bpy.data.objects.remove(accent,do_unlink=True)
        bpy.data.collections.remove(enamel_receivers)
        bpy.data.objects.remove(cowl_strip,do_unlink=True)
        bpy.data.collections.remove(cowl_receivers)
        bpy.data.objects.remove(wing_strip,do_unlink=True)
        bpy.data.collections.remove(wing_receivers)
        laminate.inputs['Base Color'].default_value=base_deck_color
        laminate.inputs['Roughness'].default_value=base_deck_roughness
        floor.inputs['Specular IOR Level'].default_value=base_stage_specular
        bpy.data.objects.remove(deck_strip,do_unlink=True)
        bpy.data.collections.remove(deck_receivers)
        floor.inputs['Emission Strength'].default_value=.8
        world.inputs['Strength'].default_value=.28
        edge_light.visible_glossy=False
        bpy.data.objects.remove(strip,do_unlink=True)
        bpy.data.collections.remove(receivers)
clay = bpy.data.materials.new('Inspection porcelain')
clay.use_nodes = True
shader = clay.node_tree.nodes['Principled BSDF']
shader.inputs['Base Color'].default_value = (.88,.855,.79,1)
shader.inputs['Roughness'].default_value = .47
# The short contact shadow is most visible inside a dismounted tyre and
# between the coils of the gearbox. It follows the actual posed geometry.
ao=clay.node_tree.nodes.new('ShaderNodeAmbientOcclusion')
ao.inputs['Color'].default_value=(.88,.855,.79,1)
ao.inputs['Distance'].default_value=.19
ao.samples=8
clay.node_tree.links.new(ao.outputs['Color'],shader.inputs['Base Color'])
for obj in scene.objects:
    if obj.type == 'MESH' and obj.name != 'Graphite floor':
        if obj.name.endswith(('_NoseBadgeInk','_VisorInk','_BankInk','_FenceInk','_FoilInk','_FlapInk','_BodyInk')):obj.hide_render=True
        for slot in obj.material_slots:
            slot.material = clay
finish='clay'
render('clay')
if matrix_dir:
    matrix_views([k for k in review_views if k not in ('hero','clay-breakdown')])
    # The fully released clay shot reveals the underside and a sharper floor reflection.
    polish=('Roughness','Specular IOR Level','IOR')
    saved_polish=[floor.inputs[name].default_value for name in polish]
    for name,value in zip(polish,(.13,.65,1.55)):
        floor.inputs[name].default_value=value
    ao.inputs['Distance'].default_value=.24
    # The lower cowl casts a distinct shadow across its separated floor rail.
    # The direction comes from the cowl lip and its shadow on the floor.
    studio_energy=[(obj.data,obj.data.energy) for obj in scene.objects if obj.type=='LIGHT']
    world_strength=scene.world.node_tree.nodes['Background'].inputs['Strength']
    original_strength=world_strength.default_value
    for source,energy in studio_energy:source.energy=.225*energy
    world_strength.default_value=.69*original_strength
    key=bpy.data.lights.new('Clay breakdown key','SUN')
    key.energy=5.68
    key.angle=radians(4)
    clay_key=bpy.data.objects.new('Clay breakdown key',key)
    scene.collection.objects.link(clay_key)
    direction=Vector((-.508,.815,.279)).normalized()
    clay_key.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler()
    matrix_views(['clay-breakdown'])
    bpy.data.objects.remove(clay_key,do_unlink=True)
    world_strength.default_value=original_strength
    for source,energy in studio_energy:source.energy=energy
    ao.inputs['Distance'].default_value=.19
    for name,value in zip(polish,saved_polish):
        floor.inputs[name].default_value=value
# The same retopologized shell supplies the game and offline inspection grid.
source = Path(__file__).resolve().parents[2]/'src/race/assets/jgp26-wire-shell.json.gz'
cage = json.loads(gzip.decompress(source.read_bytes()))
shell = bpy.data.objects['Chassis_TwoToneCover']
inspection = bpy.data.meshes.new('Inspection shell quads')
inspection.from_pydata([[v/10000 for v in p] for p in cage['points']],[],cage['faces'])
inspection.update()
inspection.materials.append(clay)
for poly in inspection.polygons:
    poly.use_smooth = True
shell.data = inspection
# Recover quad face boundaries before drawing the inspection grid. The
# renderer triangulates every face internally, so its wire shader also
# draws diagonals across originally four-sided panels.
for obj in scene.objects:
    if obj.type != 'MESH' or obj.name == 'Graphite floor' or obj.hide_render:
        continue
    if obj.name.startswith(('ConformalDecals_', 'NumberA_', 'NumberB_')) or obj.name.endswith(('_MarkWhite','_BrandBlue','_BrandGold','_CompoundInk')):
        obj.hide_render = True
        continue
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    tyre=obj.name.endswith(('_SlickRubber','_Rubber')) and obj.parent and obj.parent.name in ('FrontL','FrontR','RearL','RearR')
    dish=obj.name.endswith('_WheelDish')
    floor_grid=obj.name=='Floor_Carbon'
    if obj==shell or tyre or dish or obj.name in ('Floor_Carbon','Chassis_AeroLaminate','Chassis_Upper flap laminate','Chassis_FrontFenceLaminate','Chassis_RearAero','DRS_Carbon'):
        bmesh.ops.triangulate(bm,faces=list(bm.faces),quad_method='FIXED')
        if tyre or dish or floor_grid:
            # Subdivide the inspection copy after its rest geometry is loaded.
            # The render and game draw the same rows inside each surface triangle.
            bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=2 if dish else 1,use_grid_fill=True)
    else:
        triangles=[face for face in bm.faces if len(face.verts)==3]
        bmesh.ops.join_triangles(bm,faces=triangles,angle_face_threshold=.31,
                                angle_shape_threshold=.72,cmp_seam=True)
    uv = bm.loops.layers.uv.new('Inspection coordinates')
    for face in bm.faces:
        corners = ([(2,0),(3,0),(2,1)] if len(face.loops)==3 else
                   [(0,0),(1,0),(1,1),(0,1)] if len(face.loops)==4 else None)
        for i,loop in enumerate(face.loops):
            loop[uv].uv = corners[i] if corners else (.5,.5)
    bm.to_mesh(obj.data)
    bm.free()
    if tyre:
        section=obj.data.attributes.new('Tyre section radius','FLOAT','POINT')
        section.data.foreach_set('value',[hypot(v.co.y,v.co.z) for v in obj.data.vertices])
nodes = clay.node_tree.nodes
links = clay.node_tree.links
coords = nodes.new('ShaderNodeUVMap')
coords.uv_map = 'Inspection coordinates'
xy = nodes.new('ShaderNodeSeparateXYZ')
links.new(coords.outputs[0],xy.inputs[0])
def calc(operation,a,b=None):
    node = nodes.new('ShaderNodeMath')
    node.operation = operation
    for i,input in enumerate([a,b]):
        if isinstance(input,(float,int)):
            node.inputs[i].default_value = input
        elif input is not None:
            links.new(input,node.inputs[i])
    return node.outputs[0]
u = calc('FRACT',xy.outputs['X'])
v = xy.outputs['Y']
quad = calc('MINIMUM',calc('SUBTRACT',1,u),calc('SUBTRACT',1,v))
tri = calc('SUBTRACT',calc('SUBTRACT',1,u),v)
diagonal = calc('GREATER_THAN',xy.outputs['X'],1.5)
opposite = calc('ADD',calc('MULTIPLY',diagonal,tri),calc('MULTIPLY',calc('SUBTRACT',1,diagonal),quad))
dist = calc('MINIMUM',calc('MINIMUM',u,v),opposite)
ink = calc('LESS_THAN',dist,.029)
ink.node.name='Wire edge width'
mix = nodes.new('ShaderNodeMixRGB')
mix.name='Inspection grid ink'
mix.inputs[1].default_value = (.046,.065,.077,1)
mix.inputs[2].default_value = (.64,.82,.93,1)
facing=nodes.new('ShaderNodeLayerWeight')
rim=nodes.new('ShaderNodeMixRGB')
rim.name='Wire facing tint'
rim.inputs[1].default_value=(.050,.073,.086,1)
rim.inputs[2].default_value=(.19,.26,.32,1)
links.new(facing.outputs['Facing'],rim.inputs[0])
fresnel=nodes.new('ShaderNodeFresnel')
fresnel.inputs['IOR'].default_value=1.44
edge_color=nodes.new('ShaderNodeMixRGB')
edge_color.name='Wire rim tint'
edge_color.inputs[2].default_value=(.41,.55,.65,1)
links.new(fresnel.outputs['Fac'],edge_color.inputs[0])
links.new(rim.outputs[0],edge_color.inputs[1])
links.new(edge_color.outputs[0],mix.inputs[1])
links.new(ink,mix.inputs[0])
# A light-emitting line keeps the grid legible on the unlit side of each panel.
emission = nodes.new('ShaderNodeEmission')
links.new(mix.outputs[0],emission.inputs['Color'])
emission.inputs['Strength'].default_value=.65
links.new(mix.outputs[0],shader.inputs['Base Color'])
surface = nodes.new('ShaderNodeMixShader')
transparent = nodes.new('ShaderNodeBsdfTransparent')
line_coverage=calc('MULTIPLY',ink,.41)
line_coverage.node.name='Edge opacity increment'
panel_coverage=calc('ADD',.58,line_coverage)
panel_coverage.node.name='Panel opacity'
links.new(panel_coverage,surface.inputs[0])
links.new(transparent.outputs[0],surface.inputs[1])
links.new(emission.outputs[0],surface.inputs[2])
links.new(surface.outputs[0],nodes.get('Material Output').inputs['Surface'])
# The smooth-sided nose is darker between the fine edges in frame 007.
nose_wire=clay.copy()
nose_wire.node_tree.nodes.get('Emission').inputs['Strength'].default_value=.45
shell.data.materials.append(nose_wire)
for face in shell.data.polygons:
    if face.center.z>.62:face.material_index=1
# The outer rubber and dished wheel cover occlude their brake hardware.
wheel_finish=clay.copy()
wheel_mix=wheel_finish.node_tree.nodes['Inspection grid ink']
wheel_finish.node_tree.links.remove(wheel_mix.inputs[1].links[0])
wheel_mix.inputs[1].default_value=(.15,.20,.24,1)
wheel_mix.inputs[2].default_value=(.76,.86,.93,1)
wheel_surface=next(n for n in wheel_finish.node_tree.nodes if n.type=='MIX_SHADER')
wheel_finish.node_tree.links.new(wheel_finish.node_tree.nodes.get('Principled BSDF').outputs[0],wheel_surface.inputs[2])
wheel_finish.node_tree.links.remove(wheel_surface.inputs[0].links[0])
wheel_surface.inputs[0].default_value=.94
# Flatten the studio response across the opaque part of the tyre while retaining
# its radial curvature and the visibility of the far shoulder through the side.
wheel_shade=wheel_finish.node_tree.nodes.new('ShaderNodeMixShader')
wheel_shade.inputs[0].default_value=.58
wheel_finish.node_tree.links.new(wheel_finish.node_tree.nodes.get('Principled BSDF').outputs[0],wheel_shade.inputs[1])
wheel_finish.node_tree.links.new(wheel_finish.node_tree.nodes.get('Emission').outputs[0],wheel_shade.inputs[2])
wheel_finish.node_tree.links.new(wheel_shade.outputs[0],wheel_surface.inputs[2])
cover_finish=wheel_finish.copy()
cover_mix=cover_finish.node_tree.nodes['Inspection grid ink']
cover_mix.inputs[1].default_value=(.36,.44,.50,1)
cover_mix.inputs[2].default_value=(.57,.68,.75,1)
# The bead seat and shoulder courses are the two high-contrast circumferential
# rows in the wire shot. The rest radius follows the rubber in the release pose.
rubber_tree=wheel_finish.node_tree
section=rubber_tree.nodes.new('ShaderNodeAttribute')
section.attribute_name='Tyre section radius'
courses=rubber_tree.nodes.new('ShaderNodeValToRGB')
ramp=courses.color_ramp
for radius in (.266,.351):
    for offset,strength in [(-.002,0.),(-.0006,.76),(.0006,.76),(.002,0.)]:
        ramp.elements.new(radius+offset).color=(strength,strength,strength,1)
ramp.elements[-1].color=(0,0,0,1)
rubber_tree.links.new(section.outputs['Fac'],courses.inputs[0])
course_ink=rubber_tree.nodes.new('ShaderNodeMath');course_ink.operation='MAXIMUM'
rubber_tree.links.new(wheel_mix.inputs[0].links[0].from_socket,course_ink.inputs[0])
rubber_tree.links.new(courses.outputs[0],course_ink.inputs[1])
rubber_tree.links.new(course_ink.outputs[0],wheel_mix.inputs[0])
for obj in scene.objects:
    if obj.type=='MESH' and obj.name.startswith(('FrontL_','FrontR_','RearL_','RearR_')) and obj.name.endswith(('_SlickRubber','_Rubber','_WheelDish')):
        for slot in obj.material_slots:
            slot.material=cover_finish if obj.name.endswith('_WheelDish') else wheel_finish
# The video resolves the rows on the far side of the floor through the near skin.
floor_wire=clay.copy()
def floor_opacity(face,edge):
    tree=floor_wire.node_tree
    tree.nodes['Panel opacity'].inputs[0].default_value=face
    tree.nodes['Edge opacity increment'].inputs[1].default_value=edge-face
for slot in floor_mesh.material_slots:slot.material=floor_wire
fence_wire=clay.copy()
fence_wire.node_tree.nodes['Panel opacity'].inputs[0].default_value=.96
fence_wire.node_tree.nodes['Edge opacity increment'].inputs[1].default_value=.04
fence_wire.node_tree.nodes['Wire facing tint'].inputs[2].default_value=(.027,.044,.054,1)
fence_wire.node_tree.nodes['Wire facing tint'].inputs[1].default_value=(.007,.011,.014,1)
for slot in bpy.data.objects['Floor_FloorFence'].material_slots:slot.material=fence_wire
floor_opacity(.76,.96)
floor_wire.node_tree.nodes['Emission'].inputs['Strength'].default_value=.45
floor_wire.node_tree.nodes['Wire edge width'].inputs[1].default_value=.024
# In the assembled shot the grid remains bright through the translucent panels.
for material,strength in ((clay,0.5684),(nose_wire,.67)):
    tree=material.node_tree
    tree.nodes['Panel opacity'].inputs[0].default_value=0.8172 if material==nose_wire else 0.1316
    tree.nodes['Edge opacity increment'].inputs[1].default_value=0.1728 if material==nose_wire else 0.8584
    tree.nodes['Wire edge width'].inputs[1].default_value=0.0260 if material==nose_wire else .028
    tree.nodes['Wire facing tint'].inputs[2].default_value=(.1924,.26,.312,1)
    tree.nodes['Wire rim tint'].inputs[2].default_value=(.3362,.41,.4797,1)
    tree.nodes['Emission'].inputs['Strength'].default_value=strength
for finish_material in (floor_wire,nose_wire):
    facing=finish_material.node_tree.nodes['Wire facing tint']
    facing.inputs[1].default_value=(.009,.015,.019,1)
    facing.inputs[2].default_value=(.067,.097,.12,1)
floor.inputs['Base Color'].default_value=(.004,.0064,.0088,1)
stage_metal=floor.inputs['Metallic'].default_value
stage_specular=floor.inputs['Specular IOR Level'].default_value
floor.inputs['Metallic'].default_value=.30
floor.inputs['Specular IOR Level'].default_value=.80
floor.inputs['Emission Strength'].default_value=.35
floor.inputs['Roughness'].default_value=.155
floor.inputs['IOR'].default_value=2.80
finish='wireframe'
ports=bpy.data.objects.get('Chassis_PortRecess')
if ports:
    port_material=bpy.data.materials['PortRecess']
    for slot in ports.material_slots:slot.material=port_material
# The assembled fairing occludes the radiator and cockpit structures.
body_wire=clay.copy()
body_tree=body_wire.node_tree
body_tree.nodes['Panel opacity'].inputs[0].default_value=0.2520
body_tree.nodes['Edge opacity increment'].inputs[1].default_value=0.7380
body_tree.nodes['Emission'].inputs['Strength'].default_value=.82
body_tree.nodes['Wire edge width'].inputs[1].default_value=.020
shell.data.materials[0]=body_wire
# Preserve the luminous grid while studio light reveals the curved body beneath it.
def studio_response(material,weight):
    tree=material.node_tree
    output=next(node for node in tree.nodes if node.type=='MIX_SHADER')
    response=tree.nodes.new('ShaderNodeMixShader')
    response.inputs[0].default_value=weight
    tree.links.new(tree.nodes['Emission'].outputs[0],response.inputs[1])
    tree.links.new(tree.nodes['Principled BSDF'].outputs[0],response.inputs[2])
    tree.links.new(response.outputs[0],output.inputs[2])
    return response
studio_response(body_wire,0.3900)
hardware_response=studio_response(clay,.12)
render('wireframe')
breakdown_wires=[k for k,v in review_views.items() if v['pose'] in ('exploded','breakdown')]
if matrix_dir:matrix_views([k for k in review_views if k not in ('hero','diffuser-wire') and k not in breakdown_wires])
render('diffuser-wire')
shell.data.materials[0]=clay
floor.inputs['Metallic'].default_value=stage_metal
floor.inputs['Specular IOR Level'].default_value=stage_specular
hardware_response.inputs[0].default_value=0
floor_wire.node_tree.nodes['Emission'].inputs['Strength'].default_value=.65
floor_wire.node_tree.nodes['Wire edge width'].inputs[1].default_value=.029
# Frame 020 flattens the wheel-cover and tyre shading in the exploded shot.
wheel_finish.node_tree.links.new(wheel_finish.node_tree.nodes.get('Emission').outputs[0],wheel_surface.inputs[2])
wheel_finish.node_tree.links.new(wheel_finish.node_tree.nodes.get('Principled BSDF').outputs[0],wheel_surface.inputs[1])
wheel_surface.inputs[0].default_value=.48
wheel_emission=wheel_finish.node_tree.nodes.get('Emission')
wheel_emission.inputs['Strength'].default_value=.86
wheel_mix.inputs[1].default_value=(.39,.49,.55,1)
wheel_mix.inputs[2].default_value=(.52,.64,.71,1)
cover_mix.inputs[1].default_value=(.44,.53,.57,1)
cover_mix.inputs[2].default_value=(.62,.70,.74,1)
# Keep the panel grids readable in the half-tone breakdown.
for material in (clay,nose_wire):
    tree=material.node_tree
    tree.nodes['Panel opacity'].inputs[0].default_value=.58
    tree.nodes['Edge opacity increment'].inputs[1].default_value=.41
    tree.nodes['Wire edge width'].inputs[1].default_value=.029
    tree.nodes['Wire facing tint'].inputs[2].default_value=(.19,.26,.32,1)
    tree.nodes['Wire rim tint'].inputs[2].default_value=(.41,.55,.65,1)
floor.inputs['Base Color'].default_value=(.005,.008,.011,1)
floor.inputs['Emission Strength'].default_value=.8
floor_opacity(.12,.70)
floor.inputs['Roughness'].default_value=.115
floor.inputs['IOR'].default_value=2.55
for material in (clay,nose_wire,floor_wire):
    material.node_tree.nodes.get('Emission').inputs['Strength'].default_value=0.82
if matrix_dir:matrix_views(breakdown_wires)
elif not selected_views or 'parts' in selected_views:
    explode(28,wire_breakdown=True)
    render('parts',(-1,1.10,.27),(0,.48,.01),8.80)
