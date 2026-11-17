"""Original JGP-26 model. Run with Blender --background --python scripts/blender/build_car.py.
Coordinates deliberately use glTF axes: X lateral, Y up, +Z forward. Metres.
Reference: approved SF–26 clip; all marks are original fictional branding.
"""
import bpy, math, json, os, sys, gzip
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
bpy.context.preferences.filepaths.save_version=0
OUT=ROOT/'src/race/assets'; OUT.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
M={}
font_path=Path(os.environ.get('JGP_FONT','/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'))
brandfont=bpy.data.fonts.load(str(font_path)) if font_path.exists() else bpy.data.fonts.get('Bfont')
sidepods={}
def mat(name,hex,rough=.4,metal=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*[(int(hex[i:i+2],16)/255/12.92 if int(hex[i:i+2],16)/255<=.04045 else ((int(hex[i:i+2],16)/255+.055)/1.055)**2.4) for i in (0,2,4)],1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=m.diffuse_color; p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 M[name]=m;return m
paint=mat('Livery','cb091c',.4,.08);white=mat('Ivory','f4f3ef',.38,.03);carbon=mat('Carbon','15191e',.3,.22);rubber=mat('Rubber','101114',.85);metal=mat('Titanium','959ba2',.25,.85);black=mat('Cavity','030406',.7);red=mat('ButtonRed','da152c',.32);green=mat('ButtonGreen','23aa52',.32);blue=mat('ButtonBlue','155bd2',.32);yellow=mat('ButtonYellow','f1cb18',.32);silver=mat('MarkWhite','eeeef1',.46);brandblue=mat('BrandBlue','008ad3',.35);gold=mat('BrandGold','f4c01a',.4);screen=mat('Screen','030809',.27)
# Each animation group is batched by material at export.
groups={}
def group(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);groups[name]=o;return o
body=group('Chassis');decals=group('ConformalDecals');decals.parent=body;steer=group('Steering');steer.location=(0,.51,.16);flap=group('DRS');flap.location=(0,.87,-2.42)
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
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=10;cu.bevel_depth=r;cu.bevel_resolution=3;cu.use_fill_caps=True;s=cu.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
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
 f.append(tuple(reversed(range(n))))
 if 'sidepod' not in name.lower():f.append(tuple((len(ss)-1)*n+i for i in range(n)))
 if name=='Cockpit tub':f=[face for face in f if sum(v[i][1] for i in face)/len(face)<.36]
 o=mesh(name,v,f,m,parent)
 if name in ['Nose','Downwash sidepod','White airbox','Ground effect floor','Curved front endplate','Cockpit shoulder']:
  mod=o.modifiers.new('Sculpted continuous subdivision','SUBSURF');mod.levels=1
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def panel(name,outline,thickness,m,parent=body):
 # outline points in world XYZ; thickness along X for fins.
 v=[(x+side*thickness/2,y,z) for side in [-1,1] for x,y,z in outline];n=len(outline);f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)];return bevel(mesh(name,v,f,m,parent),.004,2)
def wing(name,span,z,y,chord,m,parent=body,sweep=.15,lift=.05):
 # Closed cambered aerofoil: cosine-spaced round leading edge, 0.6mm trailing edge.
 v=[];f=[];nx,n=48,24
 section=[]
 for side in [1,-1]:
  for j in range(n+1):
   u=(1-math.cos(math.pi*(j if side==1 else n-j)/n))/2
   thick=5*.105*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)*chord
   section.append((u,chord*.045*math.sin(math.pi*u)+side*(thick+.0003)))
 ns=len(section)
 for i in range(nx+1):
  x=(i/nx-.5)*span;t=abs(x)/(span/2)
  for u,h in section:v.append((x,y+lift*t*t+h,z+(.5-u)*chord-sweep*t*t))
 for i in range(nx):
  for j in range(ns):a=i*ns+j;b=i*ns+(j+1)%ns;f.append((a,b,b+ns,a+ns))
 f.extend([tuple(reversed(range(ns))),tuple(nx*ns+j for j in range(ns))])
 return bevel(mesh(name,v,f,m,parent),.0007,2)
def text(label,pos,size,m=silver,rotation=(0,0,0),parent=body):
 cu=bpy.data.curves.new('Mark '+label,'FONT');cu.body=label;cu.font=brandfont;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.shear=.14 if label in ['44','23','NOVA','NEXUS'] else 0;cu.extrude=.00015;cu.offset=.0006 if len(label)==1 else 0;cu.resolution_u=3
 o=bpy.data.objects.new('Mark '+label,cu);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=rotation;o.data.materials.append(m);o.parent=parent;return o
mirror=mat('Mirror','b8c4cc',.08,.9)
# Thin floor and sculpted venturi channels, curled edge rails, rear diffuser.
floor=group('Floor');floor.parent=body
sections=interp([[-2.7,.62,.1,.30],[-2.15,.77,.075,.13],[-1.25,.88,.065,.105],[.35,.89,.065,.105],[.9,.63,.09,.13]],8)
vv=[];ff=[];N=24
for bottom in [False,True]:
 for z,w,bot,top in sections:
  for i in range(N+1):
   u=i/N*2-1;vv.append((u*w,bot if bottom else top+.014*abs(u)**12,z))
stride=N+1;layer=len(sections)*stride
for j in range(len(sections)-1):
 for i in range(N):
  k=j*stride+i;ff.append((k,k+stride,k+stride+1,k+1));ff.append((layer+k+1,layer+k+stride+1,layer+k+stride,layer+k))
 for i in [0,N]:
  k=j*stride+i;ff.append((k,layer+k,layer+k+stride,k+stride))
for j in [0,len(sections)-1]:
 for i in range(N):k=j*stride+i;ff.append((k,k+1,layer+k+1,layer+k))
mesh('Continuous floor shell',vv,ff,carbon,floor)

for s in [-1,1]:
 curve('Rolled floor edge',[(s*.62,.3,-2.65),(s*.83,.13,-1.8),(s*.91,.14,-.7),(s*.92,.13,.25),(s*.78,.17,.76)],.017)
 for j in range(3):
  curve('Wavy floor fence',[(s*(.82+j*.027),.11,-1.8),(s*(.86+j*.025),.16,-1.15),(s*(.88+j*.02),.105,-.5),(s*(.85+j*.025),.15,.26)],.009)
 for i in range(3):panel('Floor inlet fence',[(s*(.43+i*.13),.11,.9),(s*(.48+i*.13),.25,.63),(s*(.5+i*.13),.13,.12)],.012,carbon)
for x in [-.6,-.4,-.2,0,.2,.4,.6]:panel('Diffuser strake',[(x,.07,-2.72),(x,.33,-2.72),(x,.14,-2.05),(x,.07,-1.9)],.012,carbon)
# Raised tapering nose; no box-shaped body.
loft('Nose',[ [.34,0,.33,.22,.64],[.75,0,.32,.22,.62],[1.2,0,.24,.23,.52],[1.85,0,.155,.22,.39],[2.5,0,.10,.17,.27],[2.86,0,.055,.15,.21],[2.9,0,.018,.17,.19]],paint,power=.84)
loft('Cockpit tub',[[-1.05,0,.3,.17,.49],[-.5,0,.39,.17,.49],[.35,0,.33,.2,.5]],carbon)
# Opaque carbon inner tub surfaces and front bulkhead, independent of outer paint.
for side in [-1,1]:
 mesh('Cockpit carbon liner',[(side*.275,.18,-.78),(side*.275,.63,-.78),(side*.275,.61,.32),(side*.275,.18,.32)],[(0,1,2,3)],carbon)
mesh('Carbon pedal bulkhead',[(-.28,.17,.325),(-.28,.625,.325),(.28,.625,.325),(.28,.17,.325)],[(0,1,2,3)],carbon)
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
 sidepods[s]=loft('Downwash sidepod',[[-2.03,s*.25,.035,.23,.3],[-1.55,s*.39,.13,.23,.38],[-1.0,s*.49,.23,.26,.48],[-.45,s*.53,.285,.31,.59],[.05,s*.55,.29,.39,.63],[.27,s*.55,.27,.43,.63],[.43,s*.55,.23,.475,.605],[.48,s*.55,.205,.49,.595]],paint,power=.84)
 # Wide, shallow aperture with rolled lip.
 # A true letterbox tunnel, sharply rolled upper lip and recessed throat.
 pts=[]
 for j in range(48):
  a=j*math.tau/48;c,t=math.cos(a),math.sin(a)
  pts.append((math.copysign(abs(c)**.6,c)*.207,math.copysign(abs(t)**.65,t)*.043))
 vv=[]
 for depth,scale in [(0,1.08),(.008,1),(-.13,.80)]:
  for x,y in pts:vv.append((s*.55+x*scale,.548+y*scale,.493+depth))
 ff=[]
 for k in range(2):
  for j in range(48):ff.append((k*48+j,k*48+(j+1)%48,(k+1)*48+(j+1)%48,(k+1)*48+j))
 mesh('Continuous rolled inlet lip',vv,ff,carbon)
 # White shoulder fairing blends the cockpit edge into the red downwash body.
 loft('Cockpit shoulder',[[-1.33,s*.25,.045,.39,.48],[-.95,s*.32,.13,.46,.58],[-.45,s*.385,.145,.60,.635],[.02,s*.405,.13,.615,.645],[.28,s*.39,.09,.59,.62],[.46,s*.34,.025,.55,.585]],white,power=.9)
 box('Deep intake throat',(s*.55,.548,.345),(.36,.065,.005),black,r=.012)
 # Rolled tunnel already supplies the lip; no overlapping trim curve.
 for i in range(7):box('Cooling louvre',(s*.49,.55-i*.009,-.48-i*.07),(.19,.009,.022),black,r=.003)
 curve('Mirror stay',[(s*.3,.62,.29),(s*.48,.67,.37),(s*.65,.71,.36)],.011)
 box('Mirror shell',(s*.65,.71,.36),(.22,.063,.115),paint,r=.025);box('Mirror glass',(s*.65,.713,.299),(.175,.038,.004),mirror,r=.009)
 # Sidepod fictional sponsors in the reference positions.
 rot=(0,s*math.pi/2,0)
 text('NOVA', (s*.852,.48,-.3),.14,silver,rot)
 ellipsoid('Solar emblem',(s*.812,.445,-.72),(.003,.062,.069),gold)
 text('VOLT', (s*.73,.42,-1.08),.065,silver,rot)
 text('AEROLINK',(s*.318,.46,.78),.05,silver,rot)
# White airbox front, red engine cover, split white/red vertical fin.
loft('Red engine cover',[[-2.2,0,.12,.19,.47],[-1.7,0,.25,.20,.57],[-1.25,0,.29,.26,.73],[-.86,0,.24,.44,.94],[-.67,0,.16,.61,.99]],paint)
cover=bpy.data.objects['Red engine cover'];cover.data.materials.append(white)
for poly in cover.data.polygons:
 centre=sum((cover.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 if centre.z>-1.25:poly.material_index=1
mod=cover.modifiers.new('Paint boundary preserving subdivision','SUBSURF');mod.levels=1;bpy.context.view_layer.objects.active=cover;bpy.ops.object.modifier_apply(modifier=mod.name)
loft('White airbox',[[-.85,0,.185,.72,.99],[-.70,0,.16,.745,1.025],[-.60,0,.135,.77,1.025],[-.565,0,.11,.795,1.005]],white)
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
for i in range(4):wing('Front wing element '+str(i),1.99-i*.035,2.73-i*.145,.115+i*.028,.27 if i==0 else .20,carbon,sweep=.17,lift=.065)
for s in [-1,1]:
 loft('Curved front endplate',[[2.18,s*.94,.014,.14,.27],[2.42,s*.985,.012,.12,.26],[2.77,s*.97,.012,.12,.24],[2.9,s*.91,.012,.13,.19]],carbon,n=16)
 curve('Nose mounting pylon',[(s*.09,.21,2.52),(s*.13,.16,2.5)],.014)
 text('AURORA',(s*.62,.255,2.46),.09,silver,(-math.pi/2,0,math.pi))
 text('VOLT',(s*.87,.21,2.73),.065,silver,(-math.pi/2,0,math.pi))
# Rear wing, twin swan necks, actuator, two beam elements.
wing('Rear main plane',1.58,-2.42,.78,.34,carbon,sweep=.035,lift=.01)
wing('DRS flap',1.55,-.07,.02,.23,carbon,flap,sweep=.025,lift=.01)
for z,y in [(-2.28,.35),(-2.44,.405)]:wing('Beam wing',1.2,z,y,.15,carbon,sweep=.03,lift=.025)
for s in [-1,1]:
 panel('Rear endplate',[(s*.79,.46,-2.2),(s*.79,.72,-2.17),(s*.79,.88,-2.18),(s*.79,.95,-2.34),(s*.79,.96,-2.59),(s*.79,.85,-2.64),(s*.79,.68,-2.67),(s*.79,.57,-2.58),(s*.79,.49,-2.4)],.018,carbon)
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
v=[(x,y,z+d) for d in [-.018,.018] for x,y,z in outline];n=len(outline);bevel(mesh('Butterfly carbon plate',v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],carbon,steer),.003,3)
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
fabric=mat('GloveFabric','dedbd4',.87)
# Hands are Blender geometry, attached to the steering rig; hidden in the studio.
hands=group('Hands');hands.parent=steer
for side in [-1,1]:
 glove=ellipsoid('Gloved palm',(side*.195,-.026,-.055),(.043,.066,.036),fabric,hands)
 ellipsoid('Glove cuff',(side*.216,-.087,-.069),(.042,.035,.034),fabric,hands)
 curve('Suit forearm',[(side*.215,-.086,-.065),(side*.26,-.15,-.16),(side*.27,-.21,-.30)],.039,fabric,hands)
 for j in range(4):
  yy=.011-j*.024
  curve('Curled gloved finger',[(side*.21,yy,-.072),(side*.159,yy,-.065),(side*.145,yy,-.028),(side*.17,yy,.011)],.009,fabric,hands)
 curve('Gloved thumb',[(side*.186,-.063,-.073),(side*.136,-.035,-.075),(side*.13,-.015,-.048)],.013,fabric,hands)
 for j in range(3):curve('Glove stitched seam',[(side*(.19+j*.008),.009,-.09),(side*(.20+j*.008),-.058,-.085)],.0008,carbon,hands)
# Tyres with radial sidewall typography, dish covers and tiny fasteners.
for front in [True,False]:
 for s in [-1,1]:
  z=1.55 if front else -2.05;w=.305 if front else .405;x=s*(.835 if front else .795)
  # Upright, spaced ball joints and inboard pickup brackets (not one shared hub point).
  ux=x-s*.10
  rod('Upright',(ux,.22,z),(ux,.48,z),.029,metal,vertices=12)
  for yy in [.235,.46]:
   for dz in [-.33,.28]:
    pick=(s*(.24 if front else .18),yy,z+dz);joint=(ux,yy,z)
    rod('Carbon wishbone',pick,joint,.013)
    box('Pickup clevis',pick,(.052,.036,.07),metal,r=.007)
    rod('Pickup bolt',(pick[0]-.03,yy,z+dz),(pick[0]+.03,yy,z+dz),.009,metal,vertices=6)
   ellipsoid('Upright spherical joint',(ux,yy,z),(.027,.022,.025),metal)
  rod('Suspension pushrod',(s*.18,.56,z-.25),(ux,.25,z),.014)
  rod('Steering trackrod',(s*.18,.33,z+.22),(ux,.34,z+.08),.009)
  box('Brake duct scoop',(x-s*.17,.39,z+.16),(.085,.13,.13),carbon,r=.025)
  box('Brake duct opening',(x-s*.17,.40,z+.229),(.058,.087,.005),black,r=.015)
  pivot=group(('Front' if front else 'Rear')+('L' if s<0 else 'R'));pivot.location=(x,.36,z);wheelgroups.append(pivot)
  # Surface of revolution about X.
  def lathe(name,profile,m):
   vs=[];fs=[];steps=96
   for xx,r in profile:
    for i in range(steps):a=i*math.tau/steps;vs.append((xx,r*math.cos(a),r*math.sin(a)))
   for j in range(len(profile)-1):
    for i in range(steps):a=j*steps+i;b=j*steps+(i+1)%steps;fs.append((a,b,b+steps,a+steps))
   return mesh(name,vs,fs,m,pivot)
  lathe('Slick tyre',[(-w/2,.228),(-w*.52,.26),(-w*.525,.285),(-w*.49,.316),(-w*.43,.341),(-w*.34,.357),(-w*.2,.36),(0,.361),(w*.2,.36),(w*.34,.357),(w*.43,.341),(w*.49,.316),(w*.525,.285),(w*.52,.26),(w/2,.228)],rubber)
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
     o=text(ch,(side*w*.517,.303*math.cos(a),.303*math.sin(a)),.047,silver,parent=pivot)
     # local right tangent, up radial, normal outward.
     from mathutils import Matrix
     up=Vector((0,math.cos(a),math.sin(a)));normal=Vector((side,0,0));right=up.cross(normal)
     o.rotation_euler=Matrix((right,up,normal)).transposed().to_euler()
   for start in [1.05,4.2]:
    for j in range(10):
     a=start+j*.065;o=box('Sidewall segment',(side*w*.518,.306*math.cos(a),.306*math.sin(a)),(.001,.022,.010),silver,pivot);o.rotation_euler.x=a
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
# Fictional sidepod wordmarks follow the sculpted skin, never float off it.
for o in list(bpy.context.scene.objects):
 if o.type=='MESH' and o.name.startswith(('Mark NOVA','Mark VOLT')) and abs(o.location.x)>.5 and -1.6<o.location.z<0:
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.quads_convert_to_tris();bpy.ops.mesh.subdivide(number_cuts=3,smoothness=0);bpy.ops.object.mode_set(mode='OBJECT');o.parent=decals
  side=1 if o.location.x>0 else -1;mod=o.modifiers.new('Painted conformal wordmark','SHRINKWRAP');mod.target=sidepods[side];mod.wrap_method='PROJECT';mod.use_project_x=False;mod.use_project_y=False;mod.use_project_z=True;mod.use_positive_direction=False;mod.use_negative_direction=True;mod.offset=.004
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
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
# Merge glove skin at finger/palm intersections, retaining thin seams separately.
for o in list(hands.children):
 if o.type=='MESH' and o.data.materials[0].name=='GloveFabric':
  bpy.context.view_layer.objects.active=o
  rem=o.modifiers.new('Continuous glove fabric','REMESH');rem.mode='VOXEL';rem.voxel_size=.0035;rem.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=rem.name)
  sm=o.modifiers.new('Relax textile surface','SMOOTH');sm.factor=.8;sm.iterations=4;bpy.ops.object.modifier_apply(modifier=sm.name)
  for poly in o.data.polygons:poly.use_smooth=True
# Preserve curved painted skins and tyre shoulders; simplify small mechanical parts only.
for o in bpy.context.scene.objects:
 if o.type=='MESH' and o.parent!=floor and len(o.data.polygons)>500 and not any(m.name in ['Livery','Ivory','Rubber','GloveFabric'] for m in o.data.materials):
  d=o.modifiers.new('Optimised smooth production topology','DECIMATE');d.ratio=.57
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=d.name)
# Bake actual Cycles CPU occlusion into a shared packed UV atlas.
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.device='CPU';bpy.context.scene.cycles.samples=32
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.008);bpy.ops.object.mode_set(mode='OBJECT')
ao=bpy.data.images.new('JGP baked ambient occlusion',width=1024,height=1024);ao.generated_color=(1,1,1,1)
for m in M.values():
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=ao;m.node_tree.nodes.active=n
bpy.context.scene.render.bake.margin=4
bpy.ops.object.bake(type='AO',use_clear=True)
ao.filepath_raw=str(OUT/'jgp26-ao.png');ao.file_format='PNG';ao.save()
# Ground contact is a second real AO bake with the complete car present.
groundmat=mat('Contact bake','ffffff',1)
ground=mesh('Bake receiver',[(-2,-.005,-3.5),(-2,-.005,3.5),(2,-.005,3.5),(2,-.005,-3.5)],[(0,1,2,3)],groundmat,parent=None)
bpy.ops.object.select_all(action='DESELECT');ground.select_set(True);bpy.context.view_layer.objects.active=ground
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT')
# Explicit top-facing planar UV, suitable for the showroom floor plane.
uv=ground.data.uv_layers.active
for poly in ground.data.polygons:
 for li in poly.loop_indices:
  co=ground.data.vertices[ground.data.loops[li].vertex_index].co;uv.data[li].uv=(co.x/4+.5,.5-co.z/7)
contact=bpy.data.images.new('Baked ground contact',width=512,height=512);contact.generated_color=(1,1,1,1)
n=groundmat.node_tree.nodes.new('ShaderNodeTexImage');n.image=contact;groundmat.node_tree.nodes.active=n
bpy.ops.object.bake(type='AO',use_clear=True)
contact.filepath_raw=str(OUT/'jgp26-contact.png');contact.file_format='PNG';contact.save();bpy.data.objects.remove(ground,do_unlink=True)
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
sys.path.insert(0,str(Path(__file__).parent))
from pack_glb import pack
for level in ['high','low']:pack(OUT/f'jgp26-{level}.glb',OUT/f'jgp26-{level}.glb.gz')
(OUT/'daylight.hdr.gz').write_bytes(gzip.compress((OUT/'daylight.hdr').read_bytes(),mtime=0))
print('CAR_EXPORT_COMPLETE',tri)
