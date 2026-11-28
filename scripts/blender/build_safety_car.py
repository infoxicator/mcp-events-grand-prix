"""A section-lofted GT safety car. Y up, longitudinal axis +Z as in build_car."""
import bpy,gzip,tempfile,math
from mathutils import Vector, Matrix
from pathlib import Path
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
def material(name,col,metal,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1)
 p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if name in ("GT lacquer","Solar glazing"):
  p.inputs["Coat Weight"].default_value=.85;p.inputs["Coat Roughness"].default_value=.12
 return m
lacquer=material('GT lacquer',(.52,.026,.018),.54,.25)
glass=material('Solar glazing',(.023,.058,.085),.45,.12)
trim=material('Splitter graphite',(.025,.027,.029),.38,.37)
def loft(name,sections,mat):
 v=[];f=[]
 profile=[]
 for i in range(len(sections)-1):
  a,b,c,d=[sections[max(0,min(len(sections)-1,i+n))] for n in [-1,0,1,2]]
  for j in range(5):
   u=j/5
   profile.append(tuple(.5*(2*b[k]+(c[k]-a[k])*u+(2*a[k]-5*b[k]+4*c[k]-d[k])*u*u+(-a[k]+3*b[k]-3*c[k]+d[k])*u**3) for k in range(4)))
 for j,(z,w,belt,top) in enumerate(profile+[sections[-1]]):
  ring=[(-w*.94,belt),(-w,belt+.10),(-w*.96,top-.08),(-w*.72,top),(0,top+.016),(w*.72,top),(w*.96,top-.08),(w,belt+.10),(w*.94,belt)]
  for x,y in ring:v.append((x,y,z))
  if j:
   for k in range(9):
    a=(j-1)*9+k;b=(j-1)*9+(k+1)%9;f.append((a,b,b+9,a+9))
 f.extend([tuple(reversed(range(9))),tuple(range(len(v)-9,len(v)))])
 me=bpy.data.meshes.new(name);me.from_pydata(v,[],f);me.update()
 o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);me.materials.append(mat)
 for face in me.polygons:face.use_smooth=True
 return o
shell=loft('Coachwork',[(-2.34,.83,.34,.72),(-2.08,.95,.30,.87),(-1.52,1,.30,.94),(-.75,.94,.29,.93),(.65,.92,.29,.87),(1.49,.99,.30,.88),(2.13,.89,.28,.71),(2.38,.78,.32,.56)],lacquer)
loft('Panoramic coupe glazing',[(-1.45,.65,.85,.89),(-.94,.76,.87,1.23),(-.56,.77,.87,1.38),(.13,.76,.86,1.37),(.75,.79,.84,.91)],glass)
loft('Roof skin',[(-.80,.51,1.28,1.35),(-.45,.58,1.32,1.41),(.08,.58,1.31,1.40),(.19,.52,1.28,1.35)],lacquer)
sill=loft('Venturi sill',[(-2.32,.91,.19,.32),(-1.47,1.01,.18,.33),(1.58,.99,.18,.31),(2.40,.86,.18,.28)],trim)
def block(name,location,size,mat,radius=.009):
 bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=bpy.context.object;o.name=name;o.scale=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 bevel=o.modifiers.new('Pressed edge','BEVEL');bevel.width=radius;bevel.segments=2
 bpy.ops.object.modifier_apply(modifier=bevel.name);return o
def tube(name,a,b,r,mat):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=(b-a).length,location=(a+b)/2)
 o=bpy.context.object;o.name=name;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.data.materials.append(mat)
for z in (-1.49,1.49):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.354,depth=3,location=(0,.33,z),rotation=(0,math.pi/2,0))
 cutter=bpy.context.object
 for surface in [shell,sill]:
  boolean=surface.modifiers.new('Rolled wheel opening','BOOLEAN');boolean.operation='DIFFERENCE';boolean.object=cutter
  bpy.context.view_layer.objects.active=surface;bpy.ops.object.modifier_apply(modifier=boolean.name)
 bpy.data.objects.remove(cutter,do_unlink=True)
metal=material('Brushed alloy',(.36,.39,.41),.76,.31)
block('Front air intake',(0,.418,2.375),(1.27,.162,.066),trim,.036)
for i in range(-8,9):block('GT intake grille',(i*.066,.416,2.412),(.018,.12,.020),metal,.006)
for side in [-1,1]:
 tube('Windscreen pillar',(side*.60,1.34,.11),(side*.77,.87,.75),.038,lacquer)
 tube('Quarterlight frame',(side*.64,1.32,-.78),(side*.75,.89,-1.42),.03,lacquer)
 tube('Window divider',(side*.75,.9,-.48),(side*.72,1.33,-.46),.025,trim)
 tube('Mirror stalk',(side*.77,.96,.48),(side*.98,1.04,.42),.023,trim)
 block('Door mirror',(side*1.01,1.04,.41),(.16,.088,.19),lacquer,.035)
 block('Door handle',(side*.941,.827,-.69),(.025,.028,.14),metal)
 for j in range(3):block('Bonnet vent',(side*.52,.856-j*.009,1.32+j*.069),(.23,.023,.033),trim)
 block('Rear spoiler mount',(side*.55,.87,-2.02),(.07,.13,.17),trim)
block('Rear spoiler',(0,.951,-2.14),(1.63,.044,.205),trim,.013)
ink=material('Fleet lettering',(.94,.94,.89),.04,.42)
for location,normal,size in [((.945,.66,-.12),(1,0,0),.196),((-.945,.66,-.12),(-1,0,0),.196),((0,.61,-2.345),(0,0,-1),.122)]:
 n=Vector(normal);up=Vector((0,1,0));right=up.cross(n)
 bpy.ops.object.text_add(location=location)
 mark=bpy.context.object;mark.name='Safety car identification'
 mark.data.body='SAFETY CAR';mark.data.align_x='CENTER';mark.data.align_y='CENTER'
 mark.data.size=size;mark.data.resolution_u=4;mark.rotation_euler=Matrix((right,up,n)).transposed().to_euler()
 mark.data.materials.append(ink);bpy.ops.object.convert(target='MESH')
# Static components share batches, including the grille slats and door hardware.
for mat in bpy.data.materials:
 objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.active_material==mat]
 if len(objects)<2:continue
 bpy.ops.object.select_all(action='DESELECT')
 for obj in objects:obj.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
with tempfile.TemporaryDirectory() as tmp:
 raw=Path(tmp)/'gt.glb'
 bpy.ops.export_scene.gltf(filepath=str(raw),export_yup=False)
 (Path(__file__).resolve().parents[2]/'src/race/assets/safety-gt.glb.gz').write_bytes(gzip.compress(raw.read_bytes(),mtime=0))
