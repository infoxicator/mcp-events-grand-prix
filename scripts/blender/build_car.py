"""Original JGP-26 model. Run with Blender --background --python scripts/blender/build_car.py.
Coordinates deliberately use glTF axes: X lateral, Y up, +Z forward. Metres.
Reference: approved SF–26 clip; all marks are original fictional branding.
"""
import bpy, math, json
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
bpy.context.preferences.filepaths.save_version=0
OUT=ROOT/'src/race/assets'; OUT.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
M={}
def mat(name,hex,rough=.4,metal=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*[(int(hex[i:i+2],16)/255/12.92 if int(hex[i:i+2],16)/255<=.04045 else ((int(hex[i:i+2],16)/255+.055)/1.055)**2.4) for i in (0,2,4)],1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=m.diffuse_color; p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 M[name]=m;return m
paint=mat('Livery','cb091c',.4,.08);white=mat('Ivory','f4f3ef',.38,.03);carbon=mat('Carbon','15191e',.3,.22);rubber=mat('Rubber','101114',.85);metal=mat('Titanium','959ba2',.25,.85);black=mat('Cavity','030406',.7);red=mat('ButtonRed','da152c',.32);green=mat('ButtonGreen','23aa52',.32);blue=mat('ButtonBlue','155bd2',.32);yellow=mat('ButtonYellow','f1cb18',.32);silver=mat('MarkWhite','eeeef1',.46);brandblue=mat('BrandBlue','008ad3',.35);gold=mat('BrandGold','f4c01a',.4);screen=mat('Screen','030809',.27)
# Each animation group is batched by material at export.
groups={}
def group(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);groups[name]=o;return o
body=group('Chassis');steer=group('Steering');steer.location=(0,.58,.16);flap=group('DRS');flap.location=(0,.87,-2.42)
helmet=group('Helmet');numberA=group('NumberA');numberB=group('NumberB');wheelgroups=[]
def mesh(name,vs,fs,m,parent=body):
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(m);o.parent=parent
 for p in me.polygons:p.use_smooth=True
 return o
def bevel(o,r=.015,n=3):
 mod=o.modifiers.new('Rounded manufactured edges','BEVEL');mod.width=r;mod.segments=n
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in o.data.polygons:p.use_smooth=True
 mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def box(name,pos,size,m,parent=body,r=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);o.parent=parent
 if r:bevel(o,r)
 return o
def ellipsoid(name,pos,scale,m,parent=body,seg=32,rings=16):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=pos);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(m);o.parent=parent
 for f in o.data.polygons:f.use_smooth=True
 return o
def rod(name,a,b,r,m=carbon,parent=body,vertices=10):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.data.materials.append(m);o.parent=parent
 for f in o.data.polygons:f.use_smooth=True
 return o
def curve(name,pts,r,m=carbon,parent=body):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=10;cu.bevel_depth=r;cu.bevel_resolution=3;s=cu.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
 for p,co in zip(s.bezier_points,pts):p.co=co;p.handle_left_type=p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.data.materials.append(m);o.parent=parent;return o
def interp(sections,steps=6):
 out=[]
 for j in range(len(sections)-1):
  a,b,c,d=sections[max(0,j-1)],sections[j],sections[j+1],sections[min(len(sections)-1,j+2)]
  for k in range(steps):
   t=k/steps;out.append([.5*(2*b[i]+(-a[i]+c[i])*t+(2*a[i]-5*b[i]+4*c[i]-d[i])*t*t+(-a[i]+3*b[i]-3*c[i]+d[i])*t*t*t) for i in range(len(b))])
 return out+[sections[-1]]
def loft(name,sections,m,parent=body,n=32,power=.85):
 # sections: z, centreX, halfWidth, bottom, top; rounded superellipse.
 ss=interp(sections);v=[];f=[]
 for z,x,w,bot,top in ss:
  for i in range(n):
   a=2*math.pi*i/n;c,s=math.cos(a),math.sin(a);v.append((x+math.copysign(abs(c)**power,c)*w,(bot+top)/2+math.copysign(abs(s)**power,s)*(top-bot)/2,z))
 for j in range(len(ss)-1):
  for i in range(n):a=j*n+i;b=j*n+(i+1)%n;f.append((a,b,b+n,a+n))
 f.extend([tuple(reversed(range(n))),tuple((len(ss)-1)*n+i for i in range(n))]);return mesh(name,v,f,m,parent)
def panel(name,outline,thickness,m,parent=body):
 # outline points in world XYZ; thickness along X for fins.
 v=[(x+side*thickness/2,y,z) for side in [-1,1] for x,y,z in outline];n=len(outline);f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)];return bevel(mesh(name,v,f,m,parent),.004,2)
def wing(name,span,z,y,chord,m,parent=body,sweep=.15,lift=.05):
 v=[];f=[];nx,ny=48,12
 for i in range(nx+1):
  x=(i/nx-.5)*span;t=abs(x)/(span/2)
  for j in range(ny+1):
   u=j/ny;v.append((x,y+lift*t*t+.026*math.sin(u*math.pi)+.025*u,z+(u-.5)*chord-sweep*t*t))
 for i in range(nx):
  for j in range(ny):a=i*(ny+1)+j;f.append((a,a+1,a+ny+2,a+ny+1))
 o=mesh(name,v,f,m,parent);mod=o.modifiers.new('Thin carbon laminate','SOLIDIFY');mod.thickness=.006;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name);return o
def text(label,pos,size,m=silver,rotation=(0,0,0),parent=body):
 cu=bpy.data.curves.new('Mark '+label,'FONT');cu.body=label;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.shear=.14 if label in ['44','23','NOVA','NEXUS'] else 0;cu.extrude=.00015;cu.resolution_u=3
 o=bpy.data.objects.new('Mark '+label,cu);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=rotation;o.data.materials.append(m);o.parent=parent;return o
# Thin floor and sculpted venturi channels, curled edge rails, rear diffuser.
loft('Ground effect floor',[[-2.7,0,.62,.1,.32],[-2.15,0,.77,.075,.17],[-1.25,0,.88,.065,.105],[.35,0,.89,.065,.105],[.9,0,.63,.09,.13]],carbon,n=32)
for s in [-1,1]:
 curve('Rolled floor edge',[(s*.62,.3,-2.65),(s*.83,.13,-1.8),(s*.91,.14,-.7),(s*.92,.13,.25),(s*.78,.17,.76)],.017)
 for j in range(3):
  curve('Wavy floor fence',[(s*(.82+j*.027),.11,-1.8),(s*(.86+j*.025),.16,-1.15),(s*(.88+j*.02),.105,-.5),(s*(.85+j*.025),.15,.26)],.009)
 for i in range(3):panel('Floor inlet fence',[(s*(.43+i*.13),.11,.9),(s*(.48+i*.13),.25,.63),(s*(.5+i*.13),.13,.12)],.012,carbon)
for x in [-.6,-.4,-.2,0,.2,.4,.6]:panel('Diffuser strake',[(x,.07,-2.72),(x,.33,-2.72),(x,.14,-2.05),(x,.07,-1.9)],.012,carbon)
# Raised tapering nose; no box-shaped body.
loft('Nose',[ [.34,0,.33,.22,.64],[.75,0,.32,.22,.62],[1.2,0,.24,.23,.52],[1.85,0,.155,.22,.39],[2.5,0,.10,.17,.27],[2.86,0,.055,.15,.21],[2.9,0,.018,.17,.19]],paint,power=.62)
loft('Cockpit tub',[[-1.05,0,.3,.17,.49],[-.5,0,.39,.17,.49],[.35,0,.33,.2,.5]],carbon)
# Continuous thin white cockpit deck around a true open aperture.
v=[];f=[];N=64
for ring in range(3):
 for i in range(N):
  a=i*math.tau/N
  w,l,h=[(.255,.49,.65),(.395,.75,.635),(.40,.75,.56)][ring]
  v.append((math.cos(a)*w,h+.012*math.sin(a),-.21+math.sin(a)*l))
for j in range(2):
 for i in range(N):f.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
mesh('White cockpit deck',v,f,white)
for s in [-1,1]:

 loft('Inner carbon cockpit wall',[[-.8,s*.22,.03,.36,.65],[-.4,s*.285,.025,.36,.65],[.13,s*.285,.025,.35,.61]],carbon)
 # Sidepod undercut is distinct, visibly hollow forward of the red shoulder.
 loft('Carbon undercut',[[-1.95,s*.28,.07,.18,.28],[-1.3,s*.43,.18,.13,.35],[-.5,s*.48,.24,.17,.41],[.22,s*.47,.22,.24,.48]],carbon)
 loft('Downwash sidepod',[[-2.03,s*.25,.035,.23,.3],[-1.55,s*.39,.13,.23,.38],[-1.0,s*.49,.23,.26,.48],[-.45,s*.53,.285,.31,.59],[.05,s*.55,.29,.39,.66],[.38,s*.55,.25,.46,.65],[.48,s*.55,.20,.49,.6]],paint,power=.62)
 # Wide, shallow aperture with rolled lip.
 ellipsoid('Intake darkness',(s*.55,.543,.477),(.196,.045,.012),black)
 curve('Sidepod intake lip',[(s*.34,.57,.46),(s*.48,.608,.49),(s*.7,.599,.47),(s*.77,.56,.44)],.012,carbon)
 for i in range(7):box('Cooling louvre',(s*.49,.55-i*.009,-.48-i*.07),(.19,.009,.022),black,r=.003)
 curve('Mirror stay',[(s*.3,.62,.29),(s*.48,.67,.37),(s*.65,.71,.36)],.011)
 box('Mirror shell',(s*.65,.71,.36),(.22,.063,.115),paint,r=.025);box('Mirror glass',(s*.65,.713,.299),(.175,.038,.004),metal,r=.009)
 # Sidepod fictional sponsors in the reference positions.
 rot=(0,s*math.pi/2,0)
 text('NOVA', (s*.852,.48,-.3),.14,silver,rot)
 ellipsoid('Solar emblem',(s*.812,.445,-.72),(.003,.062,.069),gold)
 text('VOLT', (s*.73,.42,-1.08),.065,silver,rot)
 text('AEROLINK',(s*.318,.46,.78),.05,silver,rot)
# White airbox front, red engine cover, split white/red vertical fin.
loft('Red engine cover',[[-2.2,0,.05,.25,.4],[-1.7,0,.13,.28,.57],[-1.25,0,.20,.32,.73],[-.86,0,.22,.44,.94],[-.67,0,.16,.61,.99]],paint)
cover=bpy.data.objects['Red engine cover'];cover.data.materials.append(white)
for poly in cover.data.polygons:
 centre=sum((cover.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 if poly.index%32<16 and centre.z>-1.35:poly.material_index=1
loft('White airbox',[[-1.14,0,.16,.6,.85],[-.85,0,.205,.61,1.015],[-.63,0,.135,.76,1.025],[-.58,0,.105,.8,.99]],white)
ellipsoid('Air intake',(0,.9,-.565),(.092,.102,.015),black)
rod('Intake divider',(0,.802,-.54),(0,.995,-.54),.008)
panel('Red shark fin',[(0,.47,-2.19),(0,.87,-2.19),(0,.97,-1.26),(0,.56,-1.26)],.018,paint)
panel('White shark fin',[(0,.56,-1.27),(0,.97,-1.27),(0,1.015,-.88),(0,.73,-.88)],.02,white)
for s in [-1,1]:
 text('44',(s*.014,.765,-1.78),.19,silver,(0,s*math.pi/2,0),numberA)
 text('23',(s*.014,.765,-1.78),.19,silver,(0,s*math.pi/2,0),numberB)
 ellipsoid('Blue airbox badge',(s*.207,.87,-.85),(.003,.065,.075),brandblue)
 text('nx',(s*.211,.87,-.85),.065,silver,(0,s*math.pi/2,0))
 text('ION',(s*.38,.61,-.2),.058,black,(0,s*math.pi/2,0))
# Halo carbon arch, centre pillar, camera pod.
curve('Halo',[(-.32,.67,-.53),(-.37,.84,-.39),(-.34,.91,.1),(-.21,.91,.43),(0,.885,.58),(.21,.91,.43),(.34,.91,.1),(.37,.84,-.39),(.32,.67,-.53)],.031)
curve('Halo central pillar',[(0,.62,.68),(0,.74,.64),(0,.885,.58)],.029)
box('T camera',(0,1.056,-.72),(.28,.042,.058),carbon,r=.012)
# Main plane plus three cascading contoured flaps. All exposed carbon.
for i in range(4):wing('Front wing element '+str(i),1.99-i*.035,2.73-i*.145,.115+i*.039,.23 if i==0 else .18,carbon,sweep=.17,lift=.065)
for s in [-1,1]:
 loft('Curved front endplate',[[2.18,s*.94,.014,.14,.36],[2.42,s*.985,.012,.12,.32],[2.77,s*.97,.012,.12,.24],[2.9,s*.91,.012,.13,.19]],carbon,n=16)
 curve('Nose mounting pylon',[(s*.09,.21,2.52),(s*.13,.16,2.5)],.014)
 text('AURORA',(s*.62,.255,2.46),.09,silver,(-math.pi/2,0,math.pi))
 text('VOLT',(s*.87,.21,2.73),.065,silver,(-math.pi/2,0,math.pi))
# Rear wing, twin swan necks, actuator, two beam elements.
wing('Rear main plane',1.58,-2.42,.78,.34,carbon,sweep=.035,lift=.01)
wing('DRS flap',1.55,0,0,.23,carbon,flap,sweep=.025,lift=.01)
for z,y in [(-2.3,.35),(-2.4,.43)]:wing('Beam wing',1.2,z,y,.15,carbon,sweep=.03,lift=.025)
for s in [-1,1]:
 panel('Rear endplate',[(s*.79,.49,-2.18),(s*.79,.87,-2.18),(s*.79,.96,-2.59),(s*.79,.64,-2.66)],.018,carbon)
 curve('Swan neck rear support',[(s*.14,.3,-2.07),(s*.14,.61,-2.16),(s*.14,.91,-2.3),(s*.14,.91,-2.45),(s*.14,.81,-2.48)],.018)
 text('V-PULSE',(s*.803,.77,-2.41),.067,silver,(0,s*math.pi/2,0));text('PERIGEE',(s*.803,.68,-2.4),.043,silver,(0,s*math.pi/2,0))
box('DRS hydraulic pod',(0,.885,-2.3),(.065,.075,.19),carbon,r=.025);rod('DRS ram',(0,.88,-2.32),(0,.89,-2.46),.009,metal)
rod('Titanium exhaust',(0,.41,-2.25),(0,.41,-2.67),.052,metal,vertices=32);rod('Exhaust opening',(0,.41,-2.665),(0,.41,-2.675),.044,black,vertices=32)
box('Rain light',(0,.2,-2.72),(.085,.06,.015),red,r=.009)
# Driver can be hidden in driver's-eye camera.
ellipsoid('Suit shoulders',(0,.48,-.32),(.23,.13,.2),black,helmet)
ellipsoid('Helmet shell',(0,.76,-.34),(.145,.155,.16),white,helmet)
ellipsoid('Visor',(0,.78,-.201),(.13,.045,.025),black,helmet)
# Wheel accurate butterfly silhouette, front face towards driver (-Z).
outline=[(-.19,.065,0),(-.15,.105,0),(.11,.105,0),(.18,.07,0),(.205,-.04,0),(.16,-.12,0),(.1,-.105,0),(-.1,-.105,0),(-.17,-.12,0),(-.205,-.035,0)]
# Extrude silhouette along Z.
v=[(x,y,z+d) for d in [-.018,.018] for x,y,z in outline];n=len(outline);mesh('Butterfly carbon plate',v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],carbon,steer)
for s in [-1,1]:ellipsoid('Grip',(s*.178,-.023,-.005),(.039,.087,.035),rubber,steer)
box('Display',(0,.025,-.022),(.19,.112,.004),screen,steer,r=.008)
text('NEXUS', (0,.09,-.024),.029,silver,(0,math.pi,0),steer)
buttons=[(-.165,.073,blue,'R'),(-.116,.055,green,'N'),(-.125,.009,yellow,'+'),(-.12,-.041,red,'−'),(.116,.036,red,'P'),(.17,.052,yellow,'A'),(.126,-.016,blue,'+'),(.12,-.064,silver,'−')]
for x,y,m,label in buttons:
 x=-x
 rod('Button collar',(x,y,-.023),(x,y,-.032),.013,metal,steer,20);rod('Button cap',(x,y,-.032),(x,y,-.038),.010,m,steer,20);text(label,(x,y,-.039),.012,black,(0,math.pi,0),steer)
for x,y,m in [(-.067,-.066,green),(0,-.073,yellow),(.072,-.089,blue)]:
 x=-x
 rod('Rotary coloured ring',(x,y,-.02),(x,y,-.034),.025,m,steer,32);rod('Rotary dial',(x,y,-.035),(x,y,-.058),.021,black,steer,32)
 for i in range(20):
  a=i*math.tau/20;rod('Knurl',(x+.021*math.cos(a),y+.021*math.sin(a),-.036),(x+.021*math.cos(a),y+.021*math.sin(a),-.056),.0016,black,steer,5)
 box('Dial pointer',(x-.004,y+.009,-.059),(.003,.014,.001),silver,steer)
# Tyres with radial sidewall typography, dish covers and tiny fasteners.
for front in [True,False]:
 for s in [-1,1]:
  z=1.55 if front else -2.05;w=.305 if front else .405;x=s*(.835 if front else .795)
  for yy in [.23,.43]:
   for dz in [-.33,.28]:rod('Carbon wishbone',(s*.21,yy,z+dz),(x,.36,z),.012)
  rod('Suspension pushrod',(s*.18,.56,z-.25),(x,.38,z),.016);rod('Steering trackrod',(s*.18,.33,z+.22),(x,.34,z+.08),.009)
  pivot=group(('Front' if front else 'Rear')+('L' if s<0 else 'R'));pivot.location=(x,.36,z);wheelgroups.append(pivot)
  # Surface of revolution about X.
  def lathe(name,profile,m):
   vs=[];fs=[];steps=64
   for xx,r in profile:
    for i in range(steps):a=i*math.tau/steps;vs.append((xx,r*math.cos(a),r*math.sin(a)))
   for j in range(len(profile)-1):
    for i in range(steps):a=j*steps+i;b=j*steps+(i+1)%steps;fs.append((a,b,b+steps,a+steps))
   return mesh(name,vs,fs,m,pivot)
  lathe('Slick tyre',[(-w/2,.228),(-w/2,.29),(-w*.47,.325),(-w*.39,.352),(-w*.27,.36),(w*.27,.36),(w*.39,.352),(w*.47,.325),(w/2,.29),(w/2,.228)],rubber)
  for side in [-1,1]:
   xx=side*w/2
   lathe('Recessed black dish',[(xx,.231),(xx-side*.012,.224),(xx-side*.037,.19),(xx-side*.046,.12),(xx-side*.04,.04)],carbon)
   lathe('Rim lip',[(xx,.231),(xx+side*.003,.232),(xx+side*.004,.226),(xx,.224)],carbon)
   rod('Centre nut',(xx-side*.04,0,0),(xx+side*.015,0,0),.034,metal,pivot,6)
   rod('Nut red ring',(xx+side*.015,0,0),(xx+side*.023,0,0),.025,red,pivot,24)
   rod('Nut yellow centre',(xx+side*.024,0,0),(xx+side*.03,0,0),.013,yellow,pivot,20)
   # Plane text local X runs around sidewall; normal faces +/-X.
   for label,centre in [('PZ-RACE',0),('ZERO SLICK',math.pi)]:
    for i,ch in enumerate(label):
     a=centre+(i-(len(label)-1)/2)*.14
     o=text(ch,(xx+side*.004,.303*math.cos(a),.303*math.sin(a)),.043,silver,parent=pivot)
     # local right tangent, up radial, normal outward.
     from mathutils import Matrix
     up=Vector((0,math.cos(a),math.sin(a)));normal=Vector((side,0,0));right=up.cross(normal)
     o.rotation_euler=Matrix((right,up,normal)).transposed().to_euler()
   for start in [1.05,4.2]:
    for j in range(10):
     a=start+j*.065;o=box('Sidewall segment',(xx+side*.003,.306*math.cos(a),.306*math.sin(a)),(.001,.022,.010),silver,pivot);o.rotation_euler.x=a
   for j in range(8):
    a=j*math.tau/8;rod('Cover fastener',(xx,.216*math.cos(a),.216*math.sin(a)),(xx+side*.003,.216*math.cos(a),.216*math.sin(a)),.002,metal,pivot,6)
text('44',(0,.43,1.68),.22,silver,(-math.pi/2-.12,0,math.pi),numberA)
text('23',(0,.43,1.68),.22,silver,(-math.pi/2-.12,0,math.pi),numberB)
text('NEXUS',(0,.575,1.0),.09,silver,(-math.pi/2-.16,0,math.pi))
ellipsoid('Nose solar badge',(0,.335,2.14),(.064,.003,.065),gold)
# Convert curves, recompute outward normals, batch static parts per parent/material.
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.context.scene.objects):
 if o.type in {'FONT','CURVE'}:
  o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o.select_set(False)
for parent in list(groups.values()):
 buckets={}
 for o in list(parent.children):
  if o.type=='MESH':buckets.setdefault(o.data.materials[0].name if len(o.data.materials)==1 else 'TwoToneCover',[]).append(o)
 for name,objects in buckets.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_'+name
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
  # Generate metric UVs for a subtle carbon twill applied by the runtime.
  if name=='Carbon':
   bpy.ops.object.mode_set(mode='EDIT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')
# Store reproducible editable source and two self-contained LODs.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'scripts/blender/jgp26.blend'))
def export(name):
 bpy.ops.export_scene.gltf(filepath=str(OUT/name),export_format='GLB',export_yup=False,export_apply=True,export_cameras=False,export_lights=False)
export('jgp26-high.glb')
tri=sum(len(p.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for p in o.data.polygons)
for o in bpy.context.scene.objects:
 if o.type=='MESH' and len(o.data.polygons)>80:
  d=o.modifiers.new('Distance LOD','DECIMATE');d.ratio=.24
export('jgp26-low.glb')
(OUT/'jgp26-manifest.json').write_text(json.dumps({'source':'scripts/blender/build_car.py','highTriangles':tri,'dimensions':{'length':5.62,'width':2.0,'wheelbase':3.6,'bodyHeight':1.08},'lodDistanceMetres':32,'licence':'Original project asset; fictional branding'},indent=2)+'\n')
print('CAR_EXPORT_COMPLETE',tri)
