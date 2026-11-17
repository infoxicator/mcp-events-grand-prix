"""Original JGP-26 model. Run with Blender --background --python scripts/blender/build_car.py.
Coordinates deliberately use glTF axes: X lateral, Y up, +Z forward. Metres.
Reference: approved SF–26 clip; all marks are original fictional branding.
"""
import bpy, bmesh, math, json, os, sys, gzip
from mathutils import Vector
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from cockpit import build_halo, build_driver
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
body=group('Chassis');decals=group('ConformalDecals');decals.parent=body;steer=group('Steering');steer.location=(0,.57,.16);flap=group('DRS');flap.location=(0,.87,-2.42)
helmet=group('Helmet');helmet.location=(0,.025,.15);numberA=group('NumberA');numberB=group('NumberB');wheelgroups=[]
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
def wing(name,span,z,y,chord,m,parent=body,sweep=.15,lift=.05,side=0,root_width=0):
 # Closed cambered aerofoil: cosine-spaced round leading edge, 0.6mm trailing edge.
 v=[];f=[];nx,n=(24 if side else 38),18
 section=[]
 for surface in [1,-1]:
  for j in range(n+1):
   u=(1-math.cos(math.pi*(j if surface==1 else n-j)/n))/2
   thick=5*.086*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)*chord
   section.append((u,chord*.045*math.sin(math.pi*u)+surface*(thick+.0003)))
 ns=len(section)
 for i in range(nx+1):
  x=side*(root_width+(span/2-root_width)*i/nx) if side else (i/nx-.5)*span;t=abs(x)/(span/2)
  # The flaps twist outboard, relieving load near the endplate.
  front=name.startswith('Front')
  arch=math.sin(math.pi*t)**2
  local_chord=chord*(.68+.48*arch-.14*t*t if front and side else 1-.12*t*t)
  incidence=(.16+.11*arch-.10*t) if front else .12*(1-.58*t*t)
  for u,h in section:
   v.append((x,y+lift*t*t+h+(u-.35)*incidence*local_chord,
             z+(.5-u)*local_chord-sweep*t*t+(.030*arch if front else 0)))
 for i in range(nx):
  for j in range(ns):a=i*ns+j;b=i*ns+(j+1)%ns;f.append((a,b,b+ns,a+ns))
 f.extend([tuple(reversed(range(ns))),tuple(nx*ns+j for j in range(ns))])
 return bevel(mesh(name,v,f,m,parent),.0007,2)
def text(label,pos,size,m=silver,rotation=(0,0,0),parent=body):
 cu=bpy.data.curves.new('Mark '+label,'FONT');cu.body=label;cu.font=brandfont;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.shear=.14 if label in ['44','23','NOVA','NEXUS'] else 0;cu.extrude=0;cu.fill_mode='FRONT';cu.offset=.0006 if len(label)==1 else 0;cu.resolution_u=3
 o=bpy.data.objects.new('Mark '+label,cu);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=rotation;o.data.materials.append(m);o.parent=parent;return o
dish=mat('WheelDish','343a42',.29,.62);brake=mat('BrakeDisc','565859',.63,.45);sleeve=mat('Sleeve','60212b',.9)
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
loft('Nose',[ [.34,0,.33,.22,.64],[.75,0,.32,.22,.62],[1.2,0,.265,.23,.53],[1.85,0,.17,.22,.40],[2.5,0,.10,.17,.27],[2.86,0,.055,.15,.21],[2.9,0,.018,.17,.19]],paint,power=.84)
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
 sidepods[s]=loft('Downwash sidepod',[[-2.03,s*.25,.035,.23,.3],[-1.55,s*.365,.118,.22,.365],[-1.0,s*.46,.218,.245,.47],[-.65,s*.515,.267,.289,.555],[-.35,s*.545,.294,.345,.61],[.05,s*.55,.30,.40,.635],[.27,s*.55,.285,.42,.635],[.43,s*.55,.255,.47,.62],[.49,s*.55,.232,.49,.605]],paint,power=.84)
 # Wide, shallow aperture with rolled lip.
 # A true letterbox tunnel, sharply rolled upper lip and recessed throat.
 pts=[]
 for j in range(48):
  a=j*math.tau/48;c,t=math.cos(a),math.sin(a)
  pts.append((math.copysign(abs(c)**.52,c)*.232,math.copysign(abs(t)**.62,t)*.049))
 vv=[]
 for depth,scale in [(0,1.08),(.008,1),(-.13,.80)]:
  for x,y in pts:vv.append((s*.55+x*scale,.548+y*scale,.493+depth))
 ff=[]
 for k in range(2):
  for j in range(48):ff.append((k*48+j,k*48+(j+1)%48,(k+1)*48+(j+1)%48,(k+1)*48+j))
 mesh('Continuous rolled inlet lip',vv,ff,carbon)
 # White shoulder fairing blends the cockpit edge into the red downwash body.
 loft('Cockpit shoulder',[[-1.33,s*.25,.045,.39,.48],[-.95,s*.32,.145,.409,.588],[-.45,s*.385,.157,.465,.644],[.02,s*.405,.15,.494,.649],[.28,s*.39,.09,.59,.62],[.46,s*.34,.025,.55,.585]],white,power=.9)
 box('Deep intake throat',(s*.55,.548,.345),(.42,.078,.005),black,r=.012)
 # Rolled tunnel already supplies the lip; no overlapping trim curve.

 curve('Mirror stay',[(s*.3,.62,.29),(s*.48,.67,.37),(s*.65,.71,.36)],.011)
 loft('Mirror cowl',[[.298,s*.65,.096,.684,.731],[.308,s*.65,.108,.674,.742],[.36,s*.651,.105,.676,.744],[.409,s*.651,.085,.688,.730],[.427,s*.651,.062,.699,.717]],paint,n=24,power=.58)
 box('Mirror glass',(s*.65,.710,.295),(.175,.038,.004),mirror,r=.009)
 # Sidepod fictional sponsors in the reference positions.
 rot=(0,s*math.pi/2,0)
 text('NOVA', (s*.852,.48,-.3),.14,silver,rot)
 ellipsoid('Solar emblem',(s*.812,.445,-.72),(.003,.062,.069),gold)
 text('VOLT', (s*.73,.42,-1.08),.065,silver,rot)
 text('AEROLINK',(s*.318,.46,.78),.05,silver,rot)
# Continuous engine-cover cross section: a broad lower shoulder tapers into
# the fin without a second bulb sitting on top of the first one.
cover_stations=interp([[-2.21,.104,.20,.48],[-2.10,.153,.20,.62],[-1.88,.210,.20,.704],
                       [-1.67,.251,.21,.767],[-1.39,.292,.23,.849],[-1.15,.278,.29,.933],
                       [-.96,.251,.38,1.004],[-.84,.222,.46,1.069],[-.67,.150,.61,1.09]])
outline=[(0,0),(.58,.033),(.87,.125),(1,.28),(.92,.43),(.74,.55),(.55,.67),
         (.37,.78),(.21,.88),(.105,.95),(.05,.988),(0,1)]
profile=outline+[(-width,h) for width,h in reversed(outline[1:-1])]
vv=[(width*x,low+(high-low)*y,z) for z,width,low,high in cover_stations for x,y in profile]
count=len(profile)
ff=[(row*count+i,row*count+(i+1)%count,(row+1)*count+(i+1)%count,(row+1)*count+i)
    for row in range(len(cover_stations)-1) for i in range(count)]
ff.extend([tuple(reversed(range(count))),tuple(range(len(vv)-count,len(vv)))])
mesh('Red engine cover',vv,ff,paint)
cover=bpy.data.objects['Red engine cover'];cover.data.materials.append(white)
for poly in cover.data.polygons:
 centre=sum((cover.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 if centre.z>-1.25:poly.material_index=1
mod=cover.modifiers.new('Paint boundary preserving subdivision','SUBSURF');mod.levels=1;bpy.context.view_layer.objects.active=cover;bpy.ops.object.modifier_apply(modifier=mod.name)
loft('White airbox',[[-.95,0,.17,.70,1.00],[-.78,0,.15,.72,1.095],[-.63,0,.13,.755,1.125],[-.524,0,.112,.78,1.122]],white,power=.92)
# Reference 00:01: tall pear-shaped opening, upper duct and split lower passages.
# An actual recessed tunnel replaces the circular black disc; rim is carbon inside white skin.
aircontrols=[(-.077,.80),(-.101,.835),(-.088,.94),(-.063,1.065),(0,1.105),(.063,1.065),(.088,.94),(.101,.835),(.077,.80),(0,.787)]
# Resample the same smooth profile for the visible lip, throat and Boolean boundary.
airoutline=[]
for j in range(len(aircontrols)):
 a,b,c,d=[aircontrols[(j+k)%len(aircontrols)] for k in [-1,0,1,2]]
 for k in range(6):
  t=k/6;airoutline.append(tuple(.5*(2*b[i]+(-a[i]+c[i])*t+(2*a[i]-5*b[i]+4*c[i]-d[i])*t*t+(-a[i]+3*b[i]-3*c[i]+d[i])*t*t*t) for i in range(2)))
AN=len(airoutline)
airvs=[(x*scale,.945+(y-.945)*scale,z) for z,scale in [(-.532,1),(-.64,.88)] for x,y in airoutline]
mesh('Airbox deep duct',airvs,[(i,(i+1)%AN,(i+1)%AN+AN,i+AN) for i in range(AN)]+[tuple(range(AN,2*AN))],black)
curve('Carbon airbox lip',[(x,y,-.529) for x,y in aircontrols+[aircontrols[0]]],.006)
rod('Intake horizontal splitter',(-.09,.904,-.525),(.09,.904,-.525),.006)
for side in [-1,1]:curve('Lower intake divider',[(side*.038,.80,-.523),(side*.043,.85,-.523),(0,.904,-.523)],.0045)

panel('Red shark fin',[(0,.47,-2.19),(0,.87,-2.19),(0,.97,-1.26),(0,.56,-1.26)],.018,paint)
panel('White shark fin',[(0,.56,-1.27),(0,.97,-1.27),(0,1.015,-.88),(0,.73,-.88)],.02,white)
for s in [-1,1]:
 text('44',(s*.014,.785,-1.78),.30,silver,(0,s*math.pi/2,0),numberA)
 text('23',(s*.014,.785,-1.78),.30,silver,(0,s*math.pi/2,0),numberB)
 ellipsoid('Blue airbox badge',(s*.207,.87,-.85),(.003,.065,.075),brandblue)
 text('nx',(s*.211,.87,-.85),.065,silver,(0,s*math.pi/2,0))
 text('ION',(s*.38,.61,-.2),.058,black,(0,s*math.pi/2,0))
# Halo carbon arch, centre pillar, camera pod.
build_halo(mesh, interp, carbon, metal, black, rod)
box('T camera',(0,1.15,-.72),(.28,.042,.058),carbon,r=.012)
rod('Camera pedestal',(0,1.09,-.72),(0,1.14,-.72),.022)
# Main plane plus three cascading contoured flaps. All exposed carbon.
aero=mat('AeroLaminate','11141a',.52,.05)
front_elements=[]
front_elements.append(wing('Front mainplane',1.956,2.715,.100,.33,aero,sweep=.116,lift=.025))
for side in [-1,1]:
 for index,(z,y,chord) in enumerate([(2.562,.133,.227),(2.425,.167,.224),(2.305,.202,.200)]):
  front_elements.append(wing('Front flap '+str(index),1.956,z,y,chord,aero,
                             sweep=.131+index*.012,lift=.037+index*.008,side=side,root_width=.068+index*.035))
 # Slot-gap separators tie neighbouring flaps together at two span stations.
 for distance in [.40,.76]:
  for j in range(3):
   z=2.56-j*.123-.12*distance*distance
   panel('Flap slot bridge',[(side*distance,.101+j*.034,z+.035),(side*distance,.134+j*.034,z-.014),
         (side*distance,.148+j*.034,z-.022),(side*distance,.132+j*.034,z+.041)],.006,aero)
for s in [-1,1]:
 panel('Front wing end fence',[(s*.978,.112,2.815),(s*.978,.184,2.762),(s*.978,.248,2.39),
       (s*.978,.272,2.155),(s*.978,.263,2.035),(s*.978,.192,2.046),(s*.978,.122,2.232)],.013,aero)
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
# Seated driver, modelled in metres. The camera sees the crown from behind;
# the helmet is a shaped shell with an actual curved visor, not a white ball.
helmetpaint=mat('HelmetPaint','e9ed24',.31,.07)
helmetink=mat('HelmetInk','18212e',.4)
visor=mat('HelmetVisor','172029',.13,.65)
ellipsoid('Suit shoulders',(0,.49,-.35),(.235,.135,.20),sleeve,helmet)
ellipsoid('Neck balaclava',(0,.61,-.32),(.085,.085,.09),black,helmet)
shell=ellipsoid('Helmet shell',(0,.772,-.315),(.158,.178,.19),helmetpaint,helmet,seg=64,rings=32)
# Slightly flattened rear/chin and fuller brow, smoothly continuous shell.
for v in shell.data.vertices:
 if v.co.y<-.45:v.co.z+=.16*(-v.co.y-.45)
 if v.co.z<-.3:v.co.z*=.94
def helmet_band(name,lo,hi,material,start=-math.pi,end=math.pi):
 vs=[];fs=[];N=96
 rows=max(1,math.ceil((hi-lo)/.009))
 for row in range(rows+1):
  y=lo+(hi-lo)*row/rows
  r=math.sqrt(max(0,1-((y-.772)/.178)**2))
  for i in range(N+1):
   a=start+(end-start)*i/N
   vs.append((.1605*r*math.sin(a),y,-.315+.194*r*math.cos(a)))
 for row in range(rows):
  for i in range(N):
   k=row*(N+1)+i;fs.append((k,k+1,k+N+2,k+N+1))
 return mesh(name,vs,fs,material,helmet)
helmet_band('Curved visor glazing',.744,.829,visor,-1.42,1.42)
helmet_band('Visor upper seal',.829,.835,black,-1.44,1.44)
helmet_band('Visor lower seal',.739,.744,black,-1.44,1.44)
helmet_band('Lower shell binding',.650,.661,black)
helmet_band('Crown red pinline',.858,.864,paint)
helmet_band('Crown ivory pinline',.866,.870,silver)
for side in [-1,1]:
 rod('Visor hinge',(side*.152,.79,-.295),(side*.160,.79,-.295),.014,metal,helmet,16)
 rod('Hinge centre',(side*.160,.79,-.295),(side*.162,.79,-.295),.006,black,helmet,12)
 for i in range(3):box('Chin ventilation',(side*(.021+i*.017),.695,-.138),(.010,.007,.002),black,helmet,r=.002)
 # Rear-quarter painted streaks and recessed crown intake slots.
 curve('Helmet rear graphic',[(side*.10,.87,-.40),(side*.137,.80,-.414),(side*.106,.69,-.43)],.006,helmetink,helmet)
 vent=ellipsoid('Crown intake',(side*.065,.932,-.33),(.009,.004,.022),black,helmet,seg=24,rings=12)
# Crown marks are shrinkwrapped onto the compound curve, facing the T-camera.
for label,pos,size in [('NEXUS',(0,.966,-.344),.037),('44',(0,.949,-.407),.036),('23',(0,.949,-.407),.036)]:
 parent=helmet
 if label in ['44','23']:
  parent=group('HelmetNumberA' if label=='44' else 'HelmetNumberB');parent.parent=helmet
 o=text(label,pos,size,helmetink,(-math.pi/2,math.pi,0),parent)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o=bpy.context.object
 sw=o.modifiers.new('Crown decal conformity','SHRINKWRAP');sw.target=shell;sw.wrap_method='NEAREST_SURFACEPOINT';sw.offset=.001
 bpy.ops.object.modifier_apply(modifier=sw.name)
# Helmet graphics conform to the crown itself. Their sweeps converge at the
# back and split around the vents; each stripe is one thin curved surface.
for side in [-1,1]:
 for low,wide,ink in [(.33,.105,helmetink),(.455,.030,silver),(.51,.090,paint)]:
  vv=[];ff=[]
  for step in range(35):
   longitude=side*(.72+step/34*2.15)
   fade=math.sin(math.pi*step/34)**.65
   centre=low+.61*math.sin(math.pi*(step/34)*.89)
   for edge in [-1,1]:
    elevation=centre+edge*wide*fade
    vv.append((.1595*math.cos(elevation)*math.sin(longitude),.772+.1795*math.sin(elevation),
               -.315+.192*math.cos(elevation)*math.cos(longitude)))
   if step:ff.append((2*step-2,2*step-1,2*step+1,2*step))
  mesh('Swept helmet graphic',vv,ff,ink,helmet)
# The moulded seat and horseshoe head restraint remain visible in an empty
# showroom cockpit and shield the rear aperture around the suited driver.
seatmat=mat('SeatFoam','26282a',.95)
seatrows=interp([[-.715,.210,.617],[-.635,.236,.578],[-.493,.220,.412],
                 [-.365,.202,.289],[-.18,.183,.266],[.05,.150,.31]],4)
vv=[];ff=[]
for j,(z,width,h) in enumerate(seatrows):
 for k in range(19):
  x=k/9-1
  vv.append((width*x,h+.062*x*x,z))
  if j and k:
   a=j*19+k;ff.append((a-20,a-19,a,a-1))
mesh('Moulded bucket seat',vv,ff,seatmat)
for side in [-1,1]:
 loft('Energy absorbing headrest',[[-.775,side*.146,.028,.597,.675],[-.67,side*.190,.057,.60,.697],
      [-.48,side*.227,.044,.589,.693],[-.31,side*.245,.032,.602,.673],[-.215,side*.252,.017,.610,.649]],seatmat,n=18,power=.67)
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
 rod('Button collar',(x,y,-.023),(x,y,-.032),.013,metal,steer,20);rod('Button cap',(x,y,-.032),(x,y,-.038),.010,m,steer,20);text(label,(x,y,-.039),.012,silver if m==blue else black,(0,math.pi,0),steer)
for x,y,m in [(-.067,-.066,green),(0,-.073,yellow),(.072,-.089,blue)]:
 x=-x
 rod('Rotary coloured ring',(x,y,-.02),(x,y,-.034),.025,m,steer,32);rod('Rotary dial',(x,y,-.035),(x,y,-.058),.021,black,steer,32)
 for i in range(20):
  a=i*math.tau/20;rod('Knurl',(x+.021*math.cos(a),y+.021*math.sin(a),-.036),(x+.021*math.cos(a),y+.021*math.sin(a),-.056),.0016,black,steer,5)
 box('Dial pointer',(x-.004,y+.009,-.059),(.003,.014,.001),silver,steer)
for side in [-1,1]:
 paddle=panel('Shift paddle',[(side*.105,-.072,.052),(side*.15,-.056,.060),(side*.17,.035,.055),(side*.125,.052,.048)],.007,carbon,steer)
 rod('Paddle hinge',(side*.095,-.035,.034),(side*.095,.025,.034),.006,metal,steer,12)
 rod('Paddle linkage',(side*.095,0,.034),(side*.13,0,.055),.004,metal,steer,8)
 text('−' if side>0 else '+',(side*.145,.018,.063),.018,silver,parent=steer)
for x,y in [(.067,-.066),(0,-.073),(-.072,-.089)]:
 for i in range(9):
  a=(i/8*1.5+.25)*math.pi
  rod('Rotary index tick',(x+.029*math.cos(a),y+.029*math.sin(a),-.024),(x+.032*math.cos(a),y+.032*math.sin(a),-.024),.00055,silver,steer,4)
fabric=mat('GloveFabric','d6d3c9',.92);stitch=mat('GloveStitch','9c9c96',.96);suede=mat('GloveSuede','30343c',.98);glovepanel=mat('GlovePanel','9fa820',.95)
steer.scale=(.85,.9,1)
build_driver(group, mesh, curve, interp, steer, body, (fabric, glovepanel, suede, stitch, sleeve))
# Tyres with radial sidewall typography, dish covers and tiny fasteners.
for front in [True,False]:
 for s in [-1,1]:
  z=1.55 if front else -2.05;w=.305 if front else .405;x=s*(.8175 if front else .7675)
  # Upright, spaced ball joints and inboard pickup brackets (not one shared hub point).
  ux=x-s*.10
  rod('Upright',(ux,.22,z),(ux,.48,z),.029,metal,vertices=12)
  for level,yy in enumerate([.251,.419]):
   for dz in [-.33,.28]:
    # Taper the blades into the actual nose/gearbox at both chassis stations.
    pick=(s*((.188 if dz<0 else .129) if front else (.09 if dz<0 else .15)),yy-(.026 if front and dz>0 and level else 0),z+dz)
    joint=(ux,yy+(.016 if level else -.014),z)
    blade=rod('Carbon wishbone',pick,joint,.015)
    blade.scale.x=1.68;blade.scale.y=.66
    box('Pickup clevis',pick,(.052,.036,.07),metal,r=.007)
    rod('Pickup bolt',(pick[0]-.03,pick[1],z+dz),(pick[0]+.03,pick[1],z+dz),.009,metal,vertices=6)
   ellipsoid('Upright spherical joint',(ux,yy,z),(.027,.022,.025),metal)
  rod('Suspension pushrod',(s*.138,.457 if front else .43,z+(-.29 if front else .29)),(ux,.25,z),.013)
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
   lathe('Recessed black dish',[(xx,.231),(xx-side*.012,.224),(xx-side*.019,.212),(xx-side*.034,.19),(xx-side*.043,.12),(xx-side*.04,.04)],dish)
   lathe('Rim lip',[(xx,.231),(xx+side*.003,.232),(xx+side*.004,.226),(xx,.224)],dish)
   rod('Centre nut',(xx-side*.04,0,0),(xx+side*.015,0,0),.034,metal,pivot,6)
   lathe('Locking collar',[(xx+side*.014,.030),(xx+side*.020,.027),(xx+side*.020,.020),(xx+side*.011,.018)],metal)
   rod('Hollow axle',(xx+side*.016,0,0),(xx+side*.017,0,0),.020,black,pivot,20)
   for clip in [-1,1]:
    box('Centrelock spring tab',(xx+side*.021,.020*clip,.006),(.004,.006,.013),red,pivot,r=.001)
   lathe('Ventilated carbon brake rotor',[(xx-side*.07,.075),(xx-side*.07,.205),(xx-side*.083,.205),(xx-side*.083,.075)],brake)
   box('Brake caliper',(xx-side*.092,.155,0),(.045,.09,.13),metal,pivot,r=.012)
   for j in range(18):
    a=j*math.tau/18;rod('Rotor cooling vein',(xx-side*.087,.09*math.cos(a),.09*math.sin(a)),(xx-side*.087,.20*math.cos(a+.05),.20*math.sin(a+.05)),.003,black,pivot,5)
   # Plane text local X runs around sidewall; normal faces +/-X.
   for label,centre in [('PZ-RACE',0),('ZERO SLICK',math.pi)]:
    for i,ch in enumerate(label):
     a=centre-side*(i-(len(label)-1)/2)*.14
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
# Nose and front wing marks are projected on the final target meshes below.
nose_labels=[]
for label,z,size,parent in [('44',1.45,.34,numberA),('23',1.45,.34,numberB),
                            ('NEXUS',.90,.123,decals),('VECTOR',1.78,.077,decals),
                            ('SOLAR',2.04,.060,decals),('JGP',2.46,.067,decals)]:
 nose_labels.append(text(label,(0,1,z),size,silver,(-math.pi/2,0,0),parent).name)
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
# Continuous manufactured outer shell: join overlapping skins, voxel-union and relax fillets.
# Keep the cockpit aperture and inlet mouths open; paint is assigned to the resulting skin.
body_names=('Nose','Downwash sidepod','Cockpit shoulder','Red engine cover','White airbox','White cockpit deck','Carbon undercut')
parts=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(o.name==n or o.name.startswith(n+'.') for n in body_names)]
for o in parts:
 bpy.context.view_layer.objects.active=o
 if o.name.startswith('Downwash sidepod'):
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.fill_holes(sides=0);bpy.ops.object.mode_set(mode='OBJECT')
 if o.name=='White cockpit deck':
  mod=o.modifiers.new('Deck wall thickness','SOLIDIFY');mod.thickness=.022;bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();skin=bpy.context.object;skin.name='Unified sculpted body';skin.parent=body
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
rem=skin.modifiers.new('Fuse continuous body seams','REMESH');rem.mode='VOXEL';rem.voxel_size=.008;rem.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=rem.name)
sm=skin.modifiers.new('Sculpt fillets','SMOOTH');sm.factor=.75;sm.iterations=7;bpy.ops.object.modifier_apply(modifier=sm.name)
d=skin.modifiers.new('Curvature preserving reduction','DECIMATE');d.ratio=.106;bpy.ops.object.modifier_apply(modifier=d.name)
sm=skin.modifiers.new('Relax reduction ripples','SMOOTH');sm.factor=.22;sm.iterations=3;bpy.ops.object.modifier_apply(modifier=sm.name)
# Voxel union does not retain multi-material paint regions: repaint the continuous skin.
# Cut topology exactly along paint-mask boundaries so low-poly triangles cannot serrate the livery.
bm=bmesh.new();bm.from_mesh(skin.data)
for axis,value in [(2,-1.32),(2,.55),(1,.562),(0,-.50),(0,.50),(2,-1.28),(2,-.54),(1,.66),(2,.28),(1,.395),(0,-.30),(0,.30),(0,-.36),(0,.36),(2,-.95),(2,.50)]:
 co=[0.,0.,0.];no=[0.,0.,0.];co[axis]=value;no[axis]=1.
 bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=co,plane_no=no,clear_inner=False,clear_outer=False)
bm.to_mesh(skin.data);bm.free();skin.data.update()
skin.data.materials.clear()
for material in [paint,white,carbon]:skin.data.materials.append(material)
for poly in skin.data.polygons:
 poly.use_smooth=True
 co=sum((skin.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 if (-1.32<co.z<.55 and co.y>.562 and abs(co.x)<.50) or (co.z> -1.28 and co.z<-.54 and co.y>.66):poly.material_index=1
 elif (co.z<.28 and co.y<.395 and abs(co.x)>.30) or (-.95<co.z<.50 and abs(co.x)<.36 and co.y<.562):poly.material_index=2
 else:poly.material_index=0
for side in [-1,1]:
 outline=[(side*.55+math.copysign(abs(math.cos(j*math.tau/48))**.52,math.cos(j*math.tau/48))*.228,.548+math.copysign(abs(math.sin(j*math.tau/48))**.62,math.sin(j*math.tau/48))*.047) for j in range(48)]
 cutter=mesh('Matching sidepod aperture',[(x,y,z) for z in [.31,.59] for x,y in outline],[tuple(range(48)),tuple(range(48,96))]+[(i,(i+1)%48,(i+1)%48+48,i+48) for i in range(48)],black,parent=None)
 bm=bmesh.new();bm.from_mesh(cutter.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(cutter.data);bm.free()
 bpy.context.view_layer.objects.active=skin;mod=skin.modifiers.new('Open intake throat','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)

# Cut the exact tapered mouth profile through the united skin, not a rounded rectangle.
cutvs=[(x*.98,.945+(y-.945)*.98,z) for z in [-.76,-.48] for x,y in airoutline]
cutter=mesh('Airbox throat cutter',cutvs,[tuple(reversed(range(AN))),tuple(range(AN,2*AN))]+[(i,(i+1)%AN,(i+1)%AN+AN,i+AN) for i in range(AN)],black,parent=None)
bm=bmesh.new();bm.from_mesh(cutter.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(cutter.data);bm.free()
bpy.context.view_layer.objects.active=skin;mod=skin.modifiers.new('Open divided airbox','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
for poly in skin.data.polygons:poly.use_smooth=True
# A single exact elliptical machining pass removes the ragged voxel-union rim.
# Carbon cut faces and a 5mm fillet make a continuous, even coaming, not a trim overlay.
CN=192;outline=[(.281*math.cos(i*math.tau/CN),-.21+.523*math.sin(i*math.tau/CN)) for i in range(CN)]
cutter=mesh('Cockpit aperture tool',[(x,y,z) for y in [.29,.79] for x,z in outline],[tuple(reversed(range(CN))),tuple(range(CN,2*CN))]+[(i,(i+1)%CN,(i+1)%CN+CN,i+CN) for i in range(CN)],carbon,parent=None)
bm=bmesh.new();bm.from_mesh(cutter.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(cutter.data);bm.free()
cutter.data.materials.clear()
for material in [paint,white,carbon]:cutter.data.materials.append(material)
for poly in cutter.data.polygons:poly.material_index=2
bpy.context.view_layer.objects.active=skin;mod=skin.modifiers.new('Even open cockpit coaming','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
for poly in skin.data.polygons:poly.use_smooth=True
# Tiny real aperture edge radii, retaining the single connected body and paint regions.
mod=skin.modifiers.new('Manufactured aperture edge radius','BEVEL');mod.width=.0018;mod.segments=2;mod.limit_method='ANGLE';mod.angle_limit=.65;bpy.ops.object.modifier_apply(modifier=mod.name)
# Carbon cut faces lie behind the continuous rolled inner liner, not a centroid-painted trim.
for poly in skin.data.polygons:
 co=sum((skin.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 q=(co.x/.281)**2+((co.z+.21)/.523)**2
 if .94<q<1.06 and .53<co.y<.67 and abs(poly.normal.y)<.70:poly.material_index=2
 poly.use_smooth=True
# Surface decals use one projected sheet, never a collapsed ellipsoid with overlapping faces.
for o in list(bpy.context.scene.objects):
 if o.name.startswith(('Blue airbox badge','Solar emblem')):bpy.data.objects.remove(o,do_unlink=True)
for side in [-1,1]:
 vs=[];fs=[];N=48
 for ring in range(4):
  for j in range(N):
   a=j*math.tau/N;r=ring/3;y=.90+math.cos(a)*.055*r;z=-.90+math.sin(a)*.064*r
   hit,co,no,face=skin.ray_cast(Vector((side*1.2,y,z)),Vector((-side,0,0)))
   if not hit:raise RuntimeError('Airbox badge ray missed skin')
   vs.append((co.x+side*.0025,co.y,co.z))
 for ring in range(3):
  for j in range(N):a=ring*N+j;b=ring*N+(j+1)%N;fs.append((a,b,b+N,a+N))
 mesh('Conformal blue badge',vs,fs,brandblue,decals)
# The sidepod emblem sits on the final painted skin at every radius.
for side in [-1,1]:
 vs=[];fs=[];steps=32
 for ring in range(1,5):
  for j in range(steps):
   angle=j*math.tau/steps
   y=.428+.054*ring/4*math.cos(angle);z=-.72+.064*ring/4*math.sin(angle)
   hit,co,no,_=skin.ray_cast(Vector((side*1.2,y,z)),Vector((-side,0,0)))
   if not hit:raise RuntimeError('Sidepod emblem missed the paint')
   vs.append(co+no*.0014)
 fs.append(tuple(range(steps)))
 for ring in range(3):
  for j in range(steps):
   a=ring*steps+j;b=ring*steps+(j+1)%steps;fs.append((a,b,b+steps,a+steps))
 mesh('Conformal energy insignia',vs,fs,gold,decals)
for o in list(bpy.context.scene.objects):
 if o.type=='MESH' and o.name.startswith('Mark nx'):
  side=1 if o.location.x>0 else -1;o.location=(side*.5,.90,-.90);o.parent=decals
  bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Conformal airbox lettering','SHRINKWRAP');mod.target=skin;mod.wrap_method='PROJECT';mod.use_project_z=True;mod.use_positive_direction=False;mod.use_negative_direction=True;mod.offset=.004;bpy.ops.object.modifier_apply(modifier=mod.name)

# Paint is printed on curved panels. Casting each glyph vertex stops text
# disappearing inside the taper or hovering over a slot between aero elements.
def drape_from_above(obj, surfaces):
 bm=bmesh.new();bm.from_mesh(obj.data)
 bmesh.ops.triangulate(bm,faces=list(bm.faces))
 bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=1,use_grid_fill=True)
 bm.to_mesh(obj.data);bm.free()
 world=obj.matrix_world.copy();inverse=world.inverted()
 for vertex in obj.data.vertices:
  pos=world@vertex.co
  hits=[hit for target in surfaces if (hit:=target.ray_cast(Vector((pos.x,1.6,pos.z)),Vector((0,-1,0))))[0]]
  if hits:
   _,point,_,_=max(hits,key=lambda hit:hit[1].y)
   vertex.co=inverse@Vector((point.x,point.y+.0018,point.z))
 obj.data.update()
for label in nose_labels:drape_from_above(bpy.data.objects[label],[skin])
nose_badge=[]
for radius in [.15,.55,1]:
 for j in range(32):
  a=j*math.tau/32;x=radius*.075*math.cos(a);z=1.897+radius*.073*math.sin(a)
  ok,co,_,_=skin.ray_cast(Vector((x,1.3,z)),Vector((0,-1,0)))
  if not ok:raise RuntimeError('Nose insignia missed paint')
  nose_badge.append((x,co.y+.0019,z))
mesh('Nose energy insignia',nose_badge,[tuple(range(32))]+[(i+j,i+(j+1)%32,i+(j+1)%32+32,i+j+32) for i in [0,32] for j in range(32)],gold,decals)
for parent in [numberA,numberB]:
 for mark in parent.children:
  if mark.location.z>0:continue
  sign=1 if mark.location.x>0 else -1
  inv=mark.matrix_world.inverted()
  for vertex in mark.data.vertices:
   pt=mark.matrix_world@vertex.co
   hit,co,_,_=skin.ray_cast(Vector((sign*1.1,pt.y,pt.z)),Vector((-sign,0,0)))
   if hit and sign*co.x>.009:vertex.co=inv@Vector((co.x+sign*.0015,pt.y,pt.z))

for o in list(body.children):
 if o.type=='MESH' and o.name.startswith(('Mark AURORA','Mark VOLT')) and o.location.z>2.0:
  # Use a single flap face for each word; the slot remains physically clear.
  o.rotation_euler=(-math.pi/2,0,0)
  o.location.z=2.38 if o.name.startswith('Mark AURORA') else 2.62
  bpy.context.view_layer.update()
  drape_from_above(o,front_elements)
# Flush louvres follow the downwash ramp. Their front binding casts a small
# shadow along the opening while the black throat recedes into the paint.
for side in [-1,1]:
 for index in range(7):
  slot=[];lip=[]
  for j in range(13):
   t=j/12;x=side*(.350+.18*t-.010*index)
   z=-.50-.078*index-.060*t
   half=.0105*math.sin(math.pi*t)**.66+.001
   for target,edges in [(slot,[-half,half]),(lip,[half,half+.004])]:
    for k,dz in enumerate(edges):
     ok,co,_,_=skin.ray_cast(Vector((x,1.2,z+dz)),Vector((0,-1,0)))
     if not ok:raise RuntimeError('Cooling outlet missed rear deck')
     target.append((x,co.y+.002+(k*.002 if target is lip else 0),z+dz))
  faces=[(2*j,2*j+1,2*j+3,2*j+2) for j in range(12)]
  mesh('Cooling exit slot',slot,faces,black)
  mesh('Stamped louvre lip',lip,faces,paint)
# A laminated socket wraps around each halo lug and lies against the
# manufactured deck at its base, following the local slope of the skin.
for side in [-1,1]:
 socket=[]
 for ring,(width,depth,h) in enumerate([(.057,.071,.0016),(.054,.068,.005),(.039,.049,.020)]):
  for j in range(40):
   a=j*math.tau/40;x=side*(.320+width*math.cos(a));z=-.525+depth*math.sin(a)
   ok,co,_,_=skin.ray_cast(Vector((x,1.3,z)),Vector((0,-1,0)))
   socket.append((x,(co.y if ok else .60)+h,z))
 mesh('Laminated halo socket',socket,[(r*40+j,r*40+(j+1)%40,(r+1)*40+(j+1)%40,(r+1)*40+j)
      for r in range(2) for j in range(40)],carbon)
# Replace flat, intersecting cockpit liner panels with one smooth inner oval tub.
for o in list(bpy.context.scene.objects):
 if o.name.startswith(('Cockpit carbon liner','Inner carbon cockpit wall','Carbon pedal bulkhead')):bpy.data.objects.remove(o,do_unlink=True)
vv=[];ff=[]
linerProfile=[(.32,.25,.49),(.55,.275,.516),(.638,.278,.520),(.650,.279,.521),(.655,.282,.524),(.652,.285,.527),(.645,.286,.528)]
for ring,(y,w,l) in enumerate(linerProfile):
 for i in range(CN):a=i*math.tau/CN;vv.append((w*math.cos(a),y+(.012*math.sin(a) if ring>=2 else 0),-.21+l*math.sin(a)))
for ring in range(len(linerProfile)-1):
 for i in range(CN):a=ring*CN+i;b=ring*CN+(i+1)%CN;ff.append((a,b,b+CN,a+CN))
mesh('Smooth carbon cockpit liner',vv,ff,carbon)
# Swept, radius-controlled halo roots penetrate the deck; no union/remesh ripples.
# Small original white marks follow the actual halo skin, as on a broadcast car.
# Their geometry is exported by Blender and protected with the other decals.
from mathutils import Matrix
halo_mesh=bpy.data.objects.get('Halo')
for label,pos,size,right in [('NEXUS',(0,.924,.57),.030,(-1,0,0)),('AEROLAB',(-.324,.945,.105),.033,(0,0,-1)),('NEXUS',(.324,.945,.105),.037,(0,0,1)),('JGP',(-.270,.945,.305),.031,(0,0,-1)),('JGP',(.270,.945,.305),.031,(0,0,1))]:
 o=text(label,pos,size,silver,parent=decals)
 o.data.resolution_u=1  # Small markings need fewer curve subdivisions than body silhouettes.
 normal=Vector((0,1,0));r=Vector(right);up=normal.cross(r)
 o.rotation_euler=Matrix((r,up,normal)).transposed().to_euler()
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o=bpy.context.object
 sw=o.modifiers.new('Halo mark conformity','SHRINKWRAP');sw.target=halo_mesh;sw.wrap_method='NEAREST_SURFACEPOINT';sw.offset=.0008;bpy.ops.object.modifier_apply(modifier=sw.name)
# Reproject all fictional sidepod lettering onto the final united skin.
for o in list(decals.children):
 if o.type=='MESH' and o.name.startswith(('Mark NOVA','Mark VOLT')):
  bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Final body lettering projection','SHRINKWRAP');mod.target=skin;mod.wrap_method='PROJECT';mod.use_project_z=True;mod.use_positive_direction=False;mod.use_negative_direction=True;mod.offset=.004
  bpy.ops.object.modifier_apply(modifier=mod.name)
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
# The glove shell is a continuous loft; preserve its tailored profile (no voxel puffing).
# Preserve curved painted skins and tyre shoulders; simplify small mechanical parts only.
for o in bpy.context.scene.objects:
 if o.type=='MESH' and o.parent not in [floor,decals] and len(o.data.polygons)>500 and not any(m.name in ['Livery','Ivory','Rubber','GloveFabric','Sleeve','HelmetPaint','HelmetInk'] for m in o.data.materials):
  d=o.modifiers.new('Optimised smooth production topology','DECIMATE');d.ratio=.46
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

def export(name):
 bpy.ops.export_scene.gltf(filepath=str(OUT/name),export_format='GLB',export_yup=False,export_apply=True,export_cameras=False,export_lights=False)
export('jgp26-high.glb')
tri=sum(len(p.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for p in o.data.polygons)
for o in bpy.context.scene.objects:
 if o.type=='MESH' and len(o.data.polygons)>80:
  d=o.modifiers.new('Distance LOD','DECIMATE');d.ratio=.24
export('jgp26-low.glb')
(OUT/'jgp26-manifest.json').write_text(json.dumps({'source':'scripts/blender/build_car.py','highTriangles':tri,'dimensions':{'length':5.62,'width':2.0,'wheelbase':3.6,'bodyHeight':1.171},'lodDistanceMetres':32,'licence':'Original project asset; fictional branding'},indent=2)+'\n')
sys.path.insert(0,str(Path(__file__).parent))
from pack_glb import pack
for level in ['high','low']:pack(OUT/f'jgp26-{level}.glb',OUT/f'jgp26-{level}.glb.gz')
(OUT/'daylight.hdr.gz').write_bytes(gzip.compress((OUT/'daylight.hdr').read_bytes(),mtime=0))
# Keep the editable high-detail car in its own lit Blender studio; only the
# deforming racing assets above are sent to the realtime renderer.
for obj in list(bpy.context.scene.objects):
 for mod in list(obj.modifiers):
  if mod.name=='Distance LOD':obj.modifiers.remove(mod)
from studio import save_studio
save_studio(ROOT/'scripts/blender/jgp26.blend')
print('CAR_EXPORT_COMPLETE',tri)
