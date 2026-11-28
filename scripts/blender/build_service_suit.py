"""Weld the tailored service kit in an A-pose, transfer its skin, and sculpt flex correctives."""
import bpy, math, gzip,tempfile
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree
root=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(root/'scripts/blender/pit-equipment.blend'))
bpy.context.preferences.filepaths.save_version=0
verts=[];faces=[];samples=[];bones={'Core':(Vector((0,0,0)),Vector((0,.22,0)))}
bones['Chest']=(Vector((0,.22,0)),Vector((0,.49,0)))
bones['Neck']=(Vector((0,.49,0)),Vector((0,.55,0)))
limbs={}
def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)
def append(obj,anchor,direction,names=None,a=0,b=0):
    offset=len(verts);q=Vector((0,1,0)).rotation_difference(direction)
    artwork=obj.data.uv_layers.active
    uvByVertex={obj.data.loops[l].vertex_index:tuple(artwork.data[l].uv) for l in range(len(obj.data.loops))}
    weights=obj.data.color_attributes.active_color
    for i,v in enumerate(obj.data.vertices):
        p=Vector((v.co.x,v.co.z,-v.co.y));world=anchor+q@p
        chest=smooth((world.y-.14)/.16);neck=smooth((world.y-.45)/.08)
        mix={'Core':1-chest,'Chest':chest*(1-neck),'Neck':neck}
        if names:
            base=smooth((p.y+.045)/.126);joint=smooth((p.y-a+.078)/.156)
            mix={'Chest' if names[0].startswith('Arm') else 'Core':1-base,names[0]:base*(1-joint),names[1]:base*joint}
        verts.append(world);samples.append((mix,tuple(weights.data[i].color),uvByVertex.get(i,(.96,.327))))
    for f in obj.data.polygons:faces.append(tuple(offset+i for i in f.vertices))
append(bpy.data.objects['Torso'],Vector((0,0,0)),Vector((0,1,0)))
for side,tag in [(-1,'L'),(1,'R')]:
    for role,distal,anchor,axis,a,b in [('Arm','Fore',(.166,.425,0),(.68,-.725,.08),.31,.27),
                                      ('Leg','Shin',(.097,0,0),(.16,-.987,.02),.43,.43)]:
        anchor=Vector((side*anchor[0],anchor[1],anchor[2]));direction=Vector((side*axis[0],axis[1],axis[2])).normalized()
        joint=anchor+direction*a;names=(role+tag,distal+tag)
        bones[names[0]]=(anchor,joint);bones[names[1]]=(joint,joint+direction*b)
        limbs[names[0]]=(anchor,direction,a)
        append(bpy.data.objects[role],anchor,direction,names,a,b)
material=bpy.data.objects['Torso'].data.materials[0].copy()
for obj in list(bpy.context.scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
mesh=bpy.data.meshes.new('Continuous woven shell');mesh.from_pydata(verts,[],faces);mesh.update()
suit=bpy.data.objects.new('ServiceSuit',mesh);bpy.context.collection.objects.link(suit)
bpy.context.view_layer.objects.active=suit;suit.select_set(True)
# Keep pockets, belts and cuffs as the tailored source surfaces. Collapse the
# curved panels directly so thin seams survive the lower-detail skin.
simplify=suit.modifiers.new('Tailored race-distance panels','DECIMATE');simplify.ratio=.42
bpy.ops.object.modifier_apply(modifier=simplify.name)
mesh=suit.data;mesh.materials.clear();mesh.materials.append(material)
tree=KDTree(len(verts))
for i,v in enumerate(verts):tree.insert(v,i)
tree.balance()
arm=bpy.data.armatures.new('Pit service armature');rig=bpy.data.objects.new('Service skeleton',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
for name,(head,tail) in bones.items():
    bone=arm.edit_bones.new(name);bone.head=head;bone.tail=tail
bpy.ops.object.mode_set(mode='OBJECT');suit.parent=rig
mod=suit.modifiers.new('Eleven region suit skin','ARMATURE');mod.object=rig
groups={n:suit.vertex_groups.new(name=n) for n in bones}
colors=mesh.color_attributes.new(name='Fabric panels',type='BYTE_COLOR',domain='POINT')
uv=mesh.uv_layers.new(name='Fireproof fabric');coordinates=[]
for v in mesh.vertices:
    nearest=tree.find_n(v.co,7);sums={};total=0
    for _,idx,d in nearest:
        w=1/max(.00004,d*d);total+=w
        for n,weight in samples[idx][0].items():sums[n]=sums.get(n,0)+weight*w
    active=[(n,w) for n,w in sorted(sums.items(),key=lambda kv:-kv[1])[:4] if w/total>.0001];norm=sum(w for _,w in active)
    for n,w in active:groups[n].add([v.index],w/norm,'REPLACE')
    x,y,z=v.co;idx=nearest[0][1];c=samples[idx][1];shade=min(1.04,max(.87,.966+.037*math.sin(86*y+13*z+7*x)))
    # Tonal stretch fabric follows the side seam; a continuous gradient
    # avoids faceted patches when the elbow rolls or a knee bears weight.
    panel=smooth((abs(x)-.122)/.108)*smooth((.20-abs(y-.23))/.11) if abs(x)<.29 else 0
    val=.76*shade*(1-.40*panel)*(.38+.62*max(c[:3]))
    colors.data[v.index].color=(val,val*.985,val*.97,1)
    coordinates.append((.61+.35*((x*1.6+z*.45+.5)%1),1-(533+209*((y*.9+.31)%1))/768))
for loop in mesh.loops:uv.data[loop.index].uv=coordinates[loop.vertex_index]
for f in mesh.polygons:f.use_smooth=True
suit.shape_key_add(name='Basis')
for name,(anchor,direction,a) in limbs.items():
    key=suit.shape_key_add(name='Flex'+name)
    for i,v in enumerate(mesh.vertices):
        p=v.co-anchor;along=p.dot(direction);radial=p-direction*along
        if radial.length<.001 or radial.length>.14 or abs(along-a)>.15:continue
        # Preserve padded joint volume under linear skinning; gather the cloth
        # along the seam on each side of the bend.
        d=along-a;normal=radial.normalized()
        bulge=(.031 if name.startswith('Leg') else .020)*math.exp(-(d/.071)**2)
        fold=.0065*math.sin(d*95+normal.z*2.4)*math.exp(-(d/.11)**2)
        key.data[i].co+=normal*(bulge+fold)
bpy.context.view_layer.objects.active=suit
bpy.ops.wm.save_as_mainfile(filepath=str(root/'scripts/blender/service-suit.blend'))
with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/'suit.glb';bpy.ops.export_scene.gltf(filepath=str(path),export_yup=False,export_animations=False,export_vertex_color='ACTIVE',export_all_vertex_colors=True)
    (root/'src/race/assets/service-suit.glb.gz').write_bytes(gzip.compress(path.read_bytes(),mtime=0))
print('WELDED SUIT',len(mesh.vertices),'vertices',len(mesh.polygons),'polygons',len(bones),'bones')
