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
   a=2*math.pi*i/n;c,s=math.cos(a),math.sin(a)
   lateral=math.copysign(abs(c)**power,c);height=(1+math.copysign(abs(s)**power,s))/2
   if name=='Downwash sidepod':
    # The inlet lip opens into a downwash ramp between raised outer shoulder
    # and engine cover. The lower outer wall sweeps underneath the inlet.
    fade=max(0,min(1,(.47-z)/.4))*max(0,min(1,(z+1.92)/.45))
    outward=lateral*math.copysign(1,x)
    bowl=math.exp(-((outward-.10)/.49)**2)
    height-=.34*fade*bowl*max(0,s)**1.5
    height+=.16*fade*math.exp(-((outward-.72)/.23)**2)*max(0,s)
    lateral-=math.copysign(.46*fade*max(0,-s)*max(0,outward),x)
   v.append((x+lateral*w,bot+height*(top-bot),z))
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
  local_chord=chord*(.73+.42*arch+.05*t*t if front and side else 1-.12*t*t)
  incidence=(.19+.13*arch-.12*t) if front else .12*(1-.58*t*t)
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
secondary=mat('DeepLivery','56091f',.33,.17);tyreink=mat('CompoundInk','b6b2a4',.78)
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
 # A tapered, folded edge wing follows the Venturi tunnel and kicks up aft.
 for lane in range(2):
  vv=[];ff=[]
  rail=interp([[-2.38,.70,.18,.014],[-1.73,.81,.14,.052],[-1.18,.858,.16,.066],
               [-.59,.865,.116,.059],[.05,.86,.13,.065],[.56,.80,.17,.046],[.78,.72,.22,.008]],5)
  for z,x,y,w in rail:
   x-=lane*.074
   for t,h in [(-1,.002),(-.7,.010),(.65,.019),(1,.032),(1,.026),(.4,.011),(-.68,.003),(-1,0)]:
    vv.append((s*(x+w*.5*t),y+h-lane*.026,z))
  for j in range(len(rail)-1):
   for k in range(8):
    i=j*8+k;n=j*8+(k+1)%8;ff.append((i,n,n+8,i+8))
  mesh('Swept floor edge wing',vv,ff,carbon,floor)
 # Folded inlet fences have an arched leading lip, a flared outer
 # wall and a long return to the tunnel roof behind the front tyre.
 for lane in range(3):
  vv=[];ff=[]
  for j,(z,centre,height,flare) in enumerate(interp([[.955,.45,.113,.002],[.873,.46,.207,.021],
       [.704,.49,.268,.061],[.468,.52,.238,.069],[.261,.55,.183,.048],[.075,.567,.131,.010]],5)):
   x=centre+lane*.127;top=height+lane*.013
   for lateral,h in [(-.006,.110),(-.006,.13),(flare*.33,top*.89),(flare,top),
                     (flare+.005,top-.002),(flare*.35+.006,top*.87),(.005,.125),(.005,.110)]:
    vv.append((s*(x+lateral),h,z-lane*.034))
   if j:
    for k in range(8):
     a=(j-1)*8+k;b=(j-1)*8+(k+1)%8;ff.append((a,b,b+8,a+8))
  mesh('Rolled Venturi inlet fence',vv,ff,carbon,floor)
for side in [-1,1]:
 rows=interp([[-2.72,.19,.705,.287],[-2.55,.193,.723,.25],[-2.24,.19,.699,.191],
              [-1.99,.22,.684,.123],[-1.57,.26,.68,.091]],5)
 vv=[];ff=[]
 for z,inner,outer,roof in rows:
  for j in range(13):
   u=j/12;arch=math.sin(math.pi*u)**.55
   vv.append((side*(inner+(outer-inner)*u),.073+(roof-.073)*arch,z))
   if j and len(vv)>13:
    n=len(vv)-1;ff.append((n-14,n-13,n,n-1))
 mesh('Rising diffuser tunnel roof',vv,ff,carbon,floor)
for x in [-.6,-.4,-.2,0,.2,.4,.6]:panel('Diffuser strake',[(x,.07,-2.72),(x,.33,-2.72),(x,.14,-2.05),(x,.07,-1.9)],.012,carbon)
# Raised tapering nose; no box-shaped body.
# Full survival cell from the rear bulkhead to the deformable nose cone.
# The square upper shoulders flow into the radiator decks and no exposed
# vertical cap is left beside the forward end of the cockpit.
loft('Nose',[[-1.55,0,.159,.20,.46],[-1.15,0,.252,.18,.548],[-.82,0,.317,.182,.624],
 [-.42,0,.362,.173,.640],[-.04,0,.391,.169,.651],[.27,0,.384,.173,.657],
 [.49,0,.382,.157,.649],[.77,0,.365,.166,.637],[1.20,0,.307,.182,.570],
 [1.84,0,.224,.178,.453],[2.34,0,.152,.157,.341],[2.61,0,.120,.141,.271],
 [2.82,0,.076,.144,.224],[2.89,0,.041,.151,.195],[2.905,0,.022,.162,.187]],paint,n=48,power=.38)
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
 # Continuous radiator fairing. A high inlet lip broadens into the outer
 # shoulder while the lower wall sweeps back beneath it into the coke bottle.
 stations=interp([[-2.03,.15,.31,.192,.376],[-1.65,.12,.525,.156,.496],[-1.22,.12,.696,.152,.565],
                  [-.88,.13,.814,.156,.610],[-.52,.155,.887,.182,.675],[-.18,.18,.889,.226,.677],
                  [.08,.207,.861,.282,.674],[.259,.261,.835,.353,.656],[.397,.305,.809,.427,.637],
                  [.484,.318,.782,.481,.616]],6)
 # Curvature is different on the upper, lower and outside walls.
 controls=[[.0,.48],[.014,.80],[.073,.965],[.25,.991],[.43,.903],[.66,.865],
           [.835,.949],[.938,.914],[.990,.765],[1,.515],[.960,.333],[.842,.187],
           [.705,.104],[.55,.029],[.324,0],[.125,.095],[.035,.275]]
 cross=interp(controls[-1:]+controls+controls[:2],3)[3:-4]
 vv=[];ff=[]
 for z,inside,outside,bottom,top in stations:
  ramp=max(0,min(1,(.416-z)/.42))*max(0,min(1,(z+1.82)/.6))
  for u,v in cross:
   x=inside+(outside-inside)*u
   channel=.070*ramp*math.exp(-((u-.49)/.20)**2)*max(0,2*v-1)
   vv.append((s*x,bottom+(top-bottom)*v-channel,z))
 count=len(cross)
 for row in range(len(stations)-1):
  for k in range(count):
   a=row*count+k;b=row*count+(k+1)%count;ff.append((a,b,b+count,a+count))
 ff.extend([tuple(reversed(range(count))),tuple(range(len(vv)-count,len(vv)))])
 sidepods[s]=mesh('Downwash sidepod',vv,ff,paint)
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
 loft('Cockpit shoulder',[[-1.55,s*.25,.07,.39,.51],[-1.15,s*.29,.22,.399,.635],[-.84,s*.34,.25,.421,.712],[-.45,s*.385,.237,.436,.697],[.02,s*.405,.211,.474,.685],[.28,s*.41,.17,.552,.675],[.50,s*.353,.073,.533,.616]],white,power=.9)
 box('Deep intake throat',(s*.55,.548,.345),(.42,.078,.005),black,r=.012)
 # The radiator sits deep behind the opening. Each fin has a return edge
 # that catches a narrow highlight against the black plenum.
 finverts=[];finfaces=[]
 for column in range(-14,15):
  x=s*.55+column*.0125
  for y in [.522,.548,.574]:
   start=len(finverts);finverts.extend([(x-.003,y-.010,.358),(x+.001,y+.009,.364),(x+.003,y+.010,.359),(x-.001,y-.009,.353)])
   finfaces.append(tuple(range(start,start+4)))
 mesh('Radiator matrix behind inlet',finverts,finfaces,brake)
 # Rolled tunnel already supplies the lip; no overlapping trim curve.

 # Twin aerofoil stays and a carbon perimeter for the recessed glass cassette.
 for zz,h in [(.285,.62),(.405,.608)]:
  stay=curve('Faired mirror stay',[(s*.30,h,zz),(s*.46,.64,zz+.035),(s*.59,.69,zz+.012),(s*.65,.698,.348)],.0075)
  stay.data.bevel_resolution=2
 box('Mirror seal',(s*.65,.710,.2965),(.182,.044,.006),black,r=.010)
 loft('Mirror cowl',[[.298,s*.65,.096,.684,.731],[.308,s*.65,.108,.674,.742],[.36,s*.651,.105,.676,.744],[.409,s*.651,.085,.688,.730],[.427,s*.651,.062,.699,.717]],paint,n=24,power=.58)
 box('Mirror glass',(s*.65,.710,.295),(.175,.038,.004),mirror,r=.009)
 # Sidepod fictional sponsors in the reference positions.
 rot=(0,s*math.pi/2,0)
 text('NOVA', (s*.92,.449,-.303),.152,silver,rot)
 ellipsoid('Solar emblem',(s*.812,.445,-.72),(.003,.062,.069),gold)
 text('VOLT', (s*.80,.366,-1.12),.083,silver,rot)
 text('AEROLINK',(s*.318,.46,.78),.071,silver,rot)
 # Longitudinal ink on the painted shoulder lies alongside the cockpit rim.
 from mathutils import Matrix
 right=Vector((0,0,-s));up=Vector((s,0,0));normal=Vector((0,1,0))
 shoulder=text('KINETIC',(s*.506,1.,-.20),.083,black,parent=decals)
 shoulder.rotation_euler=Matrix((right,-up,normal)).transposed().to_euler()
# Continuous engine-cover cross section: a broad lower shoulder tapers into
# the fin without a second bulb sitting on top of the first one.
cover_stations=interp([[-2.21,.122,.20,.53],[-2.10,.192,.20,.69],[-1.88,.265,.20,.82],
                       [-1.67,.328,.21,.887],[-1.39,.373,.23,.967],[-1.15,.353,.26,1.045],
                       [-.96,.315,.34,1.092],[-.84,.288,.40,1.118],[-.67,.204,.56,1.106]])
outline=[(0,0),(.58,.033),(.87,.125),(1,.28),(.92,.43),(.74,.55),(.55,.67),
         (.52,.78),(.39,.88),(.28,.95),(.13,.988),(0,1)]
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

# The fin is part of the removable cowling. Its drafted sides provide a
# continuous surface for the race number and die out into the airbox shoulder.
loft('Engine cover spine',[[-2.195,0,.020,.497,.876],[-2.16,0,.038,.491,.921],
 [-1.97,0,.056,.524,.948],[-1.71,0,.068,.551,.984],[-1.40,0,.090,.591,1.017],
 [-1.15,0,.119,.68,1.058],[-.94,0,.118,.75,1.087],[-.78,0,.097,.811,1.102]],
 paint,n=30,power=.31)
for s in [-1,1]:
 text('44',(s*.014,.833,-1.854),.305,silver,(0,s*math.pi/2,0),numberA)
 text('23',(s*.014,.833,-1.854),.305,silver,(0,s*math.pi/2,0),numberB)
 text('ION',(s*.38,.61,-.2),.058,black,(0,s*math.pi/2,0))
# Halo carbon arch, centre pillar, camera pod.
build_halo(mesh, interp, carbon, metal, black, rod)
box('T camera',(0,1.15,-.72),(.28,.042,.058),carbon,r=.012)
rod('Camera pedestal',(0,1.09,-.72),(0,1.14,-.72),.022)
# Main plane plus three cascading contoured flaps. All exposed carbon.
aero=mat('AeroLaminate','11141a',.52,.05)
front_elements=[]
front_elements.append(wing('Front mainplane',1.956,2.715,.100,.395,aero,sweep=.116,lift=.025))
for side in [-1,1]:
 for index,(z,y,chord) in enumerate([(2.562,.142,.244),(2.425,.184,.233),(2.305,.235,.212)]):
  front_elements.append(wing('Front flap '+str(index),1.956,z,y,chord,aero,
                             sweep=.131+index*.012,lift=.037+index*.008,side=side,root_width=.068+index*.035))
 # Slot-gap separators tie neighbouring flaps together at two span stations.
 for distance in [.40,.76]:
  for j in range(3):
   z=2.56-j*.123-.12*distance*distance
   panel('Flap slot bridge',[(side*distance,.101+j*.034,z+.035),(side*distance,.134+j*.034,z-.014),
         (side*distance,.148+j*.034,z-.022),(side*distance,.132+j*.034,z+.041)],.006,aero)
for s in [-1,1]:
 # The outboard return curls from the deck through a quarter-round
 # into the vertical end fence; its silhouette changes along the chord.
 sections=interp([[2.846,.924,.117,.127],[2.78,.953,.119,.180],[2.61,.968,.129,.216],
                  [2.40,.970,.146,.277],[2.23,.969,.181,.304],[2.12,.962,.204,.291],
                  [2.079,.951,.215,.251]],4)
 vv=[];ff=[]
 for j,(z,edge,base,tip) in enumerate(sections):
  for x,h in [(-.032,0),(-.013,.018),(-.003,.09),(.003,.36),(.008,.94),(.006,1),
              (.001,.98),(-.004,.44),(-.009,.15),(-.018,.05),(-.032,.032)]:
   vv.append((s*(edge+x),base+(tip-base)*h,z))
  if j:
   for k in range(11):
    i=(j-1)*11+k;n=(j-1)*11+(k+1)%11;ff.append((i,n,n+11,i+11))
 mesh('Radiused outboard wing return',vv,ff,aero)
 vv=[];ff=[]
 for y,x,z,half,depth in [[.130,.119,2.51,.011,.054],[.146,.117,2.515,.010,.055],[.18,.102,2.521,.009,.051],[.221,.088,2.526,.014,.053]]:
  for k in range(20):
   a=k*math.tau/20;vv.append((s*x+half*math.cos(a)*(1+.32*math.sin(a)),y,z+depth*math.sin(a)))
 for row in range(3):
  for k in range(20):
   a=row*20+k;b=row*20+(k+1)%20;ff.append((a,b,b+20,a+20))
 mesh('Nose wing mounting blade',vv,ff,aero)
 text('AURORA',(s*.56,.255,2.46),.126,silver,(-math.pi/2,0,math.pi))
 text('VOLT',(s*.78,.21,2.73),.079,silver,(-math.pi/2,0,math.pi))
# Rear wing, twin swan necks, actuator, two beam elements.
wing('Rear main plane',1.58,-2.42,.78,.34,carbon,sweep=.035,lift=.01)
wing('DRS flap',1.55,-.07,.02,.23,carbon,flap,sweep=.025,lift=.01)
rear_flap=bpy.data.objects['DRS flap']
for side in [-1,1]:
 verts=[];faces=[];count=28
 for ring in range(1,5):
  for j in range(count):
   a=j*math.tau/count;x=side*.52+ring/4*.050*math.cos(a);z=-.075+ring/4*.049*math.sin(a)
   hit,point,_,_=rear_flap.ray_cast(Vector((x,.6,z)),Vector((0,-1,0)))
   if not hit:raise RuntimeError('Rear flap badge missed the aerofoil')
   verts.append((x,point.y+.0014,z))
  if ring==1:faces.append(tuple(range(count)))
  else:
   for j in range(count):
    n=(ring-2)*count+j;k=(ring-2)*count+(j+1)%count;faces.append((n,k,k+count,n+count))
 mesh('Rear flap partner badge',verts,faces,brandblue,flap)
 strips=[]
 for x1,z1,x2,z2 in [(-.025,.023,-.016,-.023),(-.016,-.023,.014,.023),(.014,.023,.025,-.023)]:
  quad=[]
  for x,z in [(x1-.004,z1),(x1+.004,z1),(x2+.004,z2),(x2-.004,z2)]:
   xx=side*.52+x;zz=-.075+z
   hit,pt,_,_=rear_flap.ray_cast(Vector((xx,.5,zz)),Vector((0,-1,0)))
   quad.append((xx,pt.y+.0023,zz))
  strips.extend(quad)
 mesh('Rear flap printed monogram',strips,[tuple(range(i,i+4)) for i in [0,4,8]],silver,flap)
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
outline=[(-.180,.057,0),(-.162,.086,0),(-.114,.081,0),(-.088,.100,0),(.088,.100,0),
 (.114,.081,0),(.162,.086,0),(.180,.057,0),(.146,.022,0),(.146,-.047,0),
 (.164,-.080,0),(.136,-.109,0),(.084,-.093,0),(.048,-.112,0),(-.048,-.112,0),
 (-.084,-.093,0),(-.136,-.109,0),(-.164,-.080,0),(-.146,-.047,0),(-.146,.022,0)]
v=[(x,y,z+d) for d in [-.018,.016] for x,y,z in outline];n=len(outline)
bevel(mesh('Scalloped carbon wheel housing',v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],carbon,steer),.005,3)
for side in [-1,1]:
 # Oval grip sections expand beneath the heel and thumb saddle, with a
 # scalloped outer edge matching the four compressed finger pads.
 profile=interp([[.146,.065,.009,.012],[.180,.078,.014,.015],[.198,.059,.018,.020],
                 [.207,.034,.019,.021],[.210,.011,.018,.020],[.211,-.012,.019,.021],
                 [.207,-.036,.019,.022],[.202,-.060,.020,.023],[.190,-.081,.019,.020],
                 [.160,-.086,.014,.015],[.140,-.067,.010,.012]],4)
 rings=[]
 for index,(x,y,r,depth) in enumerate(profile):
  before,after=profile[max(0,index-1)],profile[min(len(profile)-1,index+1)]
  tangent=Vector((side*(after[0]-before[0]),after[1]-before[1],0)).normalized()
  normal=Vector((-tangent.y,tangent.x,0))
  rings.append([Vector((side*x,y,0))+normal*r*math.cos(a)+Vector((0,0,depth*math.sin(a)))
                for a in [i*math.tau/20 for i in range(20)]])
 from cockpit import closed_rings
 mesh('Ergonomic rim grip',*closed_rings(rings),rubber,steer)
 # The thumb rests on a concave spoke pad at the driver-facing surface.
 thumb=interp([[.135,.013,-.020,.004,.004],[.144,.011,-.018,.010,.007],
               [.156,.004,-.020,.014,.010],[.175,-.013,-.026,.014,.011],
               [.189,-.036,-.027,.016,.011],[.204,-.044,-.012,.012,.008]],4)
 rings=[[(side*x,y+ry*math.cos(a),z+rz*math.sin(a)) for a in [i*math.tau/16 for i in range(16)]] for x,y,z,ry,rz in thumb]
 mesh('Thumb support',*closed_rings(rings),rubber,steer)
 for yy in [-.010,-.004,.002,.008,.014]:
  rod('Thumb encoder fluting',(side*.153,yy,-.020),(side*.164,yy,-.026),.0017,metal,steer,8)
box('Display',(0,.025,-.022),(.19,.112,.004),screen,steer,r=.008)
text('NEXUS', (0,.09,-.024),.029,silver,(0,math.pi,0),steer)
buttons=[(-.165,.073,blue,'R'),(-.116,.055,green,'N'),(-.125,.009,yellow,'+'),(-.12,-.041,red,'−'),(.116,.036,red,'P'),(.17,.052,yellow,'A'),(.126,-.016,blue,'+'),(.12,-.064,silver,'−')]
for x,y,m,label in buttons:
 x=-x
 rod('Button collar',(x,y,-.021),(x,y,-.026),.012,metal,steer,20);rod('Button cap',(x,y,-.026),(x,y,-.031),.0095,m,steer,20);text(label,(x,y,-.0317),.012,silver if m==blue else black,(0,math.pi,0),steer)
for x,y,m in [(-.067,-.066,green),(0,-.073,yellow),(.072,-.089,blue)]:
 x=-x
 rod('Rotary coloured ring',(x,y,-.020),(x,y,-.026),.025,m,steer,32)
 dialmat=M.get('ControlPolymer') or mat('ControlPolymer','33363b',.56,.08)
 rings=[]
 for z,r in [(-.025,.019),(-.027,.020),(-.038,.0185),(-.041,.0165)]:
  rings.append([(x+(r+.0009*math.cos(16*a))*math.cos(a),y+(r+.0009*math.cos(16*a))*math.sin(a),z)
                for a in [i*math.tau/64 for i in range(64)]])
 mesh('Low profile thumb rotary',*closed_rings(rings),dialmat,steer)
 box('Dial pointer',(x-.003,y+.008,-.0415),(.0035,.014,.0014),silver,steer,r=.0005)
for side in [-1,1]:
 paddle=panel('Shift paddle',[(side*.105,-.072,.052),(side*.15,-.056,.060),(side*.17,.035,.055),(side*.125,.052,.048)],.007,carbon,steer)
 rod('Paddle hinge',(side*.095,-.035,.034),(side*.095,.025,.034),.006,metal,steer,12)
 rod('Paddle linkage',(side*.095,0,.034),(side*.13,0,.055),.004,metal,steer,8)
 text('−' if side>0 else '+',(side*.145,.018,.063),.018,silver,parent=steer)
for x,y in [(.067,-.066),(0,-.073),(-.072,-.089)]:
 for i in range(9):
  a=(i/8*1.5+.25)*math.pi
  rod('Rotary index tick',(x+.029*math.cos(a),y+.029*math.sin(a),-.024),(x+.032*math.cos(a),y+.032*math.sin(a),-.024),.00055,silver,steer,4)
fabric=mat('GloveFabric','ac1f30',.92);stitch=mat('GloveStitch','ddd8cc',.96);suede=mat('GloveSuede','30343c',.98);glovepanel=mat('GlovePanel','4c2028',.95)
steer.scale=(.85,.9,1)
build_driver(group, mesh, curve, interp, steer, body, (fabric, glovepanel, suede, stitch, sleeve))
# Boot tops, bent thighs and the six-point harness are visible beneath the wheel.
occupant=group('SuitBody');occupant.parent=body;occupant.location.y=-.060
for side in [-1,1]:
 loft('Suited thigh',[[-.54,side*.088,.072,.273,.420],[-.38,side*.093,.080,.267,.433],[-.20,side*.100,.073,.291,.451],[.00,side*.108,.066,.329,.468],[.15,side*.108,.056,.354,.462],[.27,side*.103,.041,.323,.421]],sleeve,occupant,n=22)
 def web(label,points,width,m):
  vv=[];ff=[]
  pts=interp(points,3)
  for i,(x,y,z) in enumerate(pts):
   vv.extend([(x-width/2,y-.001,z),(x-width*.39,y+.001,z),(x+width*.39,y+.001,z),(x+width/2,y-.001,z)])
   if i:
    for j in range(3):
     k=(i-1)*4+j;ff.append((k,k+1,k+5,k+4))
  mesh(label,vv,ff,m,occupant)
 web('Lap harness webbing',[[side*.191,.406,-.34],[side*.153,.435,-.29],[side*.080,.437,-.26],[side*.036,.421,-.25]],.042,black)
 web('Shoulder restraint',[[side*.118,.591,-.49],[side*.125,.520,-.40],[side*.091,.456,-.32],[side*.035,.427,-.25]],.045,black)
 for off in [-.016,.016]:
  web('Woven harness edge',[[side*.118+off,.593,-.49],[side*.125+off,.523,-.40],[side*.091+off,.459,-.32],[side*.035+off,.430,-.25]],.0018,stitch)
 for z in [-.18,-.09,.00]:
  r=math.sqrt(1-((z+.21)/.52)**2)
  curve('Seat loom retainer',[(side*(.27*r-.007),.47,z-.008),(side*(.27*r-.018),.48,z),(side*(.27*r-.005),.49,z+.008)],.0022,metal)
 curve('Cockpit electronics loom',[(side*.23,.43,-.43),(side*.248,.483,-.24),(side*.245,.484,-.09),(side*.224,.480,.055),(side*.162,.49,.15)],.006,black)
 rod('Headrest retaining pin',(side*.247,.646,-.226),(side*.247,.651,-.226),.007,metal,vertices=12)
rod('Harness cam lock',(0,.421,-.25),(0,.436,-.25),.030,metal,occupant,24)
box('Buckle release lever',(0,.438,-.25),(.049,.005,.012),red,occupant,r=.002)
def suspension_blade(pickup,joint,front):
 # Extruded carbon airfoil follows the suspension axis. Its chord always
 # faces the airflow, including the rearward wishbone and the opposite side.
 start,end=Vector(pickup),Vector(joint);axis=(end-start).normalized()
 forward=Vector((0,0,1));chord=(forward-axis*forward.dot(axis)).normalized()
 thickness=axis.cross(chord).normalized()
 vv=[];ff=[];samples=18
 for t,section in [(0,.67),(.065,1),(.24,1.10),(.71,.90),(.93,.70),(1,.46)]:
  centre=start.lerp(end,t)
  for k in range(samples):
   a=k*math.tau/samples;u=(1-math.cos(a))*.5
   v=(centre+chord*((.48-u)*(.095 if front else .087)*section)
      +thickness*(math.sin(a)*(.014-.008*u)*section))
   vv.append(tuple(v))
 for row in range(5):
  for k in range(samples):
   a=row*samples+k;b=row*samples+(k+1)%samples;ff.append((a,b,b+samples,a+samples))
 ff.extend([tuple(reversed(range(samples))),tuple(range(5*samples,6*samples))])
 return mesh('Carbon wishbone',vv,ff,carbon)
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
    suspension_blade(pick,joint,front)
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
   if side==s:
    # Tool-machined bead surround, scalloped cover stiffeners and a recessed
    # graphite hub. Narrow breaks distinguish raised carbon from machined metal.
    lathe('Turned bead seat',[(xx+side*.001,.225),(xx+side*.002,.226),(xx-side*.003,.222)],metal)
    lathe('Wheel centre recess',[(xx-side*.038,.071),(xx-side*.031,.066),(xx-side*.030,.059),(xx-side*.038,.055)],dish)
    for blade in range(7):
     vv=[];ff=[]
     for k in range(12):
      r=.081+.117*k/11;t=k/11;a=blade*math.tau/7+.25*t*t
      face_depth=-.043+.010*t*t
      for angle,rise in [(-.065,0),(-.025,.003),(0,.004),(.047,.001)]:
       vv.append((xx+side*(face_depth+rise),r*math.cos(a+angle),r*math.sin(a+angle)))
      if k:
       for j in range(3):
        n=(k-1)*4+j;ff.append((n,n+1,n+5,n+4))
     mesh('Wheel cover pressed rib',vv,ff,dish,pivot)
   # Captive anodised centrelock sits inside the cover rather than on a
   # projecting spindle. Its locking ears engage the outer hex socket.
   rod('Anodised centre nut',(xx-side*.042,0,0),(xx-side*.013,0,0),.038,red if s<0 else blue,pivot,6)
   lathe('Locking collar',[(xx-side*.016,.030),(xx-side*.010,.027),(xx-side*.010,.019),(xx-side*.018,.017)],metal)
   rod('Hollow axle',(xx-side*.016,0,0),(xx-side*.015,0,0),.017,black,pivot,20)
   for clip in [-1,1]:
    box('Centrelock spring tab',(xx-side*.008,.019*clip,.004),(.005,.008,.015),yellow,pivot,r=.001)
   lathe('Ventilated carbon brake rotor',[(xx-side*.07,.075),(xx-side*.07,.205),(xx-side*.083,.205),(xx-side*.083,.075)],brake)
   box('Brake caliper',(xx-side*.092,.155,0),(.045,.09,.13),metal,pivot,r=.012)
   for j in range(18):
    a=j*math.tau/18;rod('Rotor cooling vein',(xx-side*.087,.09*math.cos(a),.09*math.sin(a)),(xx-side*.087,.20*math.cos(a+.05),.20*math.sin(a+.05)),.003,black,pivot,5)
   # The mould lettering remains white. Two partial ink arcs identify the
   # fitted compound, with a gap at each of the two main sidewall wordmarks.
   for start,end in [(.61,2.48),(3.82,5.63)]:
    vv=[];ff=[]
    for j in range(37):
     a=start+(end-start)*j/36
     for radius in [.328,.333]:
      vv.append((side*w*.519,radius*math.cos(a),radius*math.sin(a)))
     if j:
      n=2*j;ff.append((n-2,n-1,n+1,n))
    mesh('Compound sidewall ink',vv,ff,tyreink,pivot)
   for j in range(8):
    a=j*math.tau/8;rod('Cover fastener',(xx,.216*math.cos(a),.216*math.sin(a)),(xx+side*.003,.216*math.cos(a),.216*math.sin(a)),.002,metal,pivot,6)
# Nose and front wing marks are projected on the final target meshes below.
nose_labels=[]
for label,z,size,parent in [('44',1.42,.49,numberA),('23',1.42,.49,numberB),
                            ('NEXUS',.88,.185,decals),('VECTOR',1.78,.077,decals),
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
# Continuous manufactured outer shell: join overlapping skins, voxel-union and relax fillets.
# Keep the cockpit aperture and inlet mouths open; paint is assigned to the resulting skin.
body_names=('Nose','Downwash sidepod','Cockpit shoulder','Red engine cover','White airbox','White cockpit deck','Carbon undercut','Engine cover spine')
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
d=skin.modifiers.new('Curvature preserving reduction','DECIMATE');d.ratio=.078;bpy.ops.object.modifier_apply(modifier=d.name)
sm=skin.modifiers.new('Relax reduction ripples','SMOOTH');sm.factor=.22;sm.iterations=3;bpy.ops.object.modifier_apply(modifier=sm.name)
# Voxel union does not retain multi-material paint regions: repaint the continuous skin.
# Cut topology exactly along paint-mask boundaries so low-poly triangles cannot serrate the livery.
bm=bmesh.new();bm.from_mesh(skin.data)
for axis,value in [(2,-1.32),(2,.55),(1,.562),(0,-.50),(0,.50),(2,-1.28),(2,-.54),(1,.66),(2,.28),(1,.257),(0,-.30),(0,.30),(0,-.36),(0,.36),(2,-.95),(2,.50)]:
 co=[0.,0.,0.];no=[0.,0.,0.];co[axis]=value;no[axis]=1.
 bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=co,plane_no=no,clear_inner=False,clear_outer=False)
for side in [-1,1]:
 bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,
                       plane_co=(side*.60,.635,0),plane_no=(-side*.31,1,.042),clear_inner=False,clear_outer=False)
# Carbon inlet scuff panels taper under the overbite of the painted lip.
for side in [-1,1]:
 bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,
                       plane_co=(side*.7,.488,.33),plane_no=(-side*.08,1,-.27),clear_inner=False,clear_outer=False)
bm.to_mesh(skin.data);bm.free();skin.data.update()
skin.data.materials.clear()
for material in [paint,white,carbon]:skin.data.materials.append(material)
for poly in skin.data.polygons:
 poly.use_smooth=True
 co=sum((skin.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 if (-1.32<co.z<.55 and co.y>.635+.31*(abs(co.x)-.60)-.042*co.z) or (co.z> -1.28 and co.z<-.54 and co.y>.66):poly.material_index=1
 elif (.0<co.z<.50 and abs(co.x)>.50 and co.y<.488+.08*(abs(co.x)-.7)+.27*(co.z-.33)) or (co.z<.28 and co.y<.257 and abs(co.x)>.30) or (-.95<co.z<.50 and abs(co.x)<.36 and co.y<.562):poly.material_index=2
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
 # The N monogram and its blue field follow the same drafted side panel.
 def flank_vertex(u,v,lift):
  y=.910+v*.105;z=-1.045-side*u*.129
  hit,point,_,_=skin.ray_cast(Vector((side*1.4,y,z)),Vector((-side,0,0)))
  if not hit:raise RuntimeError('Cowl badge is outside the skin')
  return (point.x+side*lift,y,z)
 vs=[flank_vertex(0,0,.0017)];fs=[];N=52
 for ring in range(1,7):
  for k in range(N):
   a=k*math.tau/N;vs.append(flank_vertex(math.cos(a)*ring/6,math.sin(a)*ring/6,.0017))
   i=1+(ring-1)*N+k;j=1+(ring-1)*N+(k+1)%N
   fs.append((0,i,j) if ring==1 else (i-N,i,j,j-N))
 mesh('Cowl enamel roundel',vs,fs,brandblue,decals)
 for u0,v0,u1,v1 in [(-.61,-.52,-.40,.54),(-.40,.54,.30,-.52),(.30,-.52,.54,.54)]:
  vs=[];fs=[]
  for j in range(13):
   t=j/12;u=u0+(u1-u0)*t;v=v0+(v1-v0)*t
   for offset in [-.095,.095]:vs.append(flank_vertex(u+offset,v,.0027))
   if j:fs.append((2*j-2,2*j-1,2*j+1,2*j))
  mesh('Printed Nexus monogram',vs,fs,silver,decals)
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
for o in list(decals.children):
 if o.name.startswith('Mark KINETIC'):drape_from_above(o,[skin])
for label in nose_labels:drape_from_above(bpy.data.objects[label],[skin])
nose_badge=[]
for radius in [.15,.55,1]:
 for j in range(32):
  a=j*math.tau/32;x=radius*.075*math.cos(a);z=1.897+radius*.073*math.sin(a)
  ok,co,_,_=skin.ray_cast(Vector((x,1.3,z)),Vector((0,-1,0)))
  if not ok:raise RuntimeError('Nose insignia missed paint')
  nose_badge.append((x,co.y+.0019,z))
mesh('Nose energy insignia',nose_badge,[tuple(range(32))]+[(i+j,i+(j+1)%32,i+(j+1)%32+32,i+j+32) for i in [0,32] for j in range(32)],gold,decals)
# Two swept cuts and a horizon bar give the small gold solar badge a
# recognisable silhouette at the distance of the stationary front camera.
for yy,reach in [(-.54,.72),(-.24,.91),(.10,.96)]:
 vv=[];ff=[]
 for k in range(17):
  u=-reach+2*reach*k/16
  for thickness in [-.050,.050]:
   x=u*.075;z=1.897+(yy+.20*u+thickness)*.073
   ok,point,_,_=skin.ray_cast(Vector((x,1.4,z)),Vector((0,-1,0)))
   vv.append((x,point.y+.0027,z))
  if k:ff.append((2*k-2,2*k-1,2*k+1,2*k))
 mesh('Solar print on nose',vv,ff,secondary,decals)
# Conformal team sweeps. Sample the finished surface on a grid so graphics
# stay on the curved shoulder and the scalloped nose, including at distance.
def ribbon(label,stations,material):
 path=interp(stations,6);vv=[];ff=[]
 for j,(z,x,width) in enumerate(path):
  for k in range(5):
   xx=x+width*(k/4-.5)
   ok,pt,n,_=skin.ray_cast(Vector((xx,1.4,z)),Vector((0,-1,0)))
   if not ok:raise RuntimeError(label+' projection missed paint')
   vv.append((xx,pt.y+.0023,z))
   if j and k:
    end=j*5+k;ff.append((end-6,end-5,end,end-1))
 mesh(label,vv,ff,material,decals)
for side in [-1,1]:
 for material,offset,scale in [(secondary,0,1),(silver,.021,.13)]:
  ribbon('Nose pinstripe',[(z,side*(x+offset*fade),w*scale) for z,x,w,fade in
   [(.58,.259,.002,0),(.81,.223,.052,1),(1.18,.182,.058,1),(1.59,.155,.037,.84),(2.14,.103,.023,.54),(2.58,.073,.009,.28),(2.76,.048,.001,0)]],material)
 for material,offset,width in [(secondary,0,1),(silver,.034,.12)]:
  ribbon('Sidepod team flash',[(z,side*(x+offset*fade),w*width) for z,x,w,fade in
   [(-1.57,.413,.002,0),(-1.23,.506,.046,.60),(-.82,.623,.091,1),(-.48,.677,.101,1),(-.10,.710,.096,1),(.17,.707,.071,.9),(.37,.677,.019,.40),(.425,.646,.002,0)]],material)
# Fin ink crosses the narrow fin and the wider cowling. Split the large
# glyph faces before projecting them onto the foremost surface on each side.
fin_targets=[skin]
for parent in [numberA,numberB]:
 for mark in parent.children:
  if mark.location.z>0:continue
  side=1 if mark.location.x>0 else -1
  bm=bmesh.new();bm.from_mesh(mark.data);bmesh.ops.triangulate(bm,faces=list(bm.faces))
  for _ in range(4):
   edges=[e for e in bm.edges if e.calc_length()>.014]
   if not edges:break
   bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
  bm.to_mesh(mark.data);bm.free()
  inv=mark.matrix_world.inverted()
  for vertex in mark.data.vertices:
   pt=mark.matrix_world@vertex.co
   hits=[hit for obj in fin_targets if (hit:=obj.ray_cast(Vector((side*1.2,pt.y,pt.z)),Vector((-side,0,0))))[0]]
   if hits:
    x=max(hits,key=lambda h:side*h[1].x)[1].x
    vertex.co=inv@Vector((x+side*.0028,pt.y,pt.z))
# Project chassis lettering from the side so the broad nose shoulder never
# hides the first letters. Fill the energy disc with a forward-swept sunburst.
for mark in list(body.children):
 if mark.type=='MESH' and mark.name.startswith('Mark AEROLINK'):
  side=1 if mark.location.x>0 else -1;inverse=mark.matrix_world.inverted()
  for v in mark.data.vertices:
   pos=mark.matrix_world@v.co
   ok,point,_,_=skin.ray_cast(Vector((side*1.4,pos.y,pos.z)),Vector((-side,0,0)))
   if ok:v.co=inverse@Vector((point.x+side*.0023,pos.y,pos.z))
for side in [-1,1]:
 points=[];faces=[]
 for ordinate,reach in [(-.49,.75),(-.12,.92),(.24,.86)]:
  for k in range(17):
   t=-reach+2*reach*k/16
   for w in [-.052,.052]:
    z=-.72+t*.064;y=.428+(ordinate+.20*t+w)*.054
    hit,pt,_,_=skin.ray_cast(Vector((side*1.4,y,z)),Vector((-side,0,0)))
    points.append((pt.x+side*.0029,y,z))
   if k:
    n=len(points)-1;faces.append((n-3,n-2,n,n-1))
 mesh('Solar flank print',points,faces,secondary,decals)
for o in list(body.children):
 if o.type=='MESH' and o.name.startswith(('Mark AURORA','Mark VOLT')) and o.location.z>2.0:
  # Use a single flap face for each word; the slot remains physically clear.
  o.rotation_euler=(-math.pi/2,0,0)
  outer=o.name.startswith('Mark VOLT');side=1 if o.location.x>0 else -1
  element=front_elements[0 if outer else (6 if side>0 else 3)]
  o.location.z=(2.715 if outer else 2.305)-(.116 if outer else .155)*(o.location.x/.978)**2
  bpy.context.view_layer.update()
  # Keep each word on its assigned element along the swept span.
  inverse=o.matrix_world.inverted()
  for v in o.data.vertices:
   p=o.matrix_world@v.co
   p.z-=(.116 if outer else .155)*(p.x**2-o.location.x**2)/(.978**2)
   v.co=inverse@p
  drape_from_above(o,[element])
# Service covers are pressed into the exterior. Cast their seam and the
# quarter-turn fastener seats onto the finished skin so highlights follow
# the nose curvature and the stepped edge of the removable engine cowling.
def surface_hit(x,z):
 hit,point,normal,_=skin.ray_cast(Vector((x,1.5,z)),Vector((0,-1,0)))
 if not hit:raise RuntimeError('Service detail outside the painted body')
 return point,normal.normalized()
for side in [-1,1]:
 for title,points in [
   ('Nose cone joint',[(.004,1.088),(.119,1.088),(.245,1.091),(.294,1.111),(.300,1.135)]),
   ('Forward access hatch',[(.042,.678),(.194,.678),(.247,.708),(.222,.920),(.180,.958),(.043,.958)]),
   ('Removable cowl seam',[(.19,-1.51),(.292,-1.441),(.372,-1.23),(.442,-1.04),(.493,-.894),(.510,-.771)])]:
  vv=[];ff=[]
  for j,(xx,zz) in enumerate(interp(points,5)):
   for offset in [-.0014,.0014]:
    point,normal=surface_hit(side*xx,zz+offset)
    vv.append(tuple(point+normal*.0018))
   if j:ff.append((2*j-2,2*j-1,2*j+1,2*j))
  mesh(title,vv,ff,black,decals)
 for x,z in [(.226,.721),(.201,.913),(.302,1.115),(.403,-1.065),(.494,-.799)]:
  centre,normal=surface_hit(side*x,z)
  u=normal.cross(Vector((0,0,1))).normalized();v=normal.cross(u)
  vv=[];ff=[]
  for r,h in [(.0065,.0019),(.0059,.0024),(.0047,.0025),(.0024,.0025)]:
   for k in range(12):
    a=k*math.tau/12;vv.append(tuple(centre+h*normal+r*(u*math.cos(a)+v*math.sin(a))))
  for row in range(3):
   for k in range(12):
    a=row*12+k;b=row*12+(k+1)%12;ff.append((a,b,b+12,a+12))
  mesh('Flush fastener seat',vv,ff,metal,decals)
  mesh('Fastener keyway',[tuple(centre+.0021*normal+.0027*(u*math.cos(k*math.tau/6)+v*math.sin(k*math.tau/6))) for k in range(6)],[tuple(range(6))],black,decals)
# Mill fourteen shallow cooling outlets into the upper panel. Each has a
# dark recessed floor and a rolled painted blade over its forward wall.
cutter_vertices=[];cutter_faces=[]
for side in [-1,1]:
 for index in range(7):
  path=[]
  for j in range(17):
   t=j/16;x=side*(.351+.183*t-.010*index);z=-.50-.078*index-.060*t
   width=.013*math.sin(math.pi*t)**.60+.0020
   path.append([surface_hit(x,z+dz)[0] for dz in [-width,width]])
  boundary=[row[0] for row in path]+[row[1] for row in reversed(path)]
  n=len(boundary);start=len(cutter_vertices)
  for depth in [-.016,.040]:
   cutter_vertices.extend([(pt.x,pt.y+depth,pt.z) for pt in boundary])
  # Triangulated ruled caps preserve curvature across the recessed floor.
  for k in range(len(path)-1):
   for layer in [0,n]:
    cutter_faces.append(tuple(start+layer+i for i in [k,k+1,n-2-k,n-1-k]))
  for k in range(n):
   a=start+k;b=start+(k+1)%n;cutter_faces.append((a,b,b+n,a+n))
  back=[];blade=[]
  for lo,hi in path:
   for pt in [lo,hi]:back.append(tuple(pt-Vector((0,.0149,0))))
   # A short return folds inside the aperture and catches light at grazing angles.
   blade.extend([(hi.x,hi.y+.0014,hi.z+.0017),(hi.x,hi.y+.0017,hi.z-.0004),
                 (hi.x,hi.y-.0030,hi.z-.0045),(hi.x,hi.y-.0094,hi.z-.0056)])
  mesh('Cooling outlet floor',back,[(2*k,2*k+1,2*k+3,2*k+2) for k in range(16)],black)
  mesh('Folded outlet edge',blade,[(4*k+j,4*k+j+1,4*k+j+5,4*k+j+4) for k in range(16) for j in range(3)],paint)
tool=mesh('Louvre pocket tool',cutter_vertices,cutter_faces,black,parent=None)
bm=bmesh.new();bm.from_mesh(tool.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(tool.data);bm.free()
bpy.context.view_layer.objects.active=skin
mod=skin.modifiers.new('Recess cooling outlets','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=tool
bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(tool,do_unlink=True)
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
# Project the ink along the flank normal after all booleans and material
# splits. This gives every letter the correct baseline on the curved wall.
for mark in list(decals.children):
 if mark.type!='MESH' or not mark.name.startswith(('Mark NOVA','Mark VOLT')):continue
 sign=1 if mark.location.x>0 else -1;inverse=mark.matrix_world.inverted()
 for vertex in mark.data.vertices:
  p=mark.matrix_world@vertex.co
  hit,pt,no,_=skin.ray_cast(Vector((sign*1.35,p.y,p.z)),Vector((-sign,0,0)))
  if not hit:raise RuntimeError('Flank wordmark missed shell: '+mark.name)
  vertex.co=inverse@Vector((pt.x+sign*.0015,pt.y,pt.z))
 mark.data.update()
# Sidewall ink follows the actual radial shoulder. A flat glyph clipped at its
# foot on the previous tyre and floated above the rubber at its outer edge.
for pivot in wheelgroups:
 width=.305 if pivot.name.startswith('Front') else .405
 profile=[(.228,.5),(.260,.52),(.285,.525),(.316,.49),(.341,.43),(.357,.34),(.361,.20)]
 bpy.context.view_layer.update()
 for o in pivot.children:
  if o.type!='MESH' or not o.name.startswith(('Mark ','Sidewall segment','Compound sidewall ink')):continue
  transform=pivot.matrix_world.inverted()@o.matrix_world;inverse=transform.inverted()
  for vertex in o.data.vertices:
   pt=transform@vertex.co;r=math.hypot(pt.y,pt.z)
   for (r0,w0),(r1,w1) in zip(profile,profile[1:]):
    if r0<=r<=r1:
     pt.x=math.copysign(width*(w0+(w1-w0)*(r-r0)/(r1-r0))+.00065,pt.x)
     vertex.co=inverse@pt;break
  o.data.update()
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
 if o.type=='MESH' and o.parent not in [floor,decals,numberA,numberB] and len(o.data.polygons)>500 and not any(m.name in ['Livery','Ivory','Rubber','GloveFabric','Sleeve','HelmetPaint','HelmetInk'] for m in o.data.materials):
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
def save_occlusion(image,filename):
 # Bake values are neutral. A single PNG channel carries the same shadow
 # while leaving more of the inline host budget available for geometry.
 scene=bpy.context.scene;settings=scene.render.image_settings
 old=(settings.file_format,settings.color_mode,scene.view_settings.view_transform,scene.view_settings.look)
 scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
 settings.file_format='PNG';settings.color_mode='BW'
 image.filepath_raw=str(OUT/filename);image.save_render(image.filepath_raw,scene=scene)
 settings.file_format,settings.color_mode=old[:2]
 scene.view_settings.view_transform,scene.view_settings.look=old[2:]
save_occlusion(ao,'jgp26-ao.png')
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
save_occlusion(contact,'jgp26-contact.png');bpy.data.objects.remove(ground,do_unlink=True)
# Apply the mould ink to the tyre surface itself. Its independent UV set
# follows the sidewall, including deformation under load and the distance LOD.
print_image=bpy.data.images.load(str(OUT/'slick-print.png'));print_image.pack()
tyre_rubber=rubber.copy();tyre_rubber.name='SlickRubber'
nodes=tyre_rubber.node_tree.nodes;links=tyre_rubber.node_tree.links
ink_map=nodes.new('ShaderNodeTexImage');ink_map.image=print_image
coords=nodes.new('ShaderNodeUVMap');coords.uv_map='SidewallInk'
links.new(coords.outputs['UV'],ink_map.inputs['Vector'])
links.new(ink_map.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
for pivot in wheelgroups:
 tyre=next(o for o in pivot.children if o.type=='MESH' and o.data.materials[0]==rubber)
 tyre.data.materials[0]=tyre_rubber
 width=.305 if pivot.name.startswith('Front') else .405
 uv=tyre.data.uv_layers.new(name='SidewallInk')
 local=pivot.matrix_world.inverted()@tyre.matrix_world
 for poly in tyre.data.polygons:
  for li in poly.loop_indices:
   co=local@tyre.data.vertices[tyre.data.loops[li].vertex_index].co
   # Both faces read clockwise from outside. The central tread is unprinted.
   uv.data[li].uv=(.5-math.copysign(1,co.x)*co.z/.729,.5+co.y/.729) if abs((local@poly.center).x)>width*.39 else (0,0)
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
