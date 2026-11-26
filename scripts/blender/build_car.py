"""Original JGP-26 model. Run with Blender --background --python scripts/blender/build_car.py.
Coordinates deliberately use glTF axes: X lateral, Y up, +Z forward. Metres.
Reference: approved SF–26 clip; includes reference sponsor markings.
"""
import bpy, bmesh, math, json, os, sys, gzip
from mathutils import Vector
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from cockpit import build_halo, build_driver, closed_rings
from cowling_finish import add_export_weights, apply_blender_finish
ROOT=Path(__file__).resolve().parents[2]
bpy.context.preferences.filepaths.save_version=0
OUT=ROOT/'src/race/assets'; OUT.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
font_path=Path(os.environ.get('JGP_FONT','/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'))
brandfont=bpy.data.fonts.load(str(font_path)) if font_path.exists() else bpy.data.fonts.get('Bfont')
sidepods={}
def mat(name,hex,rough=.4,metal=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*[(int(hex[i:i+2],16)/255/12.92 if int(hex[i:i+2],16)/255<=.04045 else ((int(hex[i:i+2],16)/255+.055)/1.055)**2.4) for i in (0,2,4)],1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=m.diffuse_color; p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 return m
paint=mat('Livery','c80820',.4,.08);white=mat('Ivory','f4f3ef',.38,.03);carbon=mat('Carbon','15191e',.3,.22);rubber=mat('Rubber','101114',.85);metal=mat('Titanium','959ba2',.25,.85);black=mat('Cavity','030406',.7);red=mat('ButtonRed','da152c',.32);green=mat('ButtonGreen','23aa52',.32);blue=mat('ButtonBlue','155bd2',.32);yellow=mat('ButtonYellow','f1cb18',.32);silver=mat('MarkWhite','eeeef1',.46);brandblue=mat('BrandBlue','008ad3',.35);gold=mat('BrandGold','f4c01a',.4);screen=mat('Screen','030809',.27)
# Each animation group is batched by material at export.
groups={}
def group(name):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);groups[name]=o;return o
body=group('Chassis');decals=group('ConformalDecals');decals.parent=body;steer=group('Steering');steer.location=(0,.516,.132);steer.rotation_euler.x=.32;flap=group('DRS');flap.location=(0,.87,-2.42)
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
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=5 if name.startswith('Gearcase ') else 10;cu.bevel_depth=r;cu.bevel_resolution=3;cu.use_fill_caps=True;s=cu.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
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
 v=[];f=[];nx,n=(28 if side else 48),12
 if name.startswith('Front'):
  nx,n=(30 if side else 54),17
 elif name in ('Rear main plane','DRS flap'):
  nx,n=42,10
 section=[]
 for surface in [1,-1]:
  samples=8 if name.startswith('Front') and surface<0 else n
  for j in range(samples+1):
   u=(1-math.cos(math.pi*(j if surface==1 else samples-j)/samples))/2
   thickness_ratio=.059 if name.startswith('Front') else .086
   thick=5*thickness_ratio*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)*chord
   section.append((u,chord*.045*math.sin(math.pi*u)+surface*(thick+.0003)))
 ns=len(section)
 for i in range(nx+1):
  x=side*(root_width+(span/2-root_width)*i/nx) if side else (i/nx-.5)*span;t=abs(x)/(span/2)
  # The flaps twist outboard, relieving load near the endplate.
  front=name.startswith('Front')
  arch=math.sin(math.pi*t)**2
  local_chord=chord*(.87+.18*arch+.09*t*t if front and side else 1-.12*t*t)
  incidence=(.14+.05*arch-.07*t) if front else (.48 if name=='DRS flap' else .33)*(1-.34*t*t)
  if name in ('Front lower flap','Front upper flap'):
   # The inner slot rolls under the nose while the outboard print stays flat.
   local_chord+=(.103 if name=='Front lower flap' else .068)*(1-t)**2
   incidence+=(.219 if name=='Front lower flap' else .222)*(1-t)**2
  for u,h in section:
   tip_roll=.017*t**7*(1-u)**2 if name=='Front mainplane' else 0
   height=y+lift*t*t+h+tip_roll+(u-.35)*incidence*local_chord
   station=z+(.5-u)*local_chord-sweep*t*t+(.030*arch if front else 0)
   if name in ('Front lower flap','Front upper flap'):
    # Roll the slot's inner lip towards the nose and retain the endplate mounting angle.
    blend=max(0.,1-(abs(x)/.73)**2)**2
    height+=blend*(0.02400*(station-z)/.30)
   v.append((x,height,station))
 for i in range(nx):
  for j in range(ns):a=i*ns+j;b=i*ns+(j+1)%ns;f.append((a,b,b+ns,a+ns))
 f.extend([tuple(reversed(range(ns))),tuple(nx*ns+j for j in range(ns))])
 return mesh(name,v,f,m,parent)
# Keep stable object names for the later surface projections.
reference_lettering={
 'AURORA': 'UniCredit',
 'NEXUS': 'IBM',
 'VECTOR': 'brembo',
 'SOLAR': 'MAHLE',
 'KINETIC': 'ZYN',
 'AEROLINK': 'RICHARD MILLE',
 'V-PULSE': 'V-Power',
 'PERIGEE': 'PERONI',
 'VOLT': 'Ray-Ban',
}
def text(label,pos,size,m=silver,rotation=(0,0,0),parent=body):
 cu=bpy.data.curves.new('Mark '+label,'FONT');cu.body=reference_lettering.get(label,label);cu.font=brandfont;cu.align_x='CENTER';cu.align_y='CENTER';cu.size=size;cu.shear=.14 if label in ['44','63','NEXUS'] else 0;cu.extrude=0;cu.fill_mode='FRONT';cu.offset=.0006 if len(label)==1 else 0;cu.resolution_u=2
 o=bpy.data.objects.new('Mark '+label,cu);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=rotation;o.data.materials.append(m);o.parent=parent;return o
dish=mat('WheelDish','1a1e20',.185,.43);brake=mat('BrakeDisc','565859',.63,.45);sleeve=mat('Sleeve','60212b',.9)
secondary=mat('DeepLivery','56091f',.33,.17);tyreink=mat('CompoundInk','b6b2a4',.78)
mirror=mat('Mirror','b8c4cc',.08,.9)
# Thin floor and sculpted venturi channels, curled edge rails, rear diffuser.
floor=group('Floor');floor.parent=body
fence_laminate=carbon.copy();fence_laminate.name='FloorFence'
# A single formed sheet runs over both tunnels. Its return at the exit
# closes only the laminate thickness, leaving the air passages open.
def ramp_height(z,u):
 # Flat ahead of the rear axle approach, then a progressive expansion.
 # The central spine blends into the impact structure below the exhaust.
 progress=max(0,min(1,(-z-1.54)/1.18))
 span=min(1,abs(u)/.27)
 span=span*span*(3-2*span)
 return progress**1.65*(.145+.116*span-.021*abs(u)**5)
sections=interp([[-2.72,.775,.074,.010],[-2.40,.571,.071,.014],[-2.05,.545,.068,.018],
                 [-1.48,.87,.065,.029],[-.72,.89,.065,.034],[-.10,.913,.065,.031],[.36,.979,.064,.028],[.67,1.007,.064,.023],[.90,.995,.076,.021]],7)
# Keep the panel flow roughly uniform as the forward station spacing opens up.
floor_rows=[]
for a,b in zip(sections,sections[1:]):
 cuts=max(1,math.ceil((b[0]-a[0])/.08))
 floor_rows.extend([[lo+(hi-lo)*k/cuts for lo,hi in zip(a,b)] for k in range(cuts)])
sections=floor_rows+[sections[-1]]
# The illuminated outer edge in frame 007 fixes the planform independently
# of the slant of the rows in the floor skin. Keep the tunnel centres in place.
edge_stations=interp([[-2.72,.775],[-2.53,.704],[-2.40,.571],[-2.22,.546],[-2.05,.544],[-1.82,.546],[-1.65,.612],
                      [-1.49,.655],[-1.28,.720],[-.94,.787],[-.63,.835],[-.38,.847],
                      [-.18,.850],[.12,.856],[.23,.867],[.37,.900],[.515,.943],
                      [.67,.997],[.82,1.045],[.90,1.040]],4)
def floor_width(z):
 for (za,wa),(zb,wb) in zip(edge_stations,edge_stations[1:]):
  if z<=zb:return wa+(wb-wa)*max(0.,(z-za)/(zb-za))
 return edge_stations[-1][1]
vv=[];ff=[];N=27
for bottom in [False,True]:
 for z,w,base,gauge in sections:
  for i in range(N+1):
   u=i/N*2-1
   u+=.040*math.sin(math.pi*u)
   under=base+ramp_height(z,u)
   # The outer carbon edge tapers to a thin return. The rows sweep
   # into the edge ahead of the tunnel without moving either end station.
   row_sweep=.245*abs(u)**1.7*max(0,min(1,(z+1.55)/.40,(.90-z)/.38))
   top=under+gauge*(1-.70*abs(u)**3)+.005*abs(u)**12
   station=z+row_sweep
   x=u*(w+(floor_width(station)-w)*abs(u)**2)
   vv.append((x,under if bottom else top,station))
stride=N+1;layer=len(sections)*stride
for j in range(len(sections)-1):
 for i in range(N):
  k=j*stride+i;ff.append((k,k+stride,k+stride+1,k+1));ff.append((layer+k+1,layer+k+stride+1,layer+k+stride,layer+k))
# Roll the exposed laminate back to its underside. The same continuous rim
# catches the light in colour, clay and the translucent inspection mesh.
for i,side in [(0,-1),(N,1)]:
 last=None
 for j in range(len(sections)):
  k=j*stride+i;xt,yt,z=vv[k];yb=vv[layer+k][1];ym=(yt+yb)*.5
  rim=[k]
  for a in (math.pi/4,math.pi/2,3*math.pi/4):
   rim.append(len(vv));vv.append((xt+side*.0038*math.sin(a),ym+(yt-ym)*math.cos(a),z))
  rim.append(layer+k)
  if j in (0,len(sections)-1):ff.append(tuple(rim if (j==0)==(side<0) else reversed(rim)))
  if last:
   for a,b,c,d in zip(last,last[1:],rim,rim[1:]):ff.append((a,b,d,c) if side<0 else (a,c,d,b))
  last=rim
for j in [0,len(sections)-1]:
 for i in range(N):k=j*stride+i;ff.append((k,k+1,layer+k+1,layer+k))
mesh('Continuous floor shell',vv,ff,carbon,floor)

for s in [-1,1]:
 # A tapered, folded edge wing follows the Venturi tunnel and kicks up aft.
 for lane in range(2):
  vv=[];ff=[]
  rail=interp([[-2.38,.70,.18,.014],[-1.73,.81,.14,.052],[-1.18,.858,.16,.066],
               [-.59,.865,.116,.059],[-.33,.871,.113,.034],[-.17,.877,.103,.005]],5)
  for z,x,y,w in rail:
   x=min(x,floor_width(z)-.023)-lane*.068
   for t,h in [(-1,.002),(-.7,.010),(.65,.019),(1,.032),(1,.026),(.4,.011),(-.68,.003),(-1,0)]:
    vv.append((s*(x+w*.5*t),y+h-lane*.026,z))
  for j in range(len(rail)-1):
   for k in range(8):
    i=j*8+k;n=j*8+(k+1)%8;ff.append((i,n,n+8,i+8))
  mesh('Swept floor edge wing',vv,ff,carbon,floor)
 # Frame 007 resolves five corners on each upright. Preserve the large
 # planar facets and the individual diagonals across the upright face.
 for lane in range(3):
  lateral=(.4847,.6231,.7720)[lane]
  # The crest, forward step and bottom junction are distinct in frame 007.
  profile=[(.337,.135),(.500,.260),(.730,.299),(.829,.229),(.823,.092),(.599,.104)]
  vs=[];fs=[];n=len(profile)
  for wall in (-1,1):
   for z,h in profile:
    vs.append((s*(lateral+.0035*wall+.012*(h-.10)/.16),h,z+(-.0062,0,.0012)[lane]))
  for face in ((0,1,5),(1,3,5),(1,2,3),(3,4,5)):
   fs.extend([tuple(reversed(face)),tuple(n+k for k in face)])
  for k in range(n):
   j=(k+1)%n;fs.append((k,j,n+j,n+k))
  upright=mesh('Faceted floor inlet fence',vs,fs,fence_laminate,floor)
  for f in upright.data.polygons:f.use_smooth=False
 # Outer lip is a rounded vertical cheek with a rising crown, separate
 # from the three interior fences. Its heel is moulded into the floor.
 vs=[];fs=[]
 for j,(z,base,h) in enumerate(interp([[.529,.092,.104],[.564,.092,.145],
                                     [.645,.093,.255],[.714,.090,.309],
                                     [.748,.088,.300],[.777,.090,.229],[.810,.096,.108]],4)):
  for dx,y in [(0,base),(-.003,base+(h-base)*.50),(-.008,h-.008),
               (-.013,h),(-.018,h-.007),(-.015,base+(h-base)*.48),(-.013,base)]:
   vs.append((s*(floor_width(z)-.004+dx),y,z))
  if j:
   for k in range(7):
    a=(j-1)*7+k;b=(j-1)*7+(k+1)%7;fs.append((a,b,b+7,a+7))
 mesh('Rounded outer floor cheek',vs,fs,fence_laminate,floor)
# Recess each fence into the underside. Sample its root from the same sheet
# as the deck so no fence can pierce the upper surface as the mouth flares.
for side in (-1,1):
 for outer in (False,True):
  vv=[];ff=[]
  for z,w,base,gauge in reversed(sections):
   if z>-1.76 or (not outer and z<-2.675):continue
   run=min(1,(-z-1.76)/.96)
   u=.988 if outer else .30+.045*run
   roof=base+ramp_height(z,u)
   floor_y=min(roof-.003,base+.009+.018*run)
   centre=side*u*(w+(floor_width(z)-w)*u*u)
   for dx,y in [(-.003,roof+.001),(.003,roof+.001),(.002,floor_y),(-.002,floor_y)]:
    vv.append((centre+dx,y,z))
   k=len(vv)-8
   if k>=0:
    for i in range(4):ff.append((k+i,k+(i+1)%4,k+(i+1)%4+4,k+i+4))
  ff.extend([(3,2,1,0),tuple(range(len(vv)-4,len(vv)))])
  mesh('Diffuser outer end wall' if outer else 'Recessed diffuser strake',vv,ff,carbon,floor)
 # One narrow folded flange traces the trailing edge on each side of the lamp.
 vs=[];fs=[];z,w,base,gauge=sections[0]
 for k in range(22):
  u=.092+.908*k/21
  x=side*u*(w+(floor_width(z)-w)*u*u)
  top=base+ramp_height(z,u)+gauge*(1-.70*u**3)+.005*u**12
  for dz,dy in [(0,-.002),(-.0015,.008),(.002,.009),(.004,0)]:vs.append((x,top+dy,z+dz))
  if k:
   for j in range(4):
    i=(k-1)*4+j;n=(k-1)*4+(j+1)%4;fs.append((i,n,n+4,i+4))
 fs.extend([(3,2,1,0),tuple(range(len(vs)-4,len(vs)))])
 mesh('Diffuser trailing flange',vs,fs,carbon,floor)

# Raised tapering nose; no box-shaped body.
# Full survival cell from the rear bulkhead to the deformable nose cone.
# The square upper shoulders flow into the radiator decks and no exposed
# vertical cap is left beside the forward end of the cockpit.
loft('Nose',[[-1.55,0,.159,.20,.46],[-1.15,0,.252,.18,.548],[-.82,0,.317,.182,.624],
 [-.42,0,.362,.173,.640],[-.04,0,.391,.169,.651],[.27,0,.384,.173,.657],
 [.49,0,.382,.157,.649],[.77,0,.365,.166,.637],[1.20,0,.302,.229,.564],
 [1.84,0,.213,.238,.462],[2.34,0,.153,.199,.339],[2.61,0,.115,.178,.257],
 [2.82,0,.077,.185,.239],[2.89,0,.041,.199,.235],[2.905,0,.022,.209,.231]],paint,n=48,power=.38)
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
def mouth_sweep(x):
 # The carbon letterbox wraps back at the outer shoulder of each radiator.
 return -.101*min(1.,abs((abs(x)-.55)/.25))**2
for s in [-1,1]:

 loft('Inner carbon cockpit wall',[[-.8,s*.22,.03,.36,.65],[-.4,s*.285,.025,.36,.65],[.13,s*.285,.025,.35,.61]],carbon)
 # Continuous radiator fairing. A high inlet lip broadens into the outer
 # shoulder while the lower wall sweeps back beneath it into the coke bottle.
 stations=interp([[-2.03,.15,.31,.192,.376],[-1.65,.12,.525,.156,.496],[-1.22,.12,.721,.148,.580],
                  [-.88,.13,.836,.146,.630],[-.52,.155,.887,.182,.675],[-.18,.18,.889,.226,.677],
                  [.08,.207,.861,.282,.674],[.259,.252,.842,.344,.665],[.397,.288,.821,.404,.653],
                  [.484,.300,.797,.463,.633]],6)
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
   x-=.073*ramp*math.exp(-((v-.26)/.20)**2)*max(0,(u-.40)/.60)
   channel=.042*ramp*math.exp(-((u-.49)/.20)**2)*max(0,2*v-1)
   # Draw the lower outboard corner inwards as the mouth turns up.
   x-=.037*max(0,min(1,(z+.06)/.48))**2*max(0,1-v)**2*u
   # The lower shell kicks upwards at the mouth while the upper inlet lip stays level.
   lip_rise=.020*max(0,min(1,(z-.10)/.36))**2*max(0,1-v)**1.5
   vv.append((s*x,bottom+(top-bottom)*v-channel+lip_rise,z+max(0,(z-.18)/.304)*(.066*(v-.5)+mouth_sweep(x))))
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
  pts.append((math.copysign(abs(c)**.52,c)*.248,math.copysign(abs(t)**.62,t)*.064))
 vv=[]
 for depth,scale in [(0,1.08),(.008,1),(-.13,.80)]:
  for x,y in pts:
   lip_y=.549+y*scale
   lip_z=.498+depth+.42*y+mouth_sweep(s*.55+x*scale)
   # The lower return rolls down and forwards from the throat at the outer lip.
   roll=max(0.,min(1.,(.549-lip_y)/.064))**1.4*max(0.,min(1.,(lip_z-.36)/.13))
   vv.append((s*.55+x*scale,lip_y-0.02465*roll,lip_z+0.03625*roll))
 ff=[]
 for k in range(2):
  for j in range(48):ff.append((k*48+j,k*48+(j+1)%48,(k+1)*48+(j+1)%48,(k+1)*48+j))
 mesh('Continuous rolled inlet lip',vv,ff,carbon)
 # White shoulder fairing blends the cockpit edge into the red downwash body.
 loft('Cockpit shoulder',[[-1.55,s*.25,.07,.39,.51],[-1.15,s*.29,.22,.399,.635],[-.84,s*.34,.25,.421,.712],[-.45,s*.385,.237,.436,.697],[.02,s*.405,.211,.474,.685],[.28,s*.41,.17,.552,.675],[.50,s*.353,.073,.533,.616]],white,power=.9)
 box('Deep intake throat',(s*.55,.548,.345),(.45,.103,.005),black,r=.012)
 # The radiator sits deep behind the opening. Each fin has a return edge
 # that catches a narrow highlight against the black plenum.
 finverts=[];finfaces=[]
 for column in range(-14,15):
  x=s*.55+column*.0125
  for y in [.511,.536,.561,.586]:
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
 text('63',(s*.014,.833,-1.854),.305,silver,(0,s*math.pi/2,0),numberB)
 text('ION',(s*.38,.61,-.2),.058,black,(0,s*math.pi/2,0))
# Halo carbon arch, centre pillar, camera pod.
build_halo(mesh, interp, carbon, metal, black, rod)
box('T camera',(0,1.15,-.72),(.28,.042,.058),carbon,r=.012)
rod('Camera pedestal',(0,1.09,-.72),(0,1.14,-.72),.022)
# Mainplane and two slotted flaps on either side of the nose.
aero=mat('AeroLaminate','191e25',.52,.05)
front_fence=mat('FrontFenceLaminate','15181f',.52,.05)
upper_laminate=mat('Upper flap laminate','151920',.52,.05)
upper_laminate.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value=.12
def ink_material(name,file):
 material=mat(name,'ffffff',.52)
 image=bpy.data.images.load(str(Path(__file__).parent/'textures'/file))
 image.pack()
 nodes=material.node_tree.nodes;links=material.node_tree.links
 texture=nodes.new('ShaderNodeTexImage');texture.image=image
 uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Printed ink'
 links.new(uv.outputs['UV'],texture.inputs['Vector'])
 shader=nodes.get('Principled BSDF')
 links.new(texture.outputs['Color'],shader.inputs['Base Color'])
 links.new(texture.outputs['Alpha'],shader.inputs['Alpha'])
 return material

def print_grid(name,material,sample,cols,rows,reverse=False,atlas_row=None,parent=decals):
 points=[];faces=[];coords=[]
 for j in range(rows+1):
  for i in range(cols+1):
   u,v=i/cols,j/rows
   points.append(sample(u,v));coords.append((1-u if reverse else u,1-v if atlas_row is None else 1-(atlas_row+v)/7))
   if i and j:
    k=len(points)-1;faces.append((k-cols-2,k-cols-1,k,k-1))
 obj=mesh(name,points,faces,material,parent)
 # The AO unwrap operates on the first UV set. Ink keeps its panel coordinates.
 atlas=obj.data.uv_layers.new(name='UVMap')
 ink=obj.data.uv_layers.new(name='Printed ink')
 for loop in obj.data.loops:ink.data[loop.index].uv=coords[loop.vertex_index]
 obj.data.uv_layers.active=atlas
 return obj

fence_ink=ink_material('FenceInk','rear-fence-ink.png')
bank_ink=ink_material('BankInk','front-bank-ink.png')
bank_ink.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value=.14
foil_ink=ink_material('FoilInk','front-foil-ink.png')
front_half=.806
mainplane=wing('Front mainplane',2*front_half,2.704,.098,.439,aero,sweep=.096,lift=.026)
lower_foils={}
upper_foils={}
for side in (-1,1):
 lower_foils[side]=wing('Front lower flap',2*front_half,2.480,.146,.286,aero,
      sweep=.123,lift=.037,side=side,root_width=.104)
 upper_foils[side]=wing('Front upper flap',2*front_half,2.278,.191,.246,upper_laminate,
                       sweep=.098,lift=.041,side=side,root_width=.145)
 for distance in (.36,.69):
  for z,y in [(2.542,.129),(2.356,.171)]:
   at=z-(.174 if y<.15 else .110)*(distance/front_half)**2
   panel('Front lower flap bridge' if y<.15 else 'Front upper flap bridge',[(side*distance,y-.013,at+.035),(side*distance,y+.033,at-.024),
         (side*distance,y+.040,at-.012),(side*distance,y,at+.046)],.006,aero)
 # The barrel straddles two short mounting ears on the upper flap.
 foil=upper_foils[side]
 pins=[]
 for xx,zz in ((.441,2.307),(.381,2.360)):
  hit,pt,normal,_=foil.ray_cast(Vector((side*xx,.60,zz)),Vector((0,-1,0)))
  if not hit:raise RuntimeError('Front flap adjuster missed its foil')
  pin=pt+.010*normal
  rod('Front upper flap adjuster ear',pt-.001*normal,pin,.0047,aero,vertices=12)
  pins.append(pin)
 rod('Front upper flap adjuster screw',pins[0],pins[1],.0026,metal,vertices=12)
for s in [-1,1]:
 # The near plate in frames 007 and 010 has a long crown and a short,
 # almost vertical leading edge. Its foot wraps forward under that edge.
 sections=interp([[2.818,.808,.148,.163],[2.804,.809,.128,.228],[2.764,.809,.119,.282],
                  [2.680,.807,.118,.334],[2.551,.806,.118,.354],[2.408,.805,.122,.343],
                  [2.246,.804,.135,.310],[2.111,.804,.152,.289],[1.982,.801,.177,.251]],4)
 vv=[];ff=[]
 for j,(z,edge,base,tip) in enumerate(sections):
  rim=[(-.032,0),(-.014,.020),(-.004,.085)]
  # Even rows over the exposed vertical laminate resolve the thin fence
  # in wireframe without a fan of triangles from top to foot.
  for h in (.16,.31,.46,.61,.76,.89,.97):
   rim.append((.003+.004*h,h))
  rim.extend([(.005,1),(.000,.99)])
  for h in (.89,.76,.61,.46,.31,.16):
   rim.append((-.004+.004*h,h))
  rim.extend([(-.010,.08),(-.022,.025),(-.032,.024)])
  for x,h in rim:
   vv.append((s*(edge+x),base+(tip-base)*h,z))
  if j:
   n=len(rim)
   for k in range(n):
    i=(j-1)*n+k;adj=(j-1)*n+(k+1)%n;ff.append((i,adj,adj+n,i+n))
 mesh('Radiused outboard wing return',vv,ff,front_fence)
 vv=[];ff=[]
 for y,x,z,half,depth in [[.104,.115,2.704,.018,.073],[.152,.111,2.692,.016,.063],[.192,.096,2.674,.016,.058],[.249,.077,2.643,.021,.055]]:
  for k in range(20):
   a=k*math.tau/20;vv.append((s*x+half*math.cos(a)*(1+.32*math.sin(a)),y,z+depth*math.sin(a)))
 for row in range(3):
  for k in range(20):
   a=row*20+k;b=row*20+(k+1)%20;ff.append((a,b,b+20,a+20))
 mesh('Nose wing mounting blade',vv,ff,aero)
 # The large bank mark faces the grandstand on the vertical end fence.
 print_grid('Front fence ink',bank_ink,lambda u,v:(s*.815,0.317388-0.008405*u-0.161908*v,2.108631+0.536651*u-0.002351*v),1,1,reverse=s>0)
 # Thin outer foot follows the lower return into the forward tip.
 shelf=[];faces=[]
 for i,(z,edge,base,tip) in enumerate(sections):
  chord=max(0,min(1,(2.818-z)/.836))
  outer=edge+.202-.003*chord
  outer_sweep=0.024867+0.101353*(1-chord)**2
  # The upper surface rolls down from the upright to the outboard foot.
  # The visible transverse rows continue all the way to the swept corner.
  ring=[]
  for k in range(10):
   t=k/9
   drop=0.056284-0.018280*chord-.032*math.sin(math.pi*chord)
   x=(edge-.024)*(1-t)+outer*t
   y=base+.005*(1-t)-drop*t+.008*math.sin(math.pi*t)
   ring.append((s*x,y,z-outer_sweep*t))
  ring.extend([(s*outer,ring[-1][1]-.004,ring[-1][2]),(s*(edge-.024),base,z)])
  shelf.extend(ring);count=len(ring)
  if i:
   for k in range(count):
    j=(i-1)*count+k;n=(i-1)*count+(k+1)%count;faces.append((j,n,n+count,j+count))
 foot=mesh('Endplate lower flange',shelf,faces,aero)
 for face in foot.data.polygons:
  face.use_smooth=False


 # Project the signature from frame 010 onto the mainplane. Its baseline
 # follows the wing's compound sweep and reads from the outside of each tyre.
 shot=json.loads((OUT/'reference-cameras.json').read_text())['front-corner']
 back=Vector(shot['direction']).normalized()
 right=Vector((0,1,0)).cross(back).normalized()
 up=back.cross(right)
 roll=math.radians(shot['roll'])
 right,up=right*math.cos(roll)+up*math.sin(roll),up*math.cos(roll)-right*math.sin(roll)
 eye=Vector(shot['target'])+shot['distance']*back
 def foil_sample(u,v):
  px,py=1263+103*u,610+104*v
  sx,sy=shot['shift'];scale=shot['width']/shot['distance']
  direction=-back+right*((px/1440-.5+sx)*scale)+up*((.375-py/1440+sy)*scale)
  hit,point,normal,_=mainplane.ray_cast(eye,direction.normalized())
  if not hit:raise RuntimeError('Mainplane signature outside laminate')
  point.y+=.0018
  return (-s*point.x,point.y,point.z)
 print_grid('Front signature',foil_ink,foil_sample,6,6,reverse=s>0)
# Transfer the two small flap marks from frame 010 onto their curved foil faces.
# Clipping the print in camera space preserves its inclination across the slot.
flap_ink=ink_material('FlapInk','front-flap-print.png')
flap_ink.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value=.12
def stamp_flap(foil,rect,slot):
 x0,y0,x1,y1=rect
 points=[];faces=[];tex=[]
 for face in foil.data.polygons:
  if face.normal.y<.1:continue
  polygon=[]
  for i in face.vertices:
   pos=foil.data.vertices[i].co
   delta=pos-eye
   depth=-delta.dot(back)
   k=850*shot['distance']/(shot['width']*depth)
   px=850*(.5-shot['shift'][0])+k*delta.dot(right)
   py=850*(.375+shot['shift'][1])-k*delta.dot(up)
   polygon.append(Vector((px,py)))
  for dim,edge,sign in [(0,x0,1),(0,x1,-1),(1,y0,1),(1,y1,-1)]:
   clipped=[]
   for a,b in zip(polygon,polygon[1:]+polygon[:1]):
    da,db=sign*(a[dim]-edge),sign*(b[dim]-edge)
    if da>=0:clipped.append(a)
    if (da>=0)!=(db>=0):clipped.append(a.lerp(b,da/(da-db)))
   polygon=clipped
  if len(polygon)<3:continue
  ring=[]
  for px,py in polygon:
   direction=-back+right*((px/850-.5+shot['shift'][0])*scale)+up*((.375-py/850+shot['shift'][1])*scale)
   # Recover the true depth on this face before mirroring the print for the other wing.
   d=face.normal.dot(direction)
   if abs(d)<1e-8:break
   pos=eye+direction*(face.normal.dot(face.center-eye)/d)
   ring.append(len(points));points.append((pos.x,pos.y+.0018,pos.z))
   tex.append(((slot+(px-x0)/(x1-x0))/2,1-(py-y0)/(y1-y0)))
  if len(ring)==len(polygon):faces.append(ring)
 if not faces:raise RuntimeError('No front foil under reference print')
 for side in (-1,1):
  pts=[(-side*x,y,z) for x,y,z in points]
  obj=mesh('Front '+('foil blue badge' if slot==0 else 'lower flap print'),pts,faces,flap_ink,decals)
  base=obj.data.uv_layers.new(name='UVMap')
  ink=obj.data.uv_layers.new(name='Printed ink')
  for loop in obj.data.loops:
   u,v=tex[loop.vertex_index]
   # Reflect within this mark's half of the atlas when mirroring the foil.
   ink.data[loop.index].uv=(slot+.5-u if side>0 else u,v)
  obj.data.uv_layers.active=base
scale=shot['width']/shot['distance']
stamp_flap(upper_foils[-1],(580,296,628,324),0)
stamp_flap(lower_foils[-1],(672,311,724,351),1)
# Rear wing, twin swan necks and active-aero actuator.
wing('Rear main plane',1.58,-2.395,.762,.390,carbon,sweep=.026,lift=.041)
wing('DRS flap',1.57,-.114,-.021,.283,carbon,flap,sweep=.021,lift=.036)
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
fence_carbon=mat('RearFenceCarbon','242426',.46,.17)
for s in [-1,1]:
 # Long upper rail, near-vertical trailing edge and swept lower leading edge.
 outline=[(-2.68600,0.91830),(-2.64650,0.91740),(-2.16510,0.92350),(-2.09580,0.92250),(-2.07510,0.90810),
          (-2.07770,0.85280),(-2.10760,0.78110),(-2.17111,0.70491),(-2.25365,0.62221),(-2.32219,0.56003),
          (-2.36157,0.52484),(-2.45722,0.45507),(-2.53224,0.43150),(-2.58707,0.42914),(-2.62234,0.45362),
          (-2.64485,0.49684),(-2.66930,0.65600),(-2.70010,0.74560)]
 panel('Rear endplate',[(s*.79,y,z) for z,y in outline],.016,fence_carbon)
 # The two swept blades seat in the mainplane at its forward spar.
 vv=[];ff=[]
 for j,(height,z,half) in enumerate(interp([[.279,-2.065,.076],[.38,-2.127,.060],
      [.57,-2.246,.033],[.697,-2.315,.032],[.761,-2.346,.049]],3)):
  for k in range(12):
   a=math.tau*k/12
   foot=max(0.,min(1.,(.475-height)/.196))**1.4
   vv.append((s*.139+.008*math.sin(a),height-0.03915*foot,z+half*math.cos(a)))
   if j:
    i=(j-1)*12+k;n=(j-1)*12+(k+1)%12;ff.append((i,n,n+12,i+12))
 ff.extend([tuple(reversed(range(12))),tuple(range(len(vv)-12,len(vv)))])
 mesh('Swan neck rear support',vv,ff,carbon)
 # Rectified V-Power, scallop and Peroni lettering on the outboard fence.
 def fence_sample(u,v):
  # The sponsor baseline follows the swept upper edge; the Peroni line
  # sits lower on the panel than a rectangular projection would place it.
  return (s*.800,0.892499+0.014320*u-0.226779*v,-2.637891+0.435022*u+0.004801*v)
 print_grid('Rear fence sponsor print',fence_ink,fence_sample,1,1,reverse=s>0)
box('DRS hydraulic pod',(0,.885,-2.3),(.065,.075,.19),carbon,r=.025);rod('DRS ram',(0,.88,-2.32),(0,.89,-2.46),.009,metal)
# Rear impact attenuator supports the tail lamp between the two tunnel exits.
loft('Rear carbon impact casing',[[-2.736,0,.071,.198,.291],[-2.61,0,.083,.182,.301],
 [-2.42,0,.086,.154,.330],[-2.20,0,.135,.132,.358]],carbon,n=16,power=.43)
heat=mat('OxidisedTitanium','615a50',.32,.77)
gear_steel=mat('Ground steel','a8aeb0',.21,.91)
gear_web=mat('Machined gear web','555b5f',.30,.82)
shaft_steel=mat('Turned shaft steel','7a8082',.15,.92)
weld=mat('HeatAffectedAlloy','585466',.33,.78)
lining=mat('ExhaustLiner','322d2b',.74,.29)
def tail_rings(name,rows,material,segments=36):
 vv=[];ff=[]
 for j,(z,y,rx,ry) in enumerate(rows):
  for k in range(segments):
   a=math.tau*k/segments;vv.append((.65*rx*math.cos(a),y+.65*ry*math.sin(a),z))
  if j:
   for k in range(segments):
    a=(j-1)*segments+k;b=(j-1)*segments+(k+1)%segments;ff.append((a,b,b+segments,a+segments))
 return mesh(name,vv,ff,material)
# The service sequence exposes two banks under the rear cowling. Model
# the cast rails and their three open circular ports on each side.
port_recess=mat('PortRecess','747777',.68,.12)
engine_cast=mat('Power unit casting','45474a',.50,.54)
port_alloy=mat('Machined intake bell','616769',.39,.64)
box('Power unit crankcase',(0,.336,-1.27),(.28,.190,.62),engine_cast,r=.025)
for side in (-1,1):
 axis=Vector((side*.56,.8285,0)).normalized()
 saddle=box('Power unit bank',(side*.099,.402,-1.27),(.129,.105,.58),engine_cast,r=.012)
 saddle.rotation_euler.z=-side*.594
 across=Vector((axis.y,-axis.x,0));along=Vector((0,0,1))
 # The released bank exposes narrow longitudinal ribs below the port bosses.
 # Cast the ribs into one strip following the incline of the bank face.
 vertices=[];faces=[]
 for row in range(6):
  centre=Vector((side*.160,.379,-1.27))+axis*(row*.009)
  first=len(vertices)
  for dz,lift in [(-.283,0),(-.276,.004),(.276,.004),(.283,0)]:
   for offset in (-.002,.002):
    vertices.append(centre+along*dz+across*(side*lift)+axis*offset)
  for k in range(3):
   i=first+k*2;faces.append((i,i+1,i+3,i+2))
 mesh('Power unit bank ribs',vertices,faces,engine_cast)
 for z in (-1.46,-1.27,-1.08):
  centre=Vector((side*.131,.444,z))
  vs=[];count=24
  # The exposed trumpets have a slash-cut lip. Its long diagonal crosses
  # the tube axis in the rear view. The deeper counterbore ends square to the axis.
  for rise,radius,cut in [(0,.026,0),(.062,.0277,.90),(.069,.0277,1),
                          (.069,.0238,1),(.032,.0227,.04)]:
   for k in range(count):
    angle=math.tau*k/count
    u,v=radius*math.cos(angle),radius*math.sin(angle)
    end_slope=-side*.2443*u+1.3343*v
    vs.append(centre+axis*(rise+cut*end_slope)+u*across+v*along)
  bands=[(j*count+k+count,j*count+(k+1)%count+count,j*count+(k+1)%count,j*count+k)
         for j in range(3) for k in range(count)]
  port=mesh('Power unit port',vs[:4*count],bands,port_alloy)
  for face in list(port.data.polygons)[2*count:]:face.use_smooth=False
  # The counterbore ends just behind the bright, machined annulus.
  bore=[(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
  bore.append(tuple(range(2*count-1,count-1,-1)))
  mesh('Power unit port recess',vs[3*count:],bore,port_recess)
# The exposed engine has an open tube frame above each row of port bosses.
# Sweep each rail as one tube. Tie its ends back to the bank so the cylinder
# heads and the drilled openings stay visible between the rails.
for side in (-1,1):
 path=[Vector((side*x,y,z)) for z,x,y in interp([
     [-1.68,.131,.490],[-1.62,.124,.519],[-1.56,.110,.537],
     [-1.39,.107,.542],[-1.22,.113,.544],[-1.11,.113,.546],[-.996,.101,.593]],2)]
 rings=[]
 for i,pt in enumerate(path):
  tangent=(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized()
  lateral=tangent.cross(Vector((0,1,0))).normalized()
  section_up=tangent.cross(lateral).normalized()
  rings.append([pt+.011*(lateral*math.cos(a)+section_up*math.sin(a)) for a in (j*math.tau/10 for j in range(10))])
 mesh('Power unit upper tube',*closed_rings(rings),metal)
 for z,x,y in ((-1.56,.110,.537),(-1.11,.113,.546)):
  rod('Power unit tube stay',(side*.16,.418,z-.021),(side*x,y,z),.0078,metal,vertices=8)
# A shallow formed shield spans the two cylinder banks under the removable
# cowling. The folded sides turn down past the port bosses, leaving their
# front and rear ends open. The service breakdown lifts the shield as a unit.
heat_shield=mat('Formed heat shield','777873',.47,.46)
shield_rows=interp([[-2.07,.19,.570,.069],[-1.96,.207,.580,.080],
                    [-1.54,.231,.614,.104],[-1.06,.250,.634,.120],
                    [-.79,.255,.640,.130]],3)
wall=[];faces=[]
shield_section=[(-1,-1),(-1.004,-.48),(-.975,-.14),(-.91,0),(-.69,.09),
                (0,.13),(.69,.09),(.91,0),(.975,-.14),(1.004,-.48),(1,-1)]
stride=len(shield_section)
for row,(z,w,y,drop) in enumerate(shield_rows):
 for col,(x,h) in enumerate(shield_section):
  wall.append((x*w,y+h*drop,z+.023*(1-x*x)))
  if row and col:
   i=row*stride+col;faces.append((i-stride-1,i-stride,i,i-1))
shield=mesh('Power unit heat shield',wall,faces,heat_shield)
gauge=shield.modifiers.new('Folded sheet gauge','SOLIDIFY');gauge.thickness=.0016
bpy.context.view_layer.objects.active=shield;bpy.ops.object.modifier_apply(modifier=gauge.name)
# The cast transmission case is exposed beneath the exhaust in the service view.
case_alloy=mat('Transmission alloy','383b40',.52,.69)
case_rows=interp([[-2.523,.091,.177,.351],[-2.38,.149,.157,.389],[-2.18,.173,.151,.406],
                  [-1.94,.180,.154,.407],[-1.82,.140,.181,.380]],4)
# Cast case split at its longitudinal joint. Both halves enclose the
# shafts on the running car and separate in the service view.
for side in (-1,1):
 vv=[];ff=[]
 for j,(z,r,bottom,top) in enumerate(case_rows):
  for k in range(17):
   t=math.pi*k/16
   vv.append((side*r*math.sin(t)**.73,(top+bottom)/2+(top-bottom)/2*math.cos(t),z))
   if j and k:
    a=len(vv)-1;ff.append((a-18,a-17,a,a-1))
 # The annular boss at each end seats both shafts.
 # Roll the exposed end back around the bearing at the last transverse section.
 z,r,bottom,top=case_rows[0]
 for dz,scale in [(-.009,.97),(-.017,.37)]:
  start=len(vv)
  for k in range(17):
   angle=math.pi*k/16
   vv.append((side*r*scale*math.sin(angle)**.73,(top+bottom)/2+scale*(top-bottom)*.5*math.cos(angle),z+dz))
  previous=0 if dz==-.009 else start-17
  ff.extend((previous+k,start+k,start+k+1,previous+k+1) for k in range(16))
 mesh('Gearcase removable half' if side<0 else 'Gearcase fixed half',vv,ff,case_alloy)
 for i in range(8):
  z=-2.38+i*.064
  width=.136+.033*math.sin(math.pi*(i+1)/10)
  curve('Gearcase removable rib' if side<0 else 'Gearcase fixed rib',[(side*(width-.028),.174,z+.017),
        (side*width,.222,z),(side*(width+.003),.317,z),
        (side*(width-.025),.377,z+.012)],.0038,case_alloy)
# The machined top lip and internal return of the split case catch the
# inspection light behind the gears. The running transmission encloses them.
for side in (-1,1):
 name='Gearcase removable' if side<0 else 'Gearcase fixed'
 verts=[];faces=[]
 for z,r,bottom,top in case_rows:
  for dx,dy in [(0,0),(.014,-.002),(.014,-.006),(.003,-.006)]:
   verts.append((side*dx,top+dy,z))
 for row in range(len(case_rows)-1):
  for k in range(3):
   i=4*row+k;faces.append((i,i+1,i+5,i+4))
 mesh(name+' machined flange',verts,faces,gear_web)
for shaft in (-1,1):
 cx=shaft*.044;cy=.272+shaft*.008
 tip=-2.506 if shaft<0 else -2.482
 rod('Transmission layshaft',(cx,cy,tip+.024),(cx,cy,-1.833),.018,shaft_steel,vertices=20)
 # Turned lead-in, annular face and recessed bore on the projecting shaft.
 vs=[];fs=[];segments=20
 for row,(dz,radius) in enumerate([(.025,.018),(.003,.0192),(0,.0181),(0,.0099),(.020,.0085)]):
  for i in range(segments):
   angle=i*math.tau/segments
   vs.append((cx+radius*math.cos(angle),cy+radius*math.sin(angle),tip+dz))
   if row:
    v=(row-1)*segments+i;w=(row-1)*segments+(i+1)%segments
    fs.append((v,w,w+segments,v+segments))
 nose_ring=mesh('Transmission layshaft bored end',vs[:4*segments],fs[:3*segments],shaft_steel)
 # The annular end is faced square on the lathe. Only its rim is chamfered.
 for face in list(nose_ring.data.polygons)[2*segments:]:face.use_smooth=False
 bore_faces=[tuple(k-3*segments for k in f) for f in fs[3*segments:]]
 bore_faces.append(tuple(reversed(range(segments,2*segments))))
 mesh('Transmission layshaft bore wall',vs[3*segments:],bore_faces,black)
 # Turned bearing journals separate the toothed stack from each exposed shaft end.
 for end in (-2.393,-1.894):
  rod('Transmission layshaft journal',(cx,cy,end-.006),(cx,cy,end+.006),.021,gear_steel,vertices=20)
 for station in range(8):
  z=-2.360+station*.061
  radius=.045+shaft*(station-3.5)*.0014
  teeth=round(radius*610);count=teeth*4;vs=[];fs=[]
  for row,(depth,edge_scale) in enumerate([(-.012,.89),(-.0065,1),(.011,.967)]):
   for k in range(count):
    a=math.tau*k/count+.058*row/2
    r=radius*edge_scale*(1 if k%4 in (1,2) else .86)
    vs.append((cx+r*math.cos(a),cy+r*math.sin(a),z+depth))
    if row:
     v=(row-1)*count+k;n=(row-1)*count+(k+1)%count;fs.append((v,n,n+count,v+count))
  # The darker annular webs leave the bored joint visible around the shaft.
  # Each inner ring follows the tooth pitch so the hole has a continuous rim.
  for outer_start,depth,reverse in ((0,-.012,True),(2*count,.011,False)):
   face_vs=list(vs[outer_start:outer_start+count])
   face_vs.extend((cx+.0185*math.cos(math.tau*k/teeth),cy+.0185*math.sin(math.tau*k/teeth),z+depth) for k in range(teeth))
   cheek=[]
   for tooth in range(teeth):
    arc=[(4*tooth+j)%count for j in range(5)]
    ring=arc+[count+(tooth+1)%teeth,count+tooth]
    cheek.append(tuple(reversed(ring)) if reverse else tuple(ring))
   web=mesh('Transmission gear cheek',face_vs,cheek,gear_web)
   for face in web.data.polygons:face.use_smooth=False
  gear=mesh('Transmission gear',vs,fs,gear_steel)
  # Preserve each machined flank and its bevel in the service close-up.
  for face in gear.data.polygons:face.use_smooth=False
for side in (-1,1):
 rod('Output bearing carrier',(side*.15,.305,-2.05),(side*.205,.305,-2.05),.077,case_alloy,vertices=24)
 rod('Drive half shaft',(side*.20,.305,-2.05),(side*.625,.355,-2.05),.022,metal,vertices=16)
tail_rings('Formed titanium tailpipe',[(-1.966,.385,.069,.053),(-2.082,.399,.069,.052),(-2.19,.415,.069,.053),(-2.31,.426,.064,.051),(-2.42,.434,.059,.052),
 (-2.51,.441,.059,.053),(-2.59,.446,.062,.054),(-2.677,.448,.066,.056)],heat)
tail_rings('Rolled exhaust lip',[(-2.663,.448,.065,.056),(-2.677,.448,.067,.057),(-2.683,.448,.066,.056),(-2.683,.448,.060,.050),(-2.671,.448,.059,.050)],heat)
tail_rings('Recessed exhaust throat',[(-2.672,.448,.059,.050),(-2.60,.446,.056,.049),(-2.50,.437,.051,.046),(-2.40,.428,.043,.038)],lining)
rod('Deep exhaust throat',(0,.428,-2.398),(0,.428,-2.403),.035,black,vertices=24)
for z,cy,rx in [(-2.47,.438,.059),(-2.575,.445,.061)]:
 tail_rings('Circumferential weld',[(z+.005,cy,rx,.053),(z,cy,rx+.0027,.055),(z-.005,cy,rx,.053)],weld,32)
for side in [-1,1]:
 rod('Tailpipe stay',(side*.039,.417,-2.49),(side*.088,.313,-2.44),.006,metal,vertices=7)
 rod('Rear casing fastener',(side*.061,.291,-2.606),(side*.061,.295,-2.613),.010,metal,vertices=6)
box('Tail lamp seal',(0,.245,-2.735),(.134,.082,.008),black,r=.007)
box('Recessed tail lens',(0,.245,-2.739),(.120,.069,.006),mat('TailLens','46080a',.27),r=.005)
lens=mat('TailOptic','be1d13',.24,.08)
tail_shader=lens.node_tree.nodes['Principled BSDF']
tail_shader.inputs['Emission Color'].default_value=(1,.009,.002,1)
tail_shader.inputs['Emission Strength'].default_value=1.4
# The slim optical strip is recessed into each rear fence's trailing edge.
# Its individually spaced lenses lift with the fence in the parts breakdown.
edge_lens=mat('Endplate lamp lens','f15c61',.30,.10)
edge_shader=edge_lens.node_tree.nodes['Principled BSDF']
edge_shader.inputs['Emission Color'].default_value=(.68,.032,.046,1)
edge_shader.inputs['Emission Strength'].default_value=.34
for side in (-1,1):
 top=Vector((side*.799,.9154,-2.6800));bottom=Vector((side*.799,.7480,-2.6971))
 rod('Rear endplate optic seal',top,bottom,.0048,black,vertices=10)
 for i in range(21):
  point=top.lerp(bottom,i/20)
  # Only the domed front is exposed above the rubber seal.
  glass=[point+Vector((side*.0053,0,0))]
  for k in range(8):
   a=k*math.tau/8
   glass.append(point+Vector((side*.0045,.0032*math.cos(a),.0032*math.sin(a))))
  mesh('Rear endplate light cell',glass,[(0,1+k,1+(k+1)%8) for k in range(8)],edge_lens)
for row in range(3):
 for col in range(5):
  x=(col-2)*.022;y=.245+(row-1)*.020
  rod('Individual tail optic',(x,y,-2.741),(x,y,-2.743),.0081,lens,vertices=10)
# Seated driver, modelled in metres. The camera sees the crown from behind;
# the helmet is a shaped shell with an actual curved visor, not a white ball.
helmetpaint=mat('HelmetPaint','dfc68c',.22,.32)
helmetink=mat('HelmetInk','18212e',.40)
visor=mat('HelmetVisor','283748',.085,.65)
ellipsoid('Suit shoulders',(0,.49,-.35),(.235,.135,.20),sleeve,body)
ellipsoid('Neck balaclava',(0,.61,-.32),(.085,.085,.09),black,helmet)
# Each horizontal section carries an independent width, chin and rear radius.
sections=[(.624,.099,.126,.096),(.643,.134,.174,.137),(.682,.149,.196,.164),
 (.716,.153,.195,.179),(.743,.156,.175,.183),(.795,.158,.174,.183),
 (.833,.157,.183,.181),(.856,.155,.177,.175),(.891,.143,.155,.164),
 (.926,.111,.121,.131),(.949,.065,.069,.082),(.956,.006,.009,.009)]
def helmet_point(y,a,relief=0):
 low,high=next(((l,h) for l,h in zip(sections,sections[1:]) if l[0]<=y<=h[0]),sections[-2:])
 t=min(1,max(0,(y-low[0])/(high[0]-low[0])))
 w,front,rear=[low[i]+(high[i]-low[i])*t for i in (1,2,3)]
 cheek=.010*math.exp(-((y-.717)/.024)**2)*math.sin(a)**4
 return ((w+relief-cheek)*math.sin(a),y,-.315+((front if math.cos(a)>0 else rear)+relief)*math.cos(a))
def helmet_band(name,ys,material,lo=-math.pi,hi=math.pi,relief=0,parent=helmet):
 N=64;vs=[];fs=[];uv=[]
 for j,y in enumerate(ys):
  for i in range(N+1):
   a=lo+(hi-lo)*i/N
   vs.append(helmet_point(y,a,relief));uv.append((i/N,(y-.624)/.332))
   if i and j:
    k=len(vs)-1;fs.append((k-N-2,k-N-1,k,k-1))
 obj=mesh(name,vs,fs,material,parent);layer=obj.data.uv_layers.new(name='UVMap')
 for loop in obj.data.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
 return obj
# Join the sidewall to a square-grid spherical cap. The top has four-sided
# faces, continuous normals at the rim, and a planar print island.
def helmet_shell():
 n=96;div=n//4
 vs=[];faces=[];uvs=[]
 def face(indices,uv):
  faces.append(indices);uvs.extend(uv)
 heights=[s[0] for s in sections if s[0]<=.856]
 for j,y in enumerate(heights):
  for i in range(n):
   vs.append(helmet_point(y,math.tau*i/n))
   if j:
    k=(i+1)%n
    us=[(i/n+.5)%1,((i+1)/n+.5)%1]
    if us[1]<us[0]:us[1]=1
    v0=(heights[j-1]-.624)/.664;v1=(y-.624)/.664
    face([(j-1)*n+i,(j-1)*n+k,j*n+k,j*n+i],[(us[0],v0),(us[1],v0),(us[1],v1),(us[0],v1)])
 rim=(len(heights)-1)*n
 grid=[]
 for j in range(div+1):
  row=[]
  for i in range(div+1):
   x=2*i/div-1;z=2*j/div-1;r=max(abs(x),abs(z))
   if not r:a=0
   elif z==r:a=math.pi*.25*x/r
   elif x==r:a=math.pi*.5-math.pi*.25*z/r
   elif z==-r:a=math.pi-math.pi*.25*x/r
   else:a=-math.pi*.5+math.pi*.25*z/r
   radius=math.sin(r*math.pi/2);u=radius*math.sin(a);v=radius*math.cos(a)
   if r==1:index=rim+round(a*n/math.tau)%n
   else:
    index=len(vs);vs.append((.155*u,.856+.101*math.cos(r*math.pi/2),-.315+(.177 if v>0 else .175)*v))
   row.append((index,(.5+.247*u,.75+.247*v)))
  grid.append(row)
 for j in range(div):
  for i in range(div):
   corners=[grid[j][i],grid[j+1][i],grid[j+1][i+1],grid[j][i+1]]
   face([k for k,_ in corners],[t for _,t in corners])
 obj=mesh('Helmet shell',vs,faces,helmetpaint,helmet)
 layer=obj.data.uv_layers.new(name='UVMap')
 for loop,uv in zip(layer.data,uvs):loop.uv=uv
helmet_shell()
helmet_band('Lower carbon binding',[.624,.638],carbon)
helmet_band('Visor elastomer seal',[.737,.757,.80,.838],black,-1.51,1.51,.0016)
helmet_band('Curved iridium glazing',[.746,.765,.795,.826],visor,-1.46,1.46,.0038)
helmet_band('Zylon brow reinforcement',[.825,.832,.843],carbon,-1.46,1.46,.0048)
helmet_band('Rear aero stabiliser',[.808,.818],helmetink,1.9,math.tau-1.9,.019)
helmet_band('Rear aero stabiliser root',[.819,.829],helmetink,1.9,math.tau-1.9,.009)
for side in [-1,1]:
 a=side*1.21
 p=helmet_point(.79,a,.005);q=helmet_point(.79,a,.011)
 rod('Tear-off post',p,q,.005,metal,helmet,12)
 for i in range(3):
  a=side*(.18+i*.12);x,y,z=helmet_point(.694,a,.001)
  vent=ellipsoid('Chin intake',(x,y,z),(.006,.011,.0024),black,helmet,seg=12,rings=8);vent.rotation_euler.y=a
 # The tapered blade rests on the shoulder and sweeps up behind the neck.
 path=[(.141,.565,-.267,.021),(.139,.597,-.302,.027),(.127,.616,-.354,.028),(.112,.620,-.404,.025),(.085,.630,-.442,.023),(.052,.639,-.461,.019),(0,.641,-.464,.016)]
 ribbon=[];cells=[]
 for k,(x,y,z,w) in enumerate(path):
  for dx,dy in [(-w,0),(w,0),(w,-.009),(-w,-.009)]:ribbon.append((side*(x+dx),y+dy,z))
  if k:
   for e in range(4):cells.append((4*k-4+e,4*k-4+(e+1)%4,4*k+(e+1)%4,4*k+e))
 cells.extend([(3,2,1,0),tuple(range(len(ribbon)-4,len(ribbon)))])
 bevel(mesh('HANS collar blade',ribbon,cells,carbon,body),.003,2)
 stations=[(.137,.709,-.393),(.13,.679,-.410),(.111,.641,-.433),(.091,.632,-.445)]
 strap=[(side*(x+k*.007),y,z) for x,y,z in stations for k in (-1,1)]
 mesh('Flat restraint webbing',strap,[(i,i+1,i+3,i+2) for i in (0,2,4)],black,body)
 # Driver-specific rear hardware stays bound to the constructor selection node.
 fastener=group('HelmetNumberA' if side==-1 else 'HelmetNumberB');fastener.parent=helmet
 rod('Restraint clip',helmet_point(.724,2.0,.001),helmet_point(.724,2.0,.005),.006,metal,fastener,12)
# The moulded seat and horseshoe head restraint remain visible in an empty
# showroom cockpit and shield the rear aperture around the suited driver.
seatmat=mat('SeatFoam','141717',.94)
seatmat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.12
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
# Rolled knee bolster. The crown narrows on the steering-column side and
# drops into the bucket on the driver's side. Section coordinates are metres.
lip_stations=[(.108,.301,-.164),(.101,.324,-.095),(.090,.336,-.061),
              (.076,.341,-.023),(.046,.344,.013),(.011,.345,.038),
              (-.028,.345,.058),(-.036,.345,.060),(-.065,.344,.040),
              (-.100,.340,.023),(-.130,.333,-.007),(-.141,.328,-.026),
              (-.149,.317,-.055),(-.150,.300,-.105)]
lip=interp(lip_stations,2)
vs=[];fs=[]
for j,(x,y,z) in enumerate(lip):
 along=j/(len(lip)-1);angle=math.pi*along
 # The outer edge tucks behind the tub. The small return turns away from
 # the driver and shades the hard-shell seat pan, visible through the opening.
 outer=(.273*math.cos(angle),.418+.018*math.sin(angle),-.175+.386*math.sin(angle))
 for k,(fraction,drop) in enumerate([(1,0),(.54,.008),(.19,.007),(.045,.001),(0,0),(-.008,-.008),(0,-.023)]):
  vs.append((x+fraction*(outer[0]-x),y+fraction*(outer[1]-y)+drop,z+fraction*(outer[2]-z)))
  if j and k:
   a=j*7+k;fs.append((a-8,a-7,a,a-1))
bolster_mat=mat('Knee bolster','101114',.53,.08)
bolster_mat.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.21
mesh('Rolled knee bolster',vs,fs,bolster_mat)
# The thin raised seam and two shallow pressings follow the dished seat pan.
pan_stations=[[-.139,.167,.305],[-.052,.163,.306],[-.007,.158,.310],[.047,.155,.322],[.100,.151,.331]]
vs=[];fs=[]
for j,(z,w,h) in enumerate(pan_stations):
 for k in range(11):
  u=k/5-1
  vs.append((u*w,h+.029*u*u,z))
  if j and k:
   a=j*11+k;fs.append((a-12,a-11,a,a-1))
pan_mat=mat('Seat pan laminate','0f1112',.58,.06)
mesh('Seat pan pressing',vs,fs,pan_mat)
# Forward half laps over the pan. Its edge catches a narrow grazing highlight.
edge=[(.138,.332,.001),(.092,.318,-.010),(.052,.311,-.022),(.006,.310,-.024),
      (-.048,.313,-.020),(-.101,.320,-.010),(-.144,.332,.001)]
vv=[];ff=[]
for j,(x,y,z) in enumerate(interp(edge,2)):
 for k,(rear,raise_y) in enumerate([(-.001,-.002),(-.002,.0007),(.001,.0043),(.046,.012),(.101,.026)]):
  vv.append((x,y+raise_y,z+rear))
  if j and k:
   a=j*5+k;ff.append((a-6,a-5,a,a-1))
mesh('Seat pan lapped edge',vv,ff,pan_mat)
# The radius wraps beneath the pressing. Its crown is polished by contact.
lip_mat=mat('Seat edge satin','303436',.30,.18)
edge_rings=[]
for x,y,z in interp(edge,2):
 radius=.0017*(1-.45*(abs(x)/.145)**3)
 # The outboard ends turn up clear of the foam as the pressing widens.
 flare=max(0.,(abs(x)-.071)/.074)**1.6
 edge_rings.append([(x*(1+.029*flare),y+.0003+.0037*flare+radius*math.cos(k*math.tau/6),
                    z-.0012+radius*math.sin(k*math.tau/6)) for k in range(6)])
# Each polished end curls up and inward where the pressing meets the bolster.
for ring in edge_rings:
 for k,(x,y,z) in enumerate(ring):
  end=max(0.,min(1.,(abs(x)-.059)/.084))**1.6
  ring[k]=(x-math.copysign(0.0050*end,x),y+0.0042*end,z)
mesh('Rolled seat pressing edge',*closed_rings(edge_rings),lip_mat)
for x in [-.086,-.039]:
 rib=curve('Seat pan relief',[(x,.325,-.006),(x+.004,.327,.025),(x+.003,.335,.056),(x+.009,.341,.084)],.0010,pan_mat)
 rib.data.resolution_u=3;rib.data.bevel_resolution=1
for side in [-1,1]:
 loft('Energy absorbing headrest',[[-.775,side*.146,.028,.597,.675],[-.67,side*.190,.057,.60,.697],
      [-.48,side*.227,.044,.589,.693],[-.31,side*.245,.032,.602,.673],[-.215,side*.252,.017,.610,.649]],seatmat,n=18,power=.67)
# Wheel accurate butterfly silhouette, front face towards driver (-Z).
outline=[(-.180,.057,0),(-.162,.086,0),(-.114,.081,0),(-.088,.100,0),(.088,.100,0),
 (.114,.081,0),(.162,.086,0),(.180,.057,0),(.146,.022,0),(.146,-.047,0),
 (.164,-.080,0),(.136,-.109,0),(.084,-.093,0),(.048,-.112,0),(-.048,-.112,0),
 (-.084,-.093,0),(-.136,-.109,0),(-.164,-.080,0),(-.146,-.047,0),(-.146,.022,0)]
v=[(x,y,z+d) for d in [-.018,.016] for x,y,z in outline];n=len(outline)
wheel_carbon=mat('Wheel laminate','141618',.65,.13)
bevel(mesh('Scalloped carbon wheel housing',v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],wheel_carbon,steer),.005,3)
for side in [-1,1]:
 # Oval grip sections expand beneath the heel and thumb saddle, with a
 # scalloped outer edge matching the four compressed finger pads.
 profile=interp([[.146,.065,.009,.012],[.180,.078,.014,.015],[.198,.059,.018,.020],
                 [.207,.034,.019,.021],[.210,.011,.018,.020],[.211,-.012,.019,.021],
                 [.207,-.036,.019,.022],[.202,-.060,.020,.023],[.190,-.081,.019,.020],
                 [.160,-.086,.014,.015],[.140,-.067,.010,.012]],3)
 rings=[]
 for index,(x,y,r,depth) in enumerate(profile):
  # Lower grips taper towards the heel. The upper thumb pocket is nearly flush.
  x-=.014*min(1,max(0,(x-.15)/.05));r*=1.12;depth*=1.19
  # The brow meets the upper grip below its shoulder. The lower palm pad
  # retains its full section through the steering sweep.
  shoulder=max(0,min(1,(y-.019)/.047))*max(0,min(1,(x-.135)/.034))
  x-=.008*shoulder;y-=.012*shoulder
  before,after=profile[max(0,index-1)],profile[min(len(profile)-1,index+1)]
  tangent=Vector((side*(after[0]-before[0]),after[1]-before[1],0)).normalized()
  normal=Vector((-tangent.y,tangent.x,0))
  rings.append([Vector((side*x,y,0))+normal*r*math.cos(a)+Vector((0,0,depth*math.sin(a)))
                for a in [i*math.tau/18 for i in range(18)]])
 mesh('Ergonomic rim grip',*closed_rings(rings),rubber,steer)
 # The thumb rests on a concave spoke pad at the driver-facing surface.
 thumb=interp([[.135,.013,-.020,.004,.004],[.144,.011,-.018,.010,.007],
               [.156,.004,-.018,.012,.008],[.174,-.015,-.023,.013,.009],
               [.185,-.038,-.023,.014,.010],[.199,-.048,-.010,.011,.007]],4)
 if side<0:
  # The right thumb rests on a short upright pad directly below the yellow
  # button. It broadens at the heel and blends into the outer grip.
  upright=interp([[.165,.028,-.023,.008,.004],[.173,.025,-.027,.013,.008],
                  [.177,.013,-.032,.013,.010],[.182,.000,-.028,.012,.010],
                  [.184,-.009,-.028,.011,.009],[.187,-.014,-.022,.007,.005]],3)
  rings=[[(side*(x+rx*math.cos(a)),y,z+rz*math.sin(a)) for a in
          (i*math.tau/18 for i in range(18))] for x,y,z,rx,rz in upright]
 else:
  rings=[[(side*x,y+ry*math.cos(a),z+rz*math.sin(a)) for a in (i*math.tau/16 for i in range(16))]
         for x,y,z,ry,rz in thumb]
 # The raised pad forms the contact surface for the fifth finger at full lock.
 mesh('Thumb support',*closed_rings(rings),rubber,steer)
 # A moulded rubber web closes the lower opening behind the thumb:
 # the crown around the upper fingers stays clear of the wheel buttons.
 sections=[(.132,-.065,.010,.011),(.153,-.059,.025,.015),
           (.174,-.056,.041,.026),(.188,-.060,.042,.025),(.193,-.061,.019,.015)]
 web=[[(side*x,y+ry*math.cos(j*math.tau/14),-.004+rz*math.sin(j*math.tau/14))
       for j in range(14)] for x,y,ry,rz in sections]
 mesh('Moulded grip heel',*closed_rings(web),rubber,steer)
 for yy in ([-.004,.002,.008] if side<0 else [-.010,-.004,.002,.008,.014]):
  if side<0:
   rod('Thumb encoder fluting',(side*.181,yy,-.039),(side*.187,yy+.001,-.038),.00075,wheel_carbon,steer,8)
  else:
   rod('Thumb encoder fluting',(side*.153,yy,-.020),(side*.164,yy,-.026),.0017,metal,steer,8)
# Bring the thumb contact surface forward and blend the heel into the rim.
for part in steer.children:
 if part.type!='MESH' or not part.name.startswith(('Ergonomic rim grip','Thumb support','Moulded grip heel')):continue
 for vertex in part.data.vertices:
  x,y,z=vertex.co
  contact=max(0.,min(1.,(-x-.139)/.034))*max(0.,1.-abs(y+.032)/.074)*max(0.,min(1.,(.011-z)/.033))
  x+=.004*contact;y+=.012*contact;z-=.010*contact
  heel=math.exp(-((x+.179)/.022)**2-((y+.013)/.036)**2)*max(0.,min(1.,(.006-z)/.034))
  vertex.co=(x-0.00188*heel,y+0.00735*heel,z)
box('Display',(-.012,.012,-.022),(.155,.089,.004),screen,steer,r=.008)
# Broad arched glare shield and raised lip around the recessed LCD.
profile=[(-.204,.023),(-.188,.062),(-.162,.088),(-.126,.100),
         (-.084,.105),(0,.108),(.062,.107),(.091,.101),(.111,.089),
         (.146,.078),(.173,.057),(.196,.022)]
profile=interp(profile,2)
verts=[(x,y+dy,z) for x,y in profile for dy,z in [(-.003,.012),(.001,-.012),(-.012,-.025),(-.015,.012)]]
# Roll the driver-facing edge down through the middle of the glare shield.
verts=[(x,y+max(0.,min(1.,(.012-z)/.037))*(-.003*(1-(x/.205)**2)+.002*x/.205),z)
       for x,y,z in verts]
# The front face of the curved brow projects farther over the LCD at its centre.
verts=[(x,y,z-0.00441*max(0.,min(1.,(.012-z)/.037))*(1-min(1.,abs(x-.019)/.24)**1.7)) for x,y,z in verts]
faces=[(4*i+j,4*i+(j+1)%4,4*i+(j+1)%4+4,4*i+j+4) for i in range(len(profile)-1) for j in range(4)]
brow=mat('Wheel graphite brow','242527',.39,.15)
bevel(mesh('Wheel visor brow',verts,faces,brow,steer),.0024,3)
for x,y,w,h in [(-.012,.058,.161,.004),(-.012,-.034,.161,.004),(-.092,.012,.004,.093),(.068,.012,.004,.093)]:
 box('LCD bezel',(x,y,-.024),(w,h,.005),black,steer,r=.0016)
wheel_ink=ink_material('VisorInk','steering-bank-ink.png')
print_grid('Wheel brow ink',wheel_ink,lambda u,v:(.09-.205*u,.094-.050*v,-.032),1,1,parent=steer)
# Recessed matte instrument binnacle immediately ahead of the column.
rings=[]
for z,w,top in [(.205,.218,.641),(.25,.231,.644),(.29,.239,.639)]:
 rings.append([(-w,.34,z),(-w,top-.05,z),(-w*.85,top-.012,z),(-w*.45,top,z),
               (0,top+.005,z),(w*.45,top,z),(w*.85,top-.012,z),(w,top-.05,z),(w,.34,z)])
vs=[v for ring in rings for v in ring];n=len(rings[0])
fs=[(i*n+j,i*n+j+1,(i+1)*n+j+1,(i+1)*n+j) for i in range(2) for j in range(n-1)]
mesh('Cockpit instrument shroud',vs,fs,black)
mesh('Instrument recess backing',rings[-1],[tuple(range(n))],black)

buttons=[(-.1538,.0593,blue,'R'),(-.1111,.0454,green,'N'),(-.1271,.0016,yellow,'+'),(-.1276,-.0403,red,'−'),(.1327,.0387,red,'P'),(.1767,.0482,yellow,'A'),(.1391,-.0043,blue,'+'),(.1246,-.0447,silver,'−')]
collar=mat('Brushed button bezel','717578',.38,.65)
for x,y,m,label in buttons:
 x=-x
 rod('Button collar',(x,y,-.021),(x,y,-.026),.0087,collar,steer,24);rod('Button cap',(x,y,-.026),(x,y,-.031),.0074,m,steer,20);text(label,(x,y,-.0317),.0092,silver if m==blue else black,(0,math.pi,0),steer)
dialmat=mat('ControlPolymer','171a1b',.43,.06)
for x,y,m in [(-.076,-.0805,green),(-.0054,-.0719,yellow),(.0569,-.0855,blue)]:
 x=-x
 rod('Rotary coloured ring',(x,y,-.020),(x,y,-.025),.0205,m,steer,32)
 rings=[]
 for z,r in [(-.025,.0168),(-.027,.0178),(-.035,.0164),(-.038,.0169)]:
  rings.append([(x+(r+.0009*math.cos(16*a))*math.cos(a),y+(r+.0009*math.cos(16*a))*math.sin(a),z)
                for a in [i*math.tau/64 for i in range(64)]])
 mesh('Low profile thumb rotary',*closed_rings(rings),dialmat,steer)
 box('Dial pointer',(x-.003,y+.008,-.0385),(.0021,.010,.0014),silver,steer,r=.0005)
for side in [-1,1]:
 paddle=panel('Shift paddle',[(side*.105,-.072,.052),(side*.15,-.056,.060),(side*.17,.035,.055),(side*.125,.052,.048)],.007,carbon,steer)
 rod('Paddle hinge',(side*.095,-.035,.034),(side*.095,.025,.034),.006,metal,steer,12)
 rod('Paddle linkage',(side*.095,0,.034),(side*.13,0,.055),.004,metal,steer,8)
 text('−' if side>0 else '+',(side*.145,.018,.063),.018,silver,parent=steer)
for x,y in [(.076,-.0805),(.0054,-.0719),(-.0569,-.0855)]:
 for i in range(9):
  a=(i/8*1.5+.25)*math.pi
  rod('Rotary index tick',(x+.029*math.cos(a),y+.029*math.sin(a),-.024),(x+.031*math.cos(a),y+.031*math.sin(a),-.024),.00038,dialmat,steer,4)
fabric=mat('GloveFabric','ac1f30',.92);stitch=mat('GloveStitch','ddd8cc',.96);suede=mat('GloveSuede','30343c',.98);glovepanel=mat('GlovePanel','4c2028',.95)
steer.scale=(.85,.9,1)
build_driver(group, mesh, curve, interp, steer, body, (fabric, glovepanel, suede, stitch, sleeve))
# Boot tops, bent thighs and the six-point harness are visible beneath the wheel.
occupant=group('SuitBody');occupant.parent=body;occupant.location.y=-.060
for item in bpy.context.scene.objects:
 if item.name.startswith(('Suit shoulders','HANS collar','Flat restraint webbing')):
  item.parent=occupant;item.location.y+=.060
for side in [-1,1]:
 loft('Suited thigh',[[-.54,side*.088,.072,.273,.420],[-.38,side*.093,.080,.267,.433],[-.20,side*.100,.073,.291,.451],[.00,side*.108,.066,.329,.468],[.15,side*.108,.056,.354,.462],[.27,side*.103,.041,.323,.421]],sleeve,occupant,n=14)
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
  curve('Seat loom retainer',[(side*(.27*r+.019),.436,z-.008),(side*(.27*r+.008),.446,z),(side*(.27*r+.021),.456,z+.008)],.0022,metal)
 curve('Cockpit electronics loom',[(side*.252,.405,-.43),(side*.267,.426,-.24),(side*.267,.427,-.09),(side*.261,.427,.055),(side*.229,.424,.218)],.006,black)
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
gunmetal=mat('Centrelock gunmetal','34383c',.26,.68)
for front in [True,False]:
 for s in [-1,1]:
  z=1.55 if front else -2.05;w=.305 if front else .405;x=s*(.8475 if front else .7675)
  # Upright, spaced ball joints and inboard pickup brackets (not one shared hub point).
  corner=('Front' if front else 'Rear')+('L' if s<0 else 'R')
  knuckle=group(corner+'Knuckle');knuckle.location=(x,.36,z)
  ux=x-s*.10
  rod('Upright',(-s*.10,-.14,0),(-s*.10,.12,0),.029,metal,knuckle,12)
  for level,yy in enumerate([.251,.419]):
   for dz in [-.33,.28]:
    # Taper the blades into the actual nose/gearbox at both chassis stations.
    pick=(s*((.188 if dz<0 else .129) if front else (.09 if dz<0 else .15)),yy-(.026 if front and dz>0 and level else 0),z+dz)
    joint=(ux,yy+(.016 if level else -.014),z)
    suspension_blade(pick,joint,front)
    box('Pickup clevis',pick,(.052,.036,.07),metal,r=.007)
    rod('Pickup bolt',(pick[0]-.03,pick[1],z+dz),(pick[0]+.03,pick[1],z+dz),.009,metal,vertices=6)
   ellipsoid('Upright spherical joint',(-s*.10,yy-.36,0),(.027,.022,.025),metal,knuckle)
  rod('Suspension pushrod',(s*.138,.457 if front else .43,z+(-.29 if front else .29)),(ux,.25,z),.013)
  rod('Steering trackrod',(s*.18,.33,z+.22),(ux,.34,z+.08),.009)
  box('Brake duct scoop',(-s*.17,.03,.16),(.085,.13,.13),carbon,knuckle,r=.025)
  box('Brake duct opening',(-s*.17,.04,.229),(.058,.087,.005),black,knuckle,r=.015)
  pivot=group(corner);pivot.location=(x,.36,z);wheelgroups.append(pivot)
  # Surface of revolution about X.
  def lathe(name,profile,m):
   vs=[];fs=[];steps=94 if name=='Slick tyre' else 34 if name=='Ventilated carbon brake rotor' else 32 if name=='Locking collar' else 48 if name in ('Recessed black dish','Centre boss','Anodized bead seat') else 96
   for xx,r in profile:
    for i in range(steps):a=i*math.tau/steps;vs.append((xx,r*math.cos(a),r*math.sin(a)))
   for j in range(len(profile)-1):
    for i in range(steps):a=j*steps+i;b=j*steps+(i+1)%steps;fs.append((a,b,b+steps,a+steps))
   return mesh(name,vs,fs,m,pivot)
  lathe('Slick tyre',[(-w/2,.242),(-w*.525,.266),(-w*.525,.290),(-w*.49,.321),(-w*.487,.335),(-w*.400,.351),(-w*.34,.357),(-w*.2,.36),(0,.361),(w*.2,.36),(w*.34,.357),(w*.400,.351),(w*.487,.335),(w*.49,.321),(w*.525,.290),(w*.525,.266),(w/2,.242),(0,.237),(-w/2,.242)],rubber)
  for side in [-1,1]:
   xx=side*w/2
   # Rolled graphite bead and concave cover with a raised centrelock socket.
   # A rolled lip, centre boss and fourteen swept vanes share the dish batch.
   # Open slots reveal the friction ring behind the wheel at oblique angles.
   lathe('Recessed black dish',[(xx-side*.006,.245),(xx+side*.002,.243),
        (xx+side*.003,.239),(xx-side*.006,.224),(xx-side*.020,.209)],dish)
   lathe('Centre boss',[(xx-side*.025,.075),(xx-side*.011,.064),
        (xx-side*.006,.039),(xx-side*.015,.032)],dish)
   lathe('Anodized bead seat',[(xx,.244),(xx+side*.0025,.243),(xx+side*.002,.241)],gunmetal)
   for vane in range(14):
    verts=[];faces=[]
    for station,(radius,sweep,depth,width) in enumerate([(.063,0,.019,.18),(.105,.04,.027,.18),(.169,.13,.024,.16),(.218,.21,.010,.13),(.229,.22,.007,.12)]):
     for t,relief in [(-1,0),(-.66,.005),(.68,.001),(1,-.008)]:
      angle=vane*math.tau/14+s*(sweep+t*width)
      verts.append((xx+side*(relief-depth),radius*math.cos(angle),radius*math.sin(angle)))
     if station:
      for j in range(3):
       i=(station-1)*4+j;f=(i,i+4,i+5,i+1)
       faces.append(f if s==side else tuple(reversed(f)))
    mesh('Swept rim vane',verts,faces,dish,pivot)
   socket=rod('Centrelock hex socket',(xx-side*.047,0,0),(xx-side*.008,0,0),.035,gunmetal,pivot,6)
   bevel(socket,.0013,1)
   for poly in socket.data.polygons:poly.use_smooth=False
   lathe('Locking collar',[(xx-side*.019,.023),(xx-side*.014,.028),(xx-side*.007,.025),
         (xx-side*.005,.020),(xx-side*.005,.017)],red if s<0 else blue)
   rod('Centrelock spindle',(xx-side*.015,0,0),(xx+side*.012,0,0),.016,metal,knuckle,12)
   rod('Axle inspection cap',(xx+side*.018,0,0),(xx+side*.020,0,0),.012,yellow,pivot,16)
   lathe('Ventilated carbon brake rotor',[(xx-side*.07,.075),(xx-side*.07,.205),(xx-side*.083,.205),(xx-side*.083,.075)],brake)
   box('Brake caliper',(xx-side*.092,.155,0),(.045,.09,.13),metal,knuckle,r=.012)
   for j in range(12):
    a=j*math.tau/12;rod('Rotor cooling vein',(xx-side*.087,.09*math.cos(a),.09*math.sin(a)),(xx-side*.087,.20*math.cos(a+.05),.20*math.sin(a+.05)),.003,brake,pivot,5)
   # The mould lettering remains white. Two partial ink arcs identify the
   # fitted compound, with a gap at each of the two main sidewall wordmarks.
   for arc in (0,math.pi):
    # Twin printed rails enclose rectangular voids. Alternating half-width
    # checks terminate each end, as on the outer wall in frame 010.
    vv=[];ff=[]
    def patch(start,end,inside,outside):
     k=len(vv)
     for ang,r in [(start,inside),(start,outside),(end,outside),(end,inside)]:
      # The sidewall projection below seats each printed patch on the shoulder.
      vv.append((side*w*.5,r*math.cos(ang+arc),r*math.sin(ang+arc)))
     ff.append((k,k+1,k+2,k+3))
    for j in range(20):
     start=.85+j*.076;end=start+.076
     if j<3 or j>=17:
      r=.305+.015*(j%2)
      patch(start,end,r,r+.015)
     else:
      patch(start,end,.305,.312)
      patch(start,end,.328,.335)
      patch(start,start+.027,.312,.328)
    mesh('Compound sidewall ink',vv,ff,tyreink,pivot)
   for j in range(8):
    a=j*math.tau/8;rod('Cover fastener',(xx,.216*math.cos(a),.216*math.sin(a)),(xx+side*.003,.216*math.cos(a),.216*math.sin(a)),.002,metal,pivot,6)
# Nose and front wing marks are projected on the final target meshes below.
nose_labels=[]
for label,z,size,parent in [('44',1.42,.49,numberA),('63',1.42,.49,numberB),
                            ('Bitdefender',1.05,.112,decals)]:
 nose_labels.append(text(label,(0,1,z),size,silver,(-math.pi/2,0,0),parent).name)
# Convert curves, recompute outward normals, batch static parts per parent/material.
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.context.scene.objects):
 if o.type in {'FONT','CURVE'}:
  o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o.select_set(False)
# Fictional sidepod wordmarks follow the sculpted skin, never float off it.
for o in list(bpy.context.scene.objects):
 if o.type=='MESH' and o.name.startswith('Mark VOLT') and abs(o.location.x)>.5 and -1.6<o.location.z<0:
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
d=skin.modifiers.new('Curvature preserving reduction','DECIMATE');d.ratio=.073;bpy.ops.object.modifier_apply(modifier=d.name)
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
                       plane_co=(side*.7,.425,.10),plane_no=(-side*.10,1,-.42),clear_inner=False,clear_outer=False)
# The paint dips at the suspension pickup, levels off over the mounting
# blades, and tapers into the tip. Cut this curve into the actual outer skin.
paint_stations=((.55,.503),(1.56,.440),(1.78,.414),(1.94,.381),(2.15,.351),
               (2.35,.311),(2.52,.266),(2.69,.222),(2.905,.173))
def nose_paint_height(z):
 for (za,ya),(zb,yb) in zip(paint_stations,paint_stations[1:]):
  if z<=zb:return ya+(yb-ya)*max(0.,(z-za)/(zb-za))
 return paint_stations[-1][1]
# Flatten the paint curve for one clean cut, then restore the surface.
for v in bm.verts:v.co.y-=nose_paint_height(v.co.z)
faces=[face for face in bm.faces if all(v.co.z>=.54999 for v in face.verts)]
edges={edge for face in faces for edge in face.edges}
verts={v for face in faces for v in face.verts}
bmesh.ops.bisect_plane(bm,geom=[*verts,*edges,*faces],dist=.000001,
                       plane_co=(0,0,0),plane_no=(0,1,0),clear_inner=False,clear_outer=False)
for v in bm.verts:v.co.y+=nose_paint_height(v.co.z)
bm.to_mesh(skin.data);bm.free();skin.data.update()
skin.data.materials.clear()
nose_under=mat('Nose lower laminate','121519',.52,.08)
for material in [paint,white,carbon,nose_under]:skin.data.materials.append(material)
for poly in skin.data.polygons:
 poly.use_smooth=True
 co=sum((skin.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 if (-1.32<co.z<.55 and co.y>.635+.31*(abs(co.x)-.60)-.042*co.z) or (co.z> -1.28 and co.z<-.54 and co.y>.66):poly.material_index=1
 elif co.z>.55 and co.y<nose_paint_height(co.z):poly.material_index=3
 elif (-.19<co.z<.535 and abs(co.x)>.50 and co.y<.425+.10*(abs(co.x)-.7)+.42*(co.z-.10)) or (co.z<.28 and co.y<.257 and abs(co.x)>.30) or (-.95<co.z<.50 and abs(co.x)<.36 and co.y<.562):poly.material_index=2
 else:poly.material_index=0
for side in [-1,1]:
 outline=[(side*.55+math.copysign(abs(math.cos(j*math.tau/48))**.52,math.cos(j*math.tau/48))*.245,.549+math.copysign(abs(math.sin(j*math.tau/48))**.62,math.sin(j*math.tau/48))*.062) for j in range(48)]
 cutter=mesh('Matching sidepod aperture',[(x,y,z) for z in [.26,.63] for x,y in outline],[tuple(range(48)),tuple(range(48,96))]+[(i,(i+1)%48,(i+1)%48+48,i+48) for i in range(48)],black,parent=None)
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
CN=192
def coaming_plan(a):
 # Full shoulders with a tighter turn across the front bulkhead.
 return (math.copysign(abs(math.cos(a))**.73,math.cos(a)),
         math.copysign(abs(math.sin(a))**.81,math.sin(a)))
rim_plan=[coaming_plan(i*math.tau/CN) for i in range(CN)]
outline=[(.286*u,-.21+.523*v) for u,v in rim_plan]
cutter=mesh('Cockpit aperture tool',[(x,y,z) for y in [.29,.79] for x,z in outline],[tuple(reversed(range(CN))),tuple(range(CN,2*CN))]+[(i,(i+1)%CN,(i+1)%CN+CN,i+CN) for i in range(CN)],carbon,parent=None)
bm=bmesh.new();bm.from_mesh(cutter.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(cutter.data);bm.free()
cutter.data.materials.clear()
nose_under=mat('Nose lower laminate','121519',.52,.08)
for material in [paint,white,carbon,nose_under]:cutter.data.materials.append(material)
for poly in cutter.data.polygons:poly.material_index=2
bpy.context.view_layer.objects.active=skin;mod=skin.modifiers.new('Even open cockpit coaming','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
for poly in skin.data.polygons:poly.use_smooth=True
# Tiny real aperture edge radii, retaining the single connected body and paint regions.
mod=skin.modifiers.new('Manufactured aperture edge radius','BEVEL');mod.width=.0018;mod.segments=2;mod.limit_method='ANGLE';mod.angle_limit=.65;bpy.ops.object.modifier_apply(modifier=mod.name)
# Carbon cut faces lie behind the continuous rolled inner liner, not a centroid-painted trim.
for poly in skin.data.polygons:
 co=sum((skin.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
 q=abs(co.x/.290)**(2/.73)+abs((co.z+.21)/.523)**(2/.81)
 if .94<q<1.06 and .53<co.y<.67 and abs(poly.normal.y)<.70:poly.material_index=2
 poly.use_smooth=True
# Surface decals use one projected sheet, never a collapsed ellipsoid with overlapping faces.
for o in list(bpy.context.scene.objects):
 if o.name.startswith(('Blue airbox badge','Solar emblem')):bpy.data.objects.remove(o,do_unlink=True)
for side in [-1,1]:
 # The slanted hp lettering and its blue field follow the same drafted side panel.
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
 for u0,v0,u1,v1 in [(-.77,-.48,-.28,.91),(-.57,.08,-.22,.08),(-.41,-.48,-.22,.08),(-.12,-.91,.23,.12),(.23,.12,.57,.12),(.57,.12,.36,-.46),(.36,-.46,.04,-.46)]:
  vs=[];fs=[]
  for j in range(13):
   t=j/12;u=u0+(u1-u0)*t;v=v0+(v1-v0)*t
   for offset in [-.095,.095]:vs.append(flank_vertex(u+offset,v,.0027))
   if j:fs.append((2*j-2,2*j-1,2*j+1,2*j))
  mesh('Printed cowl lettering',vs,fs,silver,decals)
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
# The open loop printed beside the cockpit follows the compound curvature
# of the white shoulder. The surveyed coordinates lie on the body in metres.
shoulder_strokes=[
 (-0.32451,0.04734,-0.32522,0.04282),
 (-0.31663,0.04767,-0.31743,0.04285),
 (-0.30917,0.04892,-0.30999,0.04412),
 (-0.30385,0.04887,-0.30530,0.04371),
 (-0.30033,0.04758,-0.30319,0.04248),
 (-0.29779,0.04455,-0.30235,0.04085),
 (-0.29723,0.04068,-0.30241,0.03863),
 (-0.29871,0.03590,-0.30394,0.03494),
 (-0.30129,0.03091,-0.30614,0.03150),
 (-0.30546,0.02646,-0.30875,0.02895),
 (-0.31064,0.02341,-0.31255,0.02697),
 (-0.31648,0.02176,-0.31803,0.02555),
 (-0.32581,0.02141,-0.32543,0.02533),
 (-0.33680,0.02118,-0.33621,0.02510),
]
for side in (-1,1):
 verts=[];faces=[]
 for x0,z0,x1,z1 in shoulder_strokes:
  for x,z in ((side*x0,z0),(side*x1,z1)):
   hit,pt,normal,_=skin.ray_cast(Vector((x,1.2,z)),Vector((0,-1,0)))
   if not hit:raise RuntimeError('Shoulder lettering missed the painted body')
   verts.append(pt+normal*.0008)
  i=len(verts)-2
  if i:faces.append((i-2,i-1,i+1,i))
 mesh('Shoulder return lettering',verts,faces,black,decals)

# Registered nose and flank ink from the close-up, on the finished paint.
nose_badge=ink_material('NoseBadgeInk','nose-side-badge.png')
for side in (-1,1):
 def badge_point(u,v):
  # The four registered corners are measured on the flank in metres.
  # Project across the panel so the stamp follows changes to the nose taper.
  z=(1-v)*(2.43468+.06068*u)+v*(2.43508+.06229*u)
  y=(1-v)*(.26146+.00748*u)+v*(.22457+.00908*u)
  hit,pt,normal,_=skin.ray_cast(Vector((side*.4,y,z)),Vector((-side,0,0)))
  if not hit:raise RuntimeError('Lower nose badge is outside the panel')
  return pt+normal*.0016
 print_grid('Lower nose side badge',nose_badge,badge_point,4,3,reverse=side>0)
nose_ink=ink_material('BodyInk','nose-print.png')
for row,(z0,z1,width) in enumerate([(1.964,2.034,.170),(2.083,2.147,.168),
                                      (2.191,2.239,.146),(2.278,2.348,.149),
                                      (2.391,2.431,.128),(2.489,2.587,.132)]):
 def nose_print(u,v):
  x=(u-.5)*width*1.12;z=(z0+z1)*.5+(z1-z0)*(v-.5)*1.18
  hit,pt,_,_=skin.ray_cast(Vector((x,1.4,z)),Vector((0,-1,0)))
  if not hit:raise RuntimeError('Nose ink missed upper surface')
  return (x,pt.y+.0016,z)
 print_grid('Nose sponsor print',nose_ink,nose_print,6,3,atlas_row=row)
for side in (-1,1):
 def shield(u,v):
  z=.696+(u-.5)*.063
  height=.503+(.5-v)*.090
  hit,pt,_,_=skin.ray_cast(Vector((side*1.25,height,z)),Vector((-side,0,0)))
  if not hit:raise RuntimeError('Flank shield missed panel')
  return (pt.x+side*.0018,height,z)
 print_grid('Flank shield',nose_ink,shield,5,5,reverse=side>0,atlas_row=6)
# Project the fan-shaped enamel and its radial ribs onto the nose.
def shell_point(u,v,height):
 x=u*.089;z=1.846+v*.090
 hit,point,_,_=skin.ray_cast(Vector((x,1.4,z)),Vector((0,-1,0)))
 if not hit:raise RuntimeError('Shell badge missed nose')
 return (x,point.y+height,z)
points=[(-.55,-.88),(-.61,-.64),(-.77,-.59)]
for i in range(49):
 angle=math.pi*(1.18-1.36*i/48)
 radius=1-.035*(.5+.5*math.cos(i*math.pi/3))
 points.append((radius*math.cos(angle),radius*math.sin(angle)))
points.extend([(.77,-.59),(.61,-.64),(.55,-.88)])
def enamel_badge(project):
 # Project interior rings as well as the perimeter. A single triangle fan
 # would bury the centre of the enamel inside the convex sidepod.
 for scale,height,material in [(1,.002,red),(.91,.0032,gold)]:
  verts=[project(0,-.57*scale,height)];faces=[];n=len(points)
  for ring in range(1,5):
   t=ring/4
   verts.extend(project(x*t*scale,(-.57+(y+.57)*t)*scale,height) for x,y in points)
   for k in range(n):
    cur=1+(ring-1)*n+k;nxt=1+(ring-1)*n+(k+1)%n
    faces.append((0,cur,nxt) if ring==1 else (cur-n,nxt-n,nxt,cur))
  mesh('Scalloped energy emblem',verts,faces,material,decals)
 for i in range(1,8):
  angle=math.pi*i/8;x=.91*math.cos(angle);y=.91*math.sin(angle)
  verts=[];faces=[]
  for row in range(8):
   t=row/7
   for w in (-.025,.025):verts.append(project(.07*x+(.93*x+w)*t,-.66+(y+.66)*t,.0042))
   if row:faces.append((2*row-2,2*row-1,2*row+1,2*row))
  mesh('Radial enamel rib',verts,faces,red,decals)
enamel_badge(shell_point)
for side in (-1,1):
 def flank_badge(u,v,height):
  y=.425+.079*v;z=-.53+.111*u
  hit,pt,_,_=skin.ray_cast(Vector((side*1.35,y,z)),Vector((-side,0,0)))
  if not hit:raise RuntimeError('Energy emblem missed flank')
  return (pt.x+side*height,y,z)
 enamel_badge(flank_badge)
# Leaping cat on the outer sidepod. The outline is traced in frame 003;
# project its face onto the rounded flank after cutting the sidepod aperture.
cat_outline=[(18,14),(20,13),(26,16),(33,20),(39,25),(44,26),(48,23),(50,20),
             (53,19),(54,21),(51,22),(48,26),(46,28),(47,31),(47,33),(51,37),
             (50,39),(47,36),(44,34),(42,30),(39,28),(35,27),(31,24),(28,24),
             (26,22),(22,21),(19,20),(17,19),(19,18),(17,17)]
for side in (-1,1):
 verts=[]
 for x,y in cat_outline:
  z=-.075+(x-35)*.0053
  height=.448-(y-25)*.0050+(x-35)*.00165
  ok,pt,_,_=skin.ray_cast(Vector((side*1.3,height,z)),Vector((-side,0,0)))
  if not ok:raise RuntimeError('Sidepod print missed shoulder')
  verts.append((pt.x+side*.0018,height,z))
 mesh('Flank cat silhouette',verts,[tuple(range(len(verts)))],silver,decals)
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
# The rear cover has a rolled lacquered edge and a dark inward flange. In
# the running car these are tucked against the shell. When the panels lift,
# each edge stays with its own fairing and presents a narrow grazing highlight.
edge_paint=mat('CowlingEdge','c71927',.24,.11)
edge_dark=mat('CowlingReturn','212329',.57,.18)
inner_carbon=mat('Cowl inner laminate','292a2c',.67,.05)
inner_carbon.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.15
for side in (-1,1):
 for upper in (False,True):
  edges=[];returns=[];faces=[]
  for station in range(30):
   z=-2.37+station*(1.26/29)
   y=.728+.045*(z+2.19)-.003 if upper else .593
   hit,point,_,_=skin.ray_cast(Vector((side*.400,y,z)),Vector((-side,0,0)))
   if not hit or point.x*side<.015:continue
   x=point.x
   rise=1 if upper else -1
   row=len(edges)//3
   for dx,h in [(-.0008,-.004),(.002,.0015),(.015,.0055)]:
    edges.append((x-side*dx,y+rise*h,z))
   for dx,h in [(.015,.0055),(.024,.001),(.033,-.009)]:
    returns.append((x-side*dx,y+rise*h,z))
   if row:
    for k in range(2):
     i=3*(row-1)+k;faces.append((i,i+3,i+4,i+1))
  if faces:
   mesh('Rear cowling rolled edge',edges,faces,edge_paint)
   mesh('Rear cowling inner return',returns,faces,edge_dark)
# The forward end of the rolled edge carries a moulded inner wall. Its depth
# fades towards each end of the opening. The bent retaining tabs share its
# rigid panel binding when the cowling lifts off in the service pose.
lining_sections=[(-2.15,.017,.739,.017,.721),(-2.04,.022,.743,.014,.709),
 (-1.92,.043,.735,.030,.693),(-1.82,.075,.745,.044,.678),
 (-1.66,.102,.744,.054,.655),(-1.48,.129,.742,.071,.639),
 (-1.30,.146,.749,.084,.641),(-1.18,.147,.755,.106,.675),(-1.12,.147,.752,.148,.729)]
retainer=mat('Cowling spring steel','655d54',.31,.72)
for side in (-1,1):
 wall=[];quads=[]
 for row,(z,x1,y1,x2,y2) in enumerate(interp(lining_sections,3)):
  for col,t in enumerate((0,.28,.78,1)):
   wall.append((side*((1-t)*x1+t*x2-.010*math.sin(math.pi*t)),(1-t)*y1+t*y2,z-.011*t))
   if row and col:
    i=row*4+col;quads.append((i-5,i-1,i,i-4))
 mesh('Rear cowling inner return web',wall,quads,inner_carbon)
 wrap=[];faces=[]
 for row,(z,x,y,_,_) in enumerate(interp(lining_sections,3)):
  crest=.725+.045*(z+2.19)
  ok,hit,_,_=skin.ray_cast(Vector((side*.4,crest,z)),Vector((-side,0,0)))
  if not ok:continue
  previous=len(wrap)
  for f in (0,.35,.75,1):
   wrap.append(((1-f)*hit.x+f*side*x,(1-f)*crest+f*y+.002+.004*math.sin(math.pi*f),z))
  if previous:
   for j in range(3):
    i=previous+j;faces.append((i-4,i,i+1,i-3))
 mesh('Rear cowling rolled edge enamel wrap',wrap,faces,edge_paint)
 for z,x,low in [(-1.88,.055,.680),(-1.79,.074,.667),(-1.71,.089,.663)]:
  tab=[(side*(x-.006),.741,z),(side*(x-.015),.737,z+.005),
       (side*(x-.042),low+.012,z-.038),(side*(x-.044),low,z-.065)]
  for a,b in zip(tab,tab[1:]):rod('Rear cowling inner return clip',a,b,.0032,retainer,vertices=6)
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
linerProfile=[(.302,.135,.342),(.296,.213,.440),(.304,.240,.478),(.32,.25,.49),(.55,.277,.516),(.632,.281,.518),(.648,.284,.521),(.652,.287,.524),(.650,.291,.527),(.644,.293,.529)]
for ring,(y,w,l) in enumerate(linerProfile):
 for u,v in rim_plan:vv.append((w*u,y+(.008*v if ring>=5 else 0),-.21+l*v))
for ring in range(len(linerProfile)-1):
 for i in range(CN):a=ring*CN+i;b=ring*CN+(i+1)%CN;ff.append((a,b,b+CN,a+CN))
mesh('Smooth carbon cockpit liner',vv,ff,mat('Cockpit liner','272d2a',.69,.025))
# Swept, radius-controlled halo roots penetrate the deck; no union/remesh ripples.
# Small original white marks follow the actual halo skin, as on a broadcast car.
# Their geometry is exported by Blender and protected with the other decals.
from mathutils import Matrix
halo_mesh=bpy.data.objects.get('Halo')
for label,pos,size,right in [('NEXUS',(0,.980,.50),.030,(-1,0,0)),('AEROLAB',(-.292,.960,.105),.033,(0,0,-1)),('NEXUS',(.292,.960,.105),.037,(0,0,1)),('JGP',(-.274,.972,.305),.031,(-.24,0,-.97)),('JGP',(.274,.972,.305),.031,(-.24,0,.97))]:
 o=text(label,pos,size,silver,parent=decals)
 o.data.resolution_u=1  # Small markings need fewer curve subdivisions than body silhouettes.
 normal=Vector((0,1,0));r=Vector(right);up=normal.cross(r)
 o.rotation_euler=Matrix((r,up,normal)).transposed().to_euler()
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o=bpy.context.object
 sw=o.modifiers.new('Halo mark conformity','SHRINKWRAP');sw.target=halo_mesh;sw.wrap_method='NEAREST_SURFACEPOINT';sw.offset=.0008;bpy.ops.object.modifier_apply(modifier=sw.name)
# Project the ink along the flank normal after all booleans and material
# splits. This gives every letter the correct baseline on the curved wall.
for mark in list(decals.children):
 if mark.type!='MESH' or not mark.name.startswith('Mark VOLT'):continue
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
 profile=[(.242,.5),(.266,.521),(.290,.525),(.321,.49),(.335,.487),(.349,.400),(.357,.34),(.361,.20)]
 bpy.context.view_layer.update()
 for o in pivot.children:
  if o.type!='MESH' or not o.name.startswith(('Mark ','Sidewall segment','Compound sidewall ink')):continue
  transform=pivot.matrix_world.inverted()@o.matrix_world;inverse=transform.inverted()
  for vertex in o.data.vertices:
   pt=transform@vertex.co;r=math.hypot(pt.y,pt.z)
   for (r0,w0),(r1,w1) in zip(profile,profile[1:]):
    if r0<=r<=r1:
     pt.x=math.copysign(width*(w0+(w1-w0)*(r-r0)/(r1-r0))+(.0019 if o.name.startswith('Compound sidewall ink') else .00065),pt.x)
     vertex.co=inverse@pt;break
  o.data.update()
# Store assembly membership on the editable master so the inspection poses
# can move prints, solid parts and disconnected mesh islands together.
inspection_roles={
 'rear-main':('Rear main plane','DRS hydraulic','DRS ram'),
 'rear-stay':('Swan neck',),
 'halo-fairing':('Bonded halo upper fairing',),
 'rear-fence':('Rear endplate','Rear fence sponsor print'),
 'pipe':('Formed titanium','Rolled exhaust','Recessed exhaust','Deep exhaust','Circumferential weld'),
 'lamp':('Tail lamp','Individual tail optic','Recessed tail lens'),
 'cowl-edge':('Rear cowling rolled edge','Rear cowling inner return'),
 'gearset':('Transmission gear','Transmission layshaft'),
 'gear-housing':('Gearcase fixed',),
 'gear-cover':('Gearcase removable',),
 'output-drive':('Output bearing carrier','Drive half shaft'),
 'engine-shield':('Power unit heat shield',),
 'engine-port':('Power unit port',),
 'engine-rail':('Power unit upper tube','Power unit tube stay'),
 'engine':('Power unit ',),
 'outlet-detail':('Cooling outlet floor','Folded outlet edge'),
 'pod-inlet':('Continuous rolled inlet lip','Deep intake throat','Radiator matrix behind inlet'),
 'impact':('Rear carbon impact casing','Rear casing fastener'),
 'suspension':('Carbon wishbone','Upright','Pickup clevis','Pickup bolt','Suspension pushrod',
               'Steering trackrod','Brake duct scoop','Brake duct opening'),
 'wheel-cover':('Recessed black dish','Centre boss','Anodized bead seat','Swept rim vane','Rim lip','Centrelock','Locking collar','Axle inspection cap','Cover fastener','Compound sidewall ink','Slick tyre'),
 'front-main':('Front mainplane','Front signature'),
 'front-lower':('Front lower flap',),
 'front-upper':('Front upper flap','Front foil','Mark Marking on flap'),
 'front-fence':('Radiused outboard wing','Endplate lower flange','Front fence ink')
}
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 role=next((name for name,prefixes in inspection_roles.items() if o.name.startswith(prefixes)),None)
 if role:
  membership=o.vertex_groups.new(name='Inspection '+role)
  membership.add(list(range(len(o.data.vertices))),1,'REPLACE')
for parent in list(groups.values()):
 buckets={}
 for o in list(parent.children):
  if o.type!='MESH':continue
  material=o.data.materials[0].name if len(o.data.materials)==1 else 'TwoToneCover'
  batch='RearAero' if o.name.startswith('Rear main plane') else material
  if o.name.startswith(('Carbon wishbone','Suspension pushrod','Steering trackrod')):batch='SuspensionCarbon'
  if o.name=='DRS ram':batch='ActuatorRam'
  if o.name.startswith('Shift paddle'):batch='ShiftPaddle'+('Left' if sum(v.co.x for v in o.data.vertices)<0 else 'Right')
  if o.name.startswith('Front upper flap') and material=='Upper flap laminate':batch='MovingFlap'+('Left' if sum(v.co.x for v in o.data.vertices)<0 else 'Right')
  buckets.setdefault(batch,[]).append(o)
 for name,objects in buckets.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_'+name
  bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
  # Generate metric UVs for a subtle carbon twill applied by the runtime.
  if 'Carbon' in name or 'laminate' in name.lower() or name.startswith('MovingFlap') or name in ('RearAero','FloorFence','HaloComposite'):
   # Project each face on its dominant plane in car metres. Adjacent panels
   # retain the same physical weave scale regardless of their island size.
   uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
   for poly in o.data.polygons:
    normal=(o.matrix_world.to_3x3().inverted().transposed()@poly.normal).normalized()
    axis=max(range(3),key=lambda k:abs(normal[k]))
    for li in poly.loop_indices:
     co=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
     uv.data[li].uv=(co[(axis+1)%3],co[(axis+2)%3])
# On projected vector graphics the flat interior needs no tessellation.
# Preserve islands, printed outlines, UV seams and curved skin highlights.
for printed in [*decals.children,*numberA.children,*numberB.children]:
 if printed.type!='MESH' or not printed.name.endswith(('_MarkWhite','_BrandGold','_Cavity','_ButtonRed')):continue
 ink_mesh=bmesh.new();ink_mesh.from_mesh(printed.data)
 bmesh.ops.dissolve_limit(ink_mesh,angle_limit=math.radians(.12),verts=list(ink_mesh.verts),
                          edges=list(ink_mesh.edges),use_dissolve_boundaries=False,delimit={'UV','MATERIAL'})
 ink_mesh.to_mesh(printed.data);ink_mesh.free()
# The glove shell is a continuous loft; preserve its tailored profile (no voxel puffing).
# Preserve curved painted skins and tyre shoulders; simplify small mechanical parts only.
for o in bpy.context.scene.objects:
 if o.name in ('Chassis_RearAero','DRS_Carbon') or o.name.endswith('_WheelDish'):continue
 if o.type=='MESH' and o.parent not in [floor,decals,numberA,numberB] and len(o.data.polygons)>500 and not any(m.name in ['Livery','Ivory','AeroLaminate','Upper flap laminate','FrontFenceLaminate','Rubber','GloveFabric','Sleeve','HelmetPaint','HelmetInk'] for m in o.data.materials):
  d=o.modifiers.new('Optimised smooth production topology','DECIMATE')
  d.ratio={'Chassis_Titanium':.208,'Chassis_Transmission alloy':.26,'Chassis_Cavity':.28}.get(o.name,.35)
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=d.name)
from cockpit_coaming import formed_coaming
# Keep the paint, liner, cut faces and conformal print joined at the rim.
bpy.context.view_layer.update()
for obj in bpy.context.scene.objects:
 if obj.type!='MESH' or not obj.name.startswith(('Chassis_','ConformalDecals_')):continue
 world=obj.matrix_world;local=world.inverted()
 # Keep the original rim points for the inspection remesher. Changing a
 # shoulder must preserve the registered crossings elsewhere on the body.
 basis=(obj.data.attributes.new('Unformed cockpit rim','FLOAT_VECTOR','POINT')
        if obj.name=='Chassis_TwoToneCover' else None)
 for vertex in obj.data.vertices:
  old=world@vertex.co;new=formed_coaming(old)
  if new!=old:
   if basis is not None:basis.data[vertex.index].vector=vertex.co
   vertex.co=local@new
 obj.data.update()

# Bake actual Cycles CPU occlusion into a shared packed UV atlas.
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.device='CPU';bpy.context.scene.cycles.samples=32
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
 uvs=o.data.uv_layers
 if not uvs:uvs.new(name='UVMap')
 uvs[0].name='UVMap'
 # Conformal prints already carry an artwork channel. Reserve slot 1 for
 # occlusion on these meshes too, keeping the named artwork in slot 2.
 if len(uvs)>1:
  artwork=uvs[1];name=artwork.name;artwork.name='UVMap_AO'
  duplicate=uvs.new(name=name,do_init=False)
  values=[0.]*(len(artwork.data)*2)
  artwork.data.foreach_get('uv',values);duplicate.data.foreach_set('uv',values)
 ao_uv=uvs.get('UVMap_AO') or uvs.new(name='UVMap_AO',do_init=False)
 uvs.active=ao_uv;ao_uv.active_render=True
 o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.002);bpy.ops.object.mode_set(mode='OBJECT')
ao=bpy.data.images.new('JGP baked ambient occlusion',width=1024,height=1024);ao.generated_color=(1,1,1,1)
bake_materials={slot.material for obj in meshes for slot in obj.material_slots if slot.material}
for m in bake_materials:
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=ao;m.node_tree.nodes.active=n
bpy.context.scene.render.bake.margin=4
bpy.ops.object.bake(type='AO',use_clear=True,uv_layer='UVMap_AO')
for o in meshes:o.data.uv_layers[0].active_render=True
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
tyre_rubber.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.60
nodes=tyre_rubber.node_tree.nodes;links=tyre_rubber.node_tree.links
ink_map=nodes.new('ShaderNodeTexImage');ink_map.image=print_image
coords=nodes.new('ShaderNodeUVMap');coords.uv_map='SidewallInk'
links.new(coords.outputs['UV'],ink_map.inputs['Vector'])
links.new(ink_map.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
# The moulded steering grips have a smoother finish than the slick tread.
grip=bpy.data.objects.get('Steering_Rubber')
if grip:
 grip_finish=rubber.copy();grip_finish.name='GripRubber'
 grip_bsdf=grip_finish.node_tree.nodes.get('Principled BSDF')
 grip_bsdf.inputs['Roughness'].default_value=.62
 grip.data.materials[0]=grip_finish
for pivot in wheelgroups:
 tyre=next(o for o in pivot.children if o.type=='MESH' and o.data.materials[0]==rubber)
 tyre.data.materials[0]=tyre_rubber
 width=.305 if pivot.name.startswith('Front') else .405
 uv=tyre.data.uv_layers[0];uv.name='SidewallInk'
 local=pivot.matrix_world.inverted()@tyre.matrix_world
 for poly in tyre.data.polygons:
  for li in poly.loop_indices:
   co=local@tyre.data.vertices[tyre.data.loops[li].vertex_index].co
   # Both faces read clockwise from outside. The central tread is unprinted.
   uv.data[li].uv=(.5-math.copysign(1,co.x)*co.z/.729,.5+co.y/.729) if abs((local@poly.center).x)>width*.39 else (0,0)
# Store reproducible editable source and two self-contained LODs.

def export(name):
 bpy.ops.export_scene.gltf(filepath=str(OUT/name),export_format='GLB',export_yup=False,export_apply=True,export_cameras=False,export_lights=False)
 add_export_weights(OUT/name)
export('jgp26-high.glb')
tri=sum(len(p.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for p in o.data.polygons)
for o in bpy.context.scene.objects:
 if o.type=='MESH' and len(o.data.polygons)>80:
  d=o.modifiers.new('Distance LOD','DECIMATE')
  # Retain fingertip contact on the small outer grip at the lower mesh level.
  d.ratio=.64 if o.name=='Steering_Rubber' else .24
export('jgp26-low.glb')
(OUT/'jgp26-manifest.json').write_text(json.dumps({'source':'scripts/blender/build_car.py','highTriangles':tri,'dimensions':{'length':5.62,'width':2.0,'wheelbase':3.6,'bodyHeight':1.171},'lodDistanceMetres':32,'licence':'Original project mesh with reference sponsor markings'},indent=2)+'\n')
sys.path.insert(0,str(Path(__file__).parent))
from pack_glb import pack,pack_race
for level in ['high','low']:
 pack(OUT/f'jgp26-{level}.glb',OUT/f'jgp26-{level}.glb.gz')
 pack_race(OUT/f'jgp26-{level}.glb',OUT/f'jgp26-race-{level}.glb.gz',far_lod=(level=='low'))
(OUT/'daylight.hdr.gz').write_bytes(gzip.compress((OUT/'daylight.hdr').read_bytes(),mtime=0))
# Keep the editable high-detail car in its own lit Blender studio; only the
# deforming racing assets above are sent to the realtime renderer.
for obj in list(bpy.context.scene.objects):
 for mod in list(obj.modifiers):
  if mod.name=='Distance LOD':obj.modifiers.remove(mod)
from studio import save_studio
apply_blender_finish(bpy.data.objects['Chassis_TwoToneCover'])
save_studio(ROOT/'scripts/blender/jgp26.blend')
print('CAR_EXPORT_COMPLETE',tri)
