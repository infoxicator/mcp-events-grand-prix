"""Blender-authored, spatially chunked circuit GLBs. Y-up input -> Blender Z-up.
Source path is the exact authoritative race centreline. Coarse DEM is explicitly
smoothed: this is terrain-scale elevation, not a surveyed racing surface.
"""
import bpy,bmesh,json,math,random,statistics,sys,gzip
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from pack_glb import pack
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'src/race/assets/circuits'
random.seed(26)
ROUND=int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 1

def build(cid):
 bpy.data.batch_remove(list(bpy.data.objects))
 for m in list(bpy.data.materials):bpy.data.materials.remove(m)
 data=json.loads((ROOT/f'data/{cid}-render-path.json').read_text());samples=data['samples'];L=data['length'];night=cid=='las-vegas';n=len(samples)-1
 raw=json.loads((ROOT/f'data/{cid}-dem-source.json').read_text())['response']['results'];raw=[x['elevation'] for x in raw];nr=len(raw)
 med=[statistics.median(raw[(i+j)%nr] for j in range(-2,3)) for i in range(nr)]
 heights=[sum(med[(i+j)%nr]*math.exp(-j*j/4) for j in range(-4,5))/sum(math.exp(-j*j/4) for j in range(-4,5)) for i in range(nr)]
 datum=heights[0];heights=[v-datum for v in heights]
 def height(d):
  f=(d%L)*nr/L;i=int(f);t=f-i;a=heights[(i-1)%nr];b=heights[i%nr];c=heights[(i+1)%nr];v=heights[(i+2)%nr];return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-v)*t*t+(-a+3*b-3*c+v)*t*t*t)
 def sample(d):
  d%=L;f=d/2;i=min(int(f),n-1);a=(d-samples[i]['d'])/(samples[i+1]['d']-samples[i]['d']);return {k:samples[i][k]*(1-a)+samples[i+1][k]*a for k in ('x','z','tx','tz','width','line','pit')}
 def pt(d,off=0,y=0):
  s=sample(d);return (s['x']-s['tz']*off,height(d)+y,s['z']+s['tx']*off)
 coarse=[(s['x'],s['z'],height(s['d'])) for s in samples[::40]]
 def ground(x,z):
  _,_,h=min(coarse,key=lambda p:(p[0]-x)**2+(p[1]-z)**2);return h
 mats={}
 def mat(name,color,rough=.8,metal=0,tex=None,alpha=False,emission=0):
  m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
  if emission:bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=emission
  if tex:
   p=OUT/(tex+'.png') if tex not in ('asphalt-color','grass-color') else ROOT/'src/race/assets'/(tex+'.jpg')
   node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(p));m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
   if emission:m.node_tree.links.new(node.outputs['Color'],bs.inputs['Emission Color'])
   if alpha:m.node_tree.links.new(node.outputs['Alpha'],bs.inputs['Alpha']);m.surface_render_method='DITHERED'
  mats[name]=m;return name
 mat('Asphalt',(.19,.20,.21),.52 if night else .91,tex='asphalt-color');mat('Grass',(.23,.26,.15),tex='grass-color');mat('Gravel',(.62,.58,.49),tex='gravel');mat('White',(.76,.75,.68));mat('Red',(.46,.027,.022));mat('Green',(.10,.24,.15));mat('Steel',(.38,.42,.45),.48,.65);mat('Concrete',(.47,.48,.45));mat('Dark',(.022,.027,.032));mat('Glass',(.10,.16,.20),.22,.45);mat('Foliage',(.3,.4,.2),tex='foliage',alpha=True);mat('Fence',(.5,.5,.5),tex='fence',alpha=True);mat('Crowd',(.5,.5,.5),tex='crowd',alpha=True);mat('Sign',(.6,.6,.6),tex='sign',emission=.25 if night else 0);mat('Windows',(.5,.4,.3),tex='windows',emission=.65);mat('Gold',(.85,.52,.19),.5,emission=2);mat('Ice',(.6,.8,1),.5,emission=4);mat('Pink',(.8,.04,.3),emission=2);mat('Rubber',(.1,.1,.1),tex='rubber',alpha=True);mat('Water',(.015,.045,.06),.18,.5);mat('Trunk',(.14,.10,.07));mat('Sphere',(.1,.5,.6),tex='sphere-art',emission=1)
 for i,c in enumerate([(.085,.14,.035),(.12,.19,.05),(.17,.22,.065),(.09,.16,.07)]):mat('Canopy'+str(i),c,.94,tex='canopy')
 for i,c in enumerate([(.38,.025,.025),(.04,.08,.16),(.62,.60,.55),(.12,.15,.16)]):mat('Spectator'+str(i),c,.95)
 mat('Skin',(.43,.28,.19),.9)
 for number in [150,100,50]:mat('Brake'+str(number),(.8,.8,.8),tex='brake-'+str(number))
 batches={}
 def face(points,material,uv=None,special=None):
  centre=tuple(sum(p[i] for p in points)/len(points) for i in range(3));key=(special or f'{int(centre[0]//180)}_{int(centre[2]//180)}',material)
  vs,fs,us=batches.setdefault(key,([],[],[]));start=len(vs);vs.extend((x,-z,y) for x,y,z in points);fs.append(tuple(range(start,start+len(points))));us.extend(uv or [(0,0),(1,0),(1,1),(0,1)][:len(points)])
 def box(p,size,m,yaw=0):
  x,y,z=p;w,h,d=size;cs=math.cos(yaw);sn=math.sin(yaw)
  v=[(x+xx*cs+zz*sn,y+yy,z-xx*sn+zz*cs) for xx,yy,zz in [(-w/2,-h/2,-d/2),(w/2,-h/2,-d/2),(w/2,h/2,-d/2),(-w/2,h/2,-d/2),(-w/2,-h/2,d/2),(w/2,-h/2,d/2),(w/2,h/2,d/2),(-w/2,h/2,d/2)]]
  for f in [(3,2,1,0),(4,5,6,7),(0,1,5,4),(7,6,2,3),(1,2,6,5),(4,7,3,0)]:face([v[i] for i in f],m,[(0,0),(w/100 if m=='Windows' else 1,0),(w/100 if m=='Windows' else 1,h/130 if m=='Windows' else 1),(0,h/130 if m=='Windows' else 1)])
 def rod(a,b,r,m,sides=5):
  nonlocal instance_triangles
  if m=='Trunk':
   key=(m,sides,0,0);mesh=prototypes.get(key)
   if mesh is None:
    vv=[(math.cos(i*math.tau/sides),math.sin(i*math.tau/sides),z) for z in [-.5,.5] for i in range(sides)];ff=[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)];mesh=bpy.data.meshes.new('Shared branch');mesh.from_pydata(vv,[],ff);mesh.materials.append(mats[m]);mesh.update()
    for poly in mesh.polygons:poly.use_smooth=True
    prototypes[key]=mesh
   aa=Vector((a[0],-a[2],a[1]));bb=Vector((b[0],-b[2],b[1]));o=bpy.data.objects.new('Instance_Trunk',mesh);bpy.context.collection.objects.link(o);o.parent=instanceRoot;o.location=(aa+bb)/2;o.rotation_euler=(bb-aa).to_track_quat('Z','Y').to_euler();o.scale=(r,r,(bb-aa).length);instance_triangles+=sides*2;return
  av=Vector(a);bv=Vector(b);axis=(bv-av).normalized();u=axis.cross(Vector((0,1,0)))
  if u.length<.001:u=axis.cross(Vector((1,0,0)))
  u.normalize();v=axis.cross(u);rings=[[tuple(p+r*(u*math.cos(i*math.tau/sides)+v*math.sin(i*math.tau/sides))) for i in range(sides)] for p in [av,bv]]
  for i in range(sides):j=(i+1)%sides;face([rings[0][i],rings[0][j],rings[1][j],rings[1][i]],m)
 instanceRoot=bpy.data.objects.new('Blender solid instances',None);bpy.context.collection.objects.link(instanceRoot)
 prototypes={};instance_triangles=0
 def blob(p,scale,m,segments=8,rings=4,seed=0):
  nonlocal instance_triangles
  segments,rings=(16,8) if m.startswith('Canopy') else (segments,rings)
  key=(m,segments,rings,seed%4);mesh=prototypes.get(key)
  if mesh is None:
   vv=[];ff=[]
   for j in range(rings+1):
    t=math.pi*j/rings
    for i in range(segments):
     a=i*math.tau/segments;r=1+.12*math.sin(i*2.7+j*3.1+seed%4)+(.06*math.cos(i*7.1-j*4.7) if m.startswith('Canopy') else 0)
     vv.append((math.sin(t)*math.cos(a)*r,-math.sin(t)*math.sin(a)*r,math.cos(t)))
   for j in range(rings):
    for i in range(segments):
     k=j*segments+i;l=j*segments+(i+1)%segments;ff.append((k,l,l+segments,k+segments))
   mesh=bpy.data.meshes.new('Shared solid '+m);mesh.from_pydata(vv,[],ff);mesh.materials.append(mats[m]);mesh.update()
   bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
   uv=mesh.uv_layers.new(name='UVMap')
   for poly in mesh.polygons:
    poly.use_smooth=True
    for li in poly.loop_indices:
     co=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(math.atan2(co.y,co.x)/math.tau+.5,math.acos(max(-1,min(1,co.z)))/math.pi)
   prototypes[key]=mesh
  o=bpy.data.objects.new('Instance_'+m,mesh);bpy.context.collection.objects.link(o);o.parent=instanceRoot;o.location=(p[0],-p[2],p[1]);o.scale=(scale[0],scale[2],scale[1]);instance_triangles+=sum(len(f.vertices)-2 for f in mesh.polygons)
 def strip(start,end,left,right,m,y=.02,step=2,ys=None):
  count=math.ceil((end-start)/step)
  for i in range(count):
   a=start+(end-start)*i/count;b=start+(end-start)*(i+1)/count;l=left(a) if callable(left) else left;r=right(a) if callable(right) else right;lb=left(b) if callable(left) else left;rb=right(b) if callable(right) else right
   face([pt(a,l,y),pt(b,lb,y),pt(b,rb,y+(ys or 0)),pt(a,r,y+(ys or 0))],m,[(l/3,a/3),(lb/3,b/3),(rb/3,b/3),(r/3,a/3)] if m not in ('Rubber',) else [(0,a/6),(0,b/6),(1,b/6),(1,a/6)])
 def atbox(d,off,y,size,m):
  s=sample(d);box(pt(d,off,y),size,m,math.atan2(s['tx'],s['tz']))
 # Broad land follows the coarse DEM; fine surface always follows exact exported track.
 xs=[s['x'] for s in samples];zs=[s['z'] for s in samples]
 for x in range(int(min(xs))-650,int(max(xs))+650,100):
  for z in range(int(min(zs))-650,int(max(zs))+650,100):face([(xx,ground(xx,zz)-2.0,zz) for xx,zz in [(x,z),(x,z+100),(x+100,z+100),(x+100,z)]],'Dark' if night else 'Grass',[(x/20,z/20),(x/20,(z+100)/20),((x+100)/20,(z+100)/20),((x+100)/20,z/20)])
 if not night:strip(0,L,-38,38,'Grass',-.06,step=4)
 strip(0,L,lambda d:-sample(d)['width']-(2 if night else .7),lambda d:sample(d)['width']+(2 if night else .7),'Asphalt')
 for side in [-1,1]:strip(0,L,lambda d:side*sample(d)['width']-.07,lambda d:side*sample(d)['width']+.07,'White',.035)
 strip(data['pitEntry'],L+data['pitExit'],lambda d:sample(d)['pit']-3.4,lambda d:sample(d)['pit']+3.4,'Asphalt',.025)
 strip(data['pitEntry'],L+data['pitExit'],lambda d:sample(d)['pit']-3.25,lambda d:sample(d)['pit']-3.12,'White',.04)
 strip(0,L,lambda d:sample(d)['line']-1.7,lambda d:sample(d)['line']+1.7,'Rubber',.044)
 for c in data['corners']:
  if c['speed']>78:continue
  start=c['d']-(18 if night else 140 if c['name']=='Parabolica' else 45);end=c['d']+(25 if night else 180 if c['name']=='Parabolica' else 70)
  for side in [-1,1]:
   if not night:
    strip(start-25,end+30,lambda d:side*(sample(d)['width']+1.1),lambda d:side*(sample(d)['width']+4),'Green',.03)
    if c['name']!='Parabolica' or side<0:strip(start-35,end+40,lambda d:side*(sample(d)['width']+4),lambda d:side*(sample(d)['width']+4+18*max(.1,math.sin(math.pi*(d-start+35)/(end-start+75)))**.5),'Gravel',.025)
   d=start
   while d<end:
    w=.85 if night else 1.1;m='White' if int((d-start)/1.8)%2 else 'Red';strip(d,min(d+1.8,end),lambda q:side*sample(q)['width'],lambda q:side*(sample(q)['width']+w),m,.04,step=2,ys=.025 if night else .07);
    if not night:
     for q in [d+.25,d+.85,d+1.45]:strip(q,q+.18,lambda v:side*(sample(v)['width']+.15),lambda v:side*(sample(v)['width']+.95),m,.12,step=1,ys=-.04)
    d+=1.8
   if not night and c['speed']<45:
    for j in range(7):atbox(c['d']-9+j*3,side*(sample(c['d'])['width']+1.4),.105,(.3,.17,1.7),'Red')
  for delta in [150,100,50]:atbox(c['d']-delta,-sample(c['d'])['width']-2,1,(.12,1.2,1.3),'Brake'+str(delta))
 # Grid and painted pit stalls.
 strip(0,.35,-7.5,7.5,'White',.05)
 for i in range(20):
  d=-8-i*8;off=3 if i%2 else -3;strip(d,d+.12,off-1.1,off+1.1,'White',.05);strip(d-4,d,off-1.1,off-1,'White',.05)
 def inpit(d):return d>data['pitEntry']-8 or d<data['pitExit']+15
 for d in range(0,int(L),8):
  for side in [-1,1]:
   if side<0 and inpit(d):continue
   off=side*(sample(d)['width']+2 if night else 31);a=pt(d,off);b=pt(d+8,off);yaw=math.atan2(b[0]-a[0],b[2]-a[2]);mid=tuple((a[i]+b[i])/2 for i in range(3));length=math.dist(a,b)
   if night:box((mid[0],mid[1]+.53,mid[2]),(.48,1.06,length+.03),'Concrete',yaw)
   else:
    for h in [.35,.65,.95]:box((mid[0],mid[1]+h,mid[2]),(.15,.22,length+.04),'Steel',yaw)
   rod(a,(a[0],a[1]+4,a[2]),.045,'Steel');rod((a[0],a[1]+4,a[2]),pt(d,off-side*.5,4.6),.035,'Steel');
   for hh in [1.7,2.6,3.4]:rod(pt(d,off,hh),pt(d+8,off,hh),.009,'Steel',4)
   rod((a[0],a[1]+3.9,a[2]),(b[0],b[1]+3.9,b[2]),.026,'Steel')
   face([(a[0],a[1]+1,a[2]),(b[0],b[1]+1,b[2]),(b[0],b[1]+3.9,b[2]),(a[0],a[1]+3.9,a[2])],'Fence',[(0,0),(8,0),(8,3),(0,3)])
   if night or d%40==0:
    toward=-side*.26;aa=pt(d,off+toward,.15);bb=pt(d+8,off+toward,.15);face([aa,bb,(bb[0],bb[1]+.75,bb[2]),(aa[0],aa[1]+.75,aa[2])],'Sign',[(1,0),(0,0),(0,1),(1,1)] if side>0 else None)
 strip(L-405,L+45,-26,-8,'Asphalt',.026)
 # Separate protected pit wall, keeping entry/exit gaps open.
 for d in range(int(L)-390,int(L)-20,8):atbox(d,-12,.65,(.45,1.3,8),'Concrete')
 # Recessed garages, mullions, balcony rail, fascia and roof overhang.
 for i in range(14):
  d=L-380+i*28;heightB=11 if night else 7.5
  atbox(d,-34,heightB/2,(18,heightB,27.8),'Concrete');atbox(d,-34,heightB+.2,(20,.35,28),'White')
  atbox(d,-36,heightB+.9,(3.6,1.2,5),'Steel')
  if i%3==0:
   atbox(d+11,-42,heightB*.45,(5,heightB*.9,4),'Glass')
   for step in range(14):atbox(d+11,-41-step*.2,.3+step*.43,(4,.18,.6),'Steel')
  for j in [-9,0,9]:
   atbox(d+j,-24.95,2.1,(.09,3.8,7.5),'Dark');atbox(d+j,-24.82,4.08,(.12,.15,7.7),'Ice' if night else 'Steel')
   for k in [-4.2,4.2]:atbox(d+j+k,-24.9,2.2,(.25,4.4,.22),'White')
  atbox(d,-24.9,5.8,(.1,2.1,27),'Glass')
  for j in range(-13,14,3):atbox(d+j,-24.75,5.8,(.17,2.2,.1),'Steel')
  atbox(d,-23.9,7.25,(2.1,.15,28),'White')
  for j in range(-13,14,4):atbox(d+j,-22.9,7.8,(.06,1.1,.06),'Steel')
  atbox(d,-22.9,8.35,(.06,.06,28),'Steel')
  if night:atbox(d,-24.6,10.7,(.15,.12,27),'Pink')
  for off in [-20,-17]:strip(d-10,d+10,off,off+.1,'White',.05)
 # Grandstands: rake, seat rows, people cards, roof trusses and exposed frame.
 stations=[L-270,L-160,L-50] if not night else [L-230,L-110,1500,1620,2120,4370]
 for station in stations:
  for block in range(3):
   d=station+block*32;base=35 if not night else 22;s=sample(d);yaw=math.atan2(s['tx'],s['tz'])
   for row in range(12):
    off=base+row*.82;y=1+row*.57;atbox(d,off,y,(.88,.2,30),'Concrete');atbox(d,off+.16,y+.22,(.43,.32,29),'Steel' if row%3 else 'Dark')
    for j in range(-14,15):
     if random.random()<.14:continue
     dd=d+j+random.uniform(-.15,.15);h=random.uniform(.9,1.1);person=pt(dd,off,y+.28)
     x,yy,z=person;cloth='Spectator'+str(random.randrange(4))
     # Seated solid torsos, heads and bent thighs. No billboard crowd texture.
     blob((x,yy+.36*h,z),(.20,.31*h,.16),cloth,6,3)
     blob((x,yy+.76*h,z),(.115,.145,.115),'Skin',6,3)
     atbox(dd,off-.14,y+.35,(.34,.18,.4),cloth)
   atbox(d,base+5.5,10,(14,.2,32),'White' if not night else 'Steel')
   for j in [-14,14]:
    for off in [base-1,base+11]:rod(pt(d+j,off),pt(d+j,off,10),.10,'Steel')
    rod(pt(d+j,base-1,8.9),pt(d+j,base+11,10),.07,'Steel');rod(pt(d+j,base-1,10),pt(d+j,base+11,8.9),.07,'Steel')
 # Gantry is a real triangulated lattice, with five signal boxes.
 for off in [-10,10]:rod(pt(0,off),pt(0,off,8),.16,'Steel')
 for y in [6.9,8]:rod(pt(0,-10,y),pt(0,10,y),.10,'Steel')
 for j in range(-10,10,2):rod(pt(0,j,6.9),pt(0,j+2,8),.06,'Steel');rod(pt(0,j,8),pt(0,j+2,6.9),.06,'Steel')
 face([pt(-.2,-10,7),pt(-.2,10,7),pt(-.2,10,8),pt(-.2,-10,8)],'Sign')
 for j in range(5):atbox(-.3,(j-2)*.5,6.3,(.35,.7,.2),'Dark')
 for c in data['corners']:
  atbox(c['d']-30,23,1.2,(2,2.4,3),'White');atbox(c['d']-30,23,2.5,(2.4,.2,3.4),'Red');atbox(c['d']-30,21.9,1.7,(.03,.8,2),'Glass')
  for j in range(12):atbox(c['d']+30+j*1.3,27,.65,(1.1,1.3,1.2),'Red' if j%3 else 'White')
 if not night:
  # Solid multi-lobed oak/hornbeam crowns, varied silhouettes and visible branches.
  for i in range(4600):
   d=random.random()*L;off=random.choice([-1,1])*(43+random.random()**1.6*165);p=pt(d,off);x,y,z=p
   if min((x-q[0])**2+(z-q[1])**2 for q in coarse)<38**2:continue
   if (d>L-460 or d<150) and abs(off)<90:continue
   if min((x-pt(v,side)[0])**2+(z-pt(v,side)[2])**2 for v in range(int(L)-420,int(L)+100,35) for side in [-38,40])<28**2:continue
   h=random.uniform(13,25);crown=h*random.uniform(.27,.36);rod(p,(x,y+h*.68,z),.22,'Trunk',6)
   species=random.randrange(4)
   for k in range(5):
    a=k*math.tau/5+i;cx=x+math.cos(a)*crown*.5;cz=z+math.sin(a)*crown*.5;cy=y+h*(.68+random.random()*.14)
    rod((x,y+h*.4,z),(cx,cy,cz),.09,'Trunk')
    blob((cx,cy,cz),(crown*random.uniform(.75,1.05),h*random.uniform(.20,.29),crown*.85),'Canopy'+str(species),8,4,i+k)
 else:
  for d in range(0,int(L),45):
   for side in [-1,1]:
    rod(pt(d,side*10.5),pt(d,side*10.5,13),.08,'Steel');rod(pt(d,side*10.5,12.8),pt(d,side*7.5,12.8),.06,'Steel');atbox(d,side*7.5,12.7,(2.6,.15,.7),'Ice')
  origin=data['origin'];lat0=origin[1]*math.pi/180
  def project(lon,lat):return ((lon-origin[0])*111320*math.cos(lat0),-(lat-origin[1])*111320)
  def hotel(lon,lat,w,h,dep,name):
   x,z=project(lon,lat);g=ground(x,z);box((x,g+h/2,z),(w,h,dep),'Windows');box((x,g+4,z),(w+24,8,dep+22),'Concrete')
   for y in [h*.1,h*.85,h]:box((x,g+y,z),(w+1,.45,dep+1),'Gold')
   for dx in range(-int(w/2),int(w/2),12):box((x+dx,g+h/2,z+dep/2),(.7,h,1),'Concrete')
   # Architectural wings give stepped, compound footprints rather than solitary boxes.
   if ROUND>=2:
    for side in [-1,1]:
     angle={'AURORA':.22,'IMPERIAL':-.25,'SERENISSIMA':0,'PALATIAL':.13,'EDEN':-.35,'LUMIERE':.32,'METROPOLIS':0}[name]*side
     box((x+side*w*.38,g+h*.39,z-dep*.55),(w*.23,h*.78,dep*1.5),'Windows',angle)
    for tier in range(3):
     box((x,g+h+2+tier*3,z),(w*(.72-tier*.12),3,dep*(.82-tier*.16)),'Concrete' if name in ['SERENISSIMA','IMPERIAL'] else 'Glass')
    if name in ['SERENISSIMA','IMPERIAL']:
     for dx in range(-int(w/2),int(w/2)+1,18):
      rod((x+dx,g+8,z+dep/2+4),(x+dx,g+25,z+dep/2+4),.7,'White',8)
    else:
     for yy in range(12,int(h),8):box((x,g+yy,z+dep/2+.4),(w,.22,.4),'Gold' if name=='EDEN' else 'Steel')
  for args in [(-115.1766,36.1127,220,145,54,'AURORA'),(-115.1762,36.1175,150,125,60,'IMPERIAL'),(-115.1699,36.1212,160,145,70,'SERENISSIMA'),(-115.1688,36.1245,140,145,58,'PALATIAL'),(-115.1655,36.1271,150,185,55,'EDEN'),(-115.1706,36.1127,145,105,50,'LUMIERE'),(-115.1745,36.1086,80,180,54,'METROPOLIS')]:hotel(*args)
  for i in range(100):
   d=random.random()*L;p=pt(d,random.choice([-1,1])*random.uniform(90,360));h=random.uniform(6,36)
   sphereXZ=project(-115.1621,36.1207)
   if math.hypot(p[0]-sphereXZ[0],p[2]-sphereXZ[1])<140:continue
   if min((p[0]-q[0])**2+(p[2]-q[1])**2 for q in coarse)<65**2:continue
   box((p[0],p[1]+h/2,p[2]),(random.uniform(16,42),h,random.uniform(20,45)),'Windows')
  x,z=project(-115.1745,36.1121);g=ground(x,z)
  for i in range(80):
   a=i*math.tau/80;b=(i+1)*math.tau/80;face([(x,g+.1,z),(x+95*math.cos(a),g+.1,z+135*math.sin(a)),(x+95*math.cos(b),g+.1,z+135*math.sin(b))],'Water');h=4+math.sin(a*3)**2*14;rod((x+65*math.cos(a),g,z+95*math.sin(a)),(x+65*math.cos(a),g+h,z+95*math.sin(a)),.13,'Gold')
  x,z=project(-115.172,36.1125);g=ground(x,z)
  for level in range(10):
   y=g+level*12;a=25*(1-level/11)**1.6;b=25*(1-(level+1)/11)**1.6
   for sx in [-1,1]:
    for sz in [-1,1]:rod((x+sx*a,y,z+sz*a),(x+sx*b,y+12,z+sz*b),.4,'Gold');rod((x+sx*a,y,z+sz*a),(x-sx*b,y+12,z+sz*b),.1,'Gold')
   if level in [3,6]:box((x,y,z),(a*2+3,1,a*2+3),'Gold')
  rod((x,g+120,z),(x,g+165,z),.3,'Gold')
  x,z=project(-115.1681,36.1176);g=ground(x,z)
  for i in range(100):
   a=i*math.tau/100;b=(i+1)*math.tau/100;rod((x+70*math.cos(a),g+84+70*math.sin(a),z),(x+70*math.cos(b),g+84+70*math.sin(b),z),.3,'Ice')
   if i%4==0:rod((x,g+84,z),(x+70*math.cos(a),g+84+70*math.sin(a),z),.07,'Steel');box((x+70*math.cos(a),g+84+70*math.sin(a),z),(3,3,4),'Pink')
  for dx in [-28,28]:rod((x+dx,g,z),(x,g+84,z),1,'Steel')
  x,z=project(-115.1621,36.1207);g=ground(x,z);radius=78.6384;cy=32.9184;thetaMax=math.acos(-cy/radius)
  for j in range(48):
   for i in range(96):
    pts=[];uv=[]
    for ii,jj in [(i,j),(i+1,j),(i+1,j+1),(i,j+1)]:
     a=ii*math.tau/96;t=jj*thetaMax/48;pts.append((x+radius*math.sin(t)*math.cos(a),g+cy+radius*math.cos(t),z+radius*math.sin(t)*math.sin(a)));uv.append((ii/96,1-jj/48))
    face(pts,'Sphere',uv,special='Sphere')
  # Truss bridge and near Sphere stands seen in race photographs.
  for d in [1340,1770]:
   for side in [-1,1]:rod(pt(d,side*11),pt(d,side*11,7),.15,'Steel')
   for h in [6,7]:rod(pt(d,-11,h),pt(d,11,h),.1,'Steel')
   for j in range(-11,11,2):rod(pt(d,j,6),pt(d,j+2,7),.08,'Steel')
 # Round-specific finishing based on screenshot reviews.
 if ROUND>=2:
  for c in data['corners']:
   for k in range(6):strip(c['d']-60+k*1.1,c['d']-15+k*.3,-1.1+k*.45,-.98+k*.45,'Rubber',.047,step=3)
 if ROUND>=3:
  # Pit lane details: painted service boxes, garage lighting, timing tower.
  for i in range(18):
   d=L-350+i*18;atbox(d,-25,4.3,(.18,.12,8),'Ice' if night else 'White')
   strip(d-6,d-5.85,-21,-15,'White',.055)
  atbox(L-40,18,8,(2.5,16,1.6),'Dark')
  for j in range(10):atbox(L-40,16.7,3+j*1.1,(.06,.35,1.4),'Gold' if night else 'White')
 # Rounded Monza hospitality/control tower; three-level Vegas pit frontage.
 if not night:
  x,y,z=pt(L-385,-34)
  for level in range(4):
   for i in range(40):
    a=i*math.tau/40;b=(i+1)*math.tau/40
    face([(x+10*math.cos(a),y+level*3,z+10*math.sin(a)),(x+10*math.cos(b),y+level*3,z+10*math.sin(b)),(x+10*math.cos(b),y+level*3+2.6,z+10*math.sin(b)),(x+10*math.cos(a),y+level*3+2.6,z+10*math.sin(a))],'Glass')
    rod((x+10.2*math.cos(a),y+level*3+2.8,z+10.2*math.sin(a)),(x+10.2*math.cos(b),y+level*3+2.8,z+10.2*math.sin(b)),.18,'White')
  for i in range(24):
   d=L-370+i*15;atbox(d,-53,2.2,(7,4.4,12),'White');atbox(d,-49.4,2.7,(.1,1.5,9),'Glass')
 else:
  for i in range(14):
   d=L-380+i*28;atbox(d,-24.9,9.15,(.1,1.7,27),'Glass');atbox(d,-27,11.35,(6,.18,27),'Dark')
   for j in [-12,0,12]:atbox(d+j,-24.6,9.3,(.12,2,.12),'Steel')
   atbox(d,-36,11.7,(10,.5,23),'Dark');atbox(d,-36,12.05,(9,.1,22),'Pink')
 if not night:
  for c in data['corners']:
   for k in range(20):
    x,y,z=pt(c['d']+22+k*.75,28)
    for row in range(3):
     for i in range(10):
      a=i*math.tau/10;b=(i+1)*math.tau/10
      face([(x+.34*math.cos(a),y+row*.28,z+.34*math.sin(a)),(x+.34*math.cos(b),y+row*.28,z+.34*math.sin(b)),(x+.34*math.cos(b),y+row*.28+.26,z+.34*math.sin(b)),(x+.34*math.cos(a),y+row*.28+.26,z+.34*math.sin(a))],'Dark')
 # Authored distant crown LODs; runtime uses these meshes, never generated substitutes.
 if not night:
  for i in range(4):
   bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1);o=bpy.context.object;o.name='LOD_Canopy'+str(i);o.data.materials.append(mats['Canopy'+str(i)]);uv=o.data.uv_layers.new(name='UVMap')
   for v in o.data.vertices:v.co*=1+.07*math.sin(v.co.x*12+v.co.y*8+i)
   for poly in o.data.polygons:
    poly.use_smooth=True
    for li in poly.loop_indices:
     co=o.data.vertices[o.data.loops[li].vertex_index].co.normalized();uv.data[li].uv=(math.atan2(co.y,co.x)/math.tau+.5,math.acos(max(-1,min(1,co.z)))/math.pi)
 # Export per-material spatial chunks; GLB geometries, including all terrain, are Blender-authored.
 triangles=instance_triangles
 for (tile,m),(verts,faces,uvs) in batches.items():
  mesh=bpy.data.meshes.new(f'{tile}_{m}');mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new(name='UVMap')
  for poly in mesh.polygons:
   for li in poly.loop_indices:uv.data[li].uv=uvs[mesh.loops[li].vertex_index]
  obj=bpy.data.objects.new(f'{tile}_{m}',mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(mats[m]);
  if m.startswith(('Canopy','Spectator')) or m=='Skin':
   bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.001);bm.to_mesh(mesh);bm.free()
   for poly in mesh.polygons:poly.use_smooth=True
  triangles+=sum(len(f)-2 for f in faces)
  if m in ('Fence','Foliage','Crowd'):mats[m].use_backface_culling=False
 for img in bpy.data.images:
  if img.source=='FILE':img.pack()
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/f'scripts/blender/{cid}.blend'))
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{cid}.glb'),export_format='GLB',export_gpu_instances=True,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_draco_position_quantization=18,export_draco_texcoord_quantization=16,export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
 # Identical Blender geometry, gzip encoded for MCP hosts that prohibit workers/WASM.
 raw=Path('/tmp')/f'jgp-{cid}-mcp.glb'
 bpy.ops.export_scene.gltf(filepath=str(raw),export_format='GLB',export_gpu_instances=True,export_draco_mesh_compression_enable=False,export_yup=True,export_cameras=False,export_lights=False)
 pack(raw,OUT/f'{cid}-mcp.glb.gz',positions=True);raw.unlink()
 (OUT/f'{cid}.glb.gz').write_bytes(gzip.compress((OUT/f'{cid}.glb').read_bytes(),compresslevel=9,mtime=0))
 profile={'length':L,'step':L/nr,'heights':heights,'source':'OpenTopoData Mapzen; median + Gaussian terrain smoothing; not survey grade','triangles':triangles,'chunks':len(batches),'sharedPrototypes':len(prototypes),'solidInstances':sum(1 for o in bpy.context.scene.objects if o.name.startswith('Instance_')),'round':ROUND,'blender':bpy.app.version_string}
 (OUT/f'{cid}-manifest.json').write_text(json.dumps(profile,indent=2)+'\n');print('CIRCUIT',cid,triangles,'triangles',len(batches),'chunks',flush=True)
for cid in ['monza','las-vegas']:build(cid)
