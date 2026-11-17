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
bpy.context.preferences.filepaths.save_version=0
ROUND=int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 1

def build(cid):
 random.seed(26)
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
   if tex=='formed-concrete':p=OUT/'formed-concrete.jpg'
   node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(p),check_existing=True);m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
   if emission:m.node_tree.links.new(node.outputs['Color'],bs.inputs['Emission Color'])
   if alpha:m.node_tree.links.new(node.outputs['Alpha'],bs.inputs['Alpha']);m.surface_render_method='DITHERED'
  mats[name]=m;return name
 mat('Asphalt',(.19,.20,.21),.52 if night else .91,tex='asphalt-color');mat('Grass',(.23,.26,.15),tex='grass-color');mat('Gravel',(.62,.58,.49),tex='gravel');mat('White',(.76,.75,.68));mat('Red',(.46,.027,.022));mat('Green',(.10,.24,.15));mat('Steel',(.38,.42,.45),.48,.65);mat('Concrete',(.47,.48,.45),.86,tex='formed-concrete');mat('Dark',(.022,.027,.032));mat('Glass',(.10,.16,.20),.22,.45);mat('Foliage',(.3,.4,.2),tex='foliage',alpha=True);mat('Fence',(.5,.5,.5),tex='fence',alpha=True);mat('Crowd',(.5,.5,.5),tex='crowd',alpha=True);mat('Sign',(.6,.6,.6),tex='sign',emission=.25 if night else 0);mat('Windows',(.5,.4,.3),tex='windows',emission=.65);mat('Gold',(.85,.52,.19),.5,emission=2);mat('Ice',(.6,.8,1),.5,emission=4);mat('Pink',(.8,.04,.3),emission=2);mat('Rubber',(.1,.1,.1),tex='rubber',alpha=True);mat('Water',(.015,.045,.06),.18,.5);mat('Trunk',(.14,.10,.07));mat('Sphere',(.1,.5,.6),tex='sphere-art',emission=1)
 for i,c in enumerate([(.085,.14,.035),(.12,.19,.05),(.17,.22,.065),(.09,.16,.07)]):mat('Canopy'+str(i),c,.94,tex='hornbeam',alpha=True)
 for i,c in enumerate([(.38,.025,.025),(.04,.08,.16),(.62,.60,.55),(.12,.15,.16)]):mat('Spectator'+str(i),c,.95)
 mat('GarageInterior',(.105,.103,.097),.92)
 mat('GarageFloor',(.18,.18,.17),.69)
 mat('ServiceRed',(.27,.026,.029),.56,.16)
 mat('GarageFascia',(.45,.45,.43),.62,tex='garage-fascia',emission=.45 if night else 0)
 mat('RoofSheet',(.36,.395,.43),.54,.35)
 mat('Cabinet',(.11,.14,.15),.55,.23)
 mat('SignalLens',(.084,.012,.009),.28,.15)
 mat('Skin',(.43,.28,.19),.9)
 if night:
  mat('CityGround',(.29,.31,.34),.92,tex='city-blocks',emission=.62)
  mat('DistantRidge',(.045,.048,.060),.94)
  mat('Travertine',(.62,.40,.21),.65,emission=.34)
  mat('WarmWindows',(.8,.58,.32),.4,tex='warm-windows',emission=.55)
  mat('CopperRoof',(.25,.17,.10),.38,.45)
  mat('Fountain',(.86,.75,.48),.26,emission=3)

 for number in [150,100,50]:mat('Brake'+str(number),(.8,.8,.8),tex='brake-'+str(number))
 batches={}
 tile_size=180
 tile_prefix=""
 def face(points,material,uv=None,special=None):
  centre=tuple(sum(p[i] for p in points)/len(points) for i in range(3));key=(special or f'{tile_prefix}{int(centre[0]//tile_size)}_{int(centre[2]//tile_size)}',material)
  vs,fs,us=batches.setdefault(key,([],[],[]));start=len(vs);vs.extend((x,-z,y) for x,y,z in points);fs.append(tuple(range(start,start+len(points))));us.extend(uv or [(0,0),(1,0),(1,1),(0,1)][:len(points)])
 def box(p,size,m,yaw=0):
  x,y,z=p;w,h,d=size;cs=math.cos(yaw);sn=math.sin(yaw)
  v=[(x+xx*cs+zz*sn,y+yy,z-xx*sn+zz*cs) for xx,yy,zz in [(-w/2,-h/2,-d/2),(w/2,-h/2,-d/2),(w/2,h/2,-d/2),(-w/2,h/2,-d/2),(-w/2,-h/2,d/2),(w/2,-h/2,d/2),(w/2,h/2,d/2),(-w/2,h/2,d/2)]]
  for f in [(3,2,1,0),(4,5,6,7),(0,1,5,4),(7,6,2,3),(1,2,6,5),(4,7,3,0)]:face([v[i] for i in f],m,[(0,0),(w/100 if m in ('Windows','WarmWindows') else 1,0),(w/100 if m in ('Windows','WarmWindows') else 1,h/130 if m in ('Windows','WarmWindows') else 1),(0,h/130 if m in ('Windows','WarmWindows') else 1)])
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
 def leaf_sprays(m,count,seed):
  # Bent, independently oriented branchlet fans throughout the crown volume.
  # Open space is actual geometry plus leaf cutouts; no closed ellipsoid shell.
  rng=random.Random(1701+seed);vv=[];ff=[];uvs=[]
  for j in range(count):
   a=j*2.39996+seed;t=(j+.5)/count;zz=1-2*t;rad=math.sqrt(max(0,1-zz*zz))
   c=Vector((math.cos(a)*rad*.68,math.sin(a)*rad*.68,zz*.78))
   normal=Vector((math.cos(a)*rad,math.sin(a)*rad,zz*.6)).normalized()
   u=normal.cross(Vector((0,0,1)))
   if u.length<.01:u=Vector((1,0,0))
   u.normalize();v=normal.cross(u).normalized();size=rng.uniform(.62,.90) if count>=24 else rng.uniform(.78,1.05)
   start=len(vv)
   vv.extend([tuple(c+u*x*size+v*y*size) for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)] ]+[tuple(c+normal*.13)])
   uvs.extend([(0,0),(1,0),(1,1),(0,1),(.5,.5)])
   ff.extend([(start+k,start+(k+1)%4,start+4) for k in range(4)])
  me=bpy.data.meshes.new('Layered branchlets '+m);me.from_pydata(vv,[],ff);me.materials.append(mats[m]);me.update();uv=me.uv_layers.new(name='UVMap')
  for poly in me.polygons:
   poly.use_smooth=True
   for li in poly.loop_indices:uv.data[li].uv=uvs[me.loops[li].vertex_index]
  return me
 def blob(p,scale,m,segments=8,rings=4,seed=0):
  nonlocal instance_triangles
  segments,rings=(12,6) if m.startswith('Canopy') else (segments,rings)
  key=(m,segments,rings,seed%2);mesh=prototypes.get(key)
  if mesh is None and m.startswith('Canopy'):
   mesh=leaf_sprays(m,24,seed%2);prototypes[key]=mesh
  if mesh is None:
   vv=[];ff=[]
   for j in range(rings+1):
    t=math.pi*j/rings
    for i in range(segments):
     a=i*math.tau/segments;r=1+.12*math.sin(i*2.7+j*3.1+seed%2)+(.06*math.cos(i*7.1-j*4.7) if m.startswith('Canopy') else 0)
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
  o=bpy.data.objects.new('Instance_'+m,mesh);bpy.context.collection.objects.link(o);o.parent=instanceRoot;o.location=(p[0],-p[2],p[1]);o.scale=(scale[0],scale[2],scale[1]);o.rotation_euler.z=(seed*2.39996 if m.startswith('Canopy') else 0);instance_triangles+=sum(len(f.vertices)-2 for f in mesh.polygons)
 def spectator(p,h,yaw,kit,pose):
  # Each seated silhouette faces the racing surface. Several welded lofts per
  # material make a shared person, including the negative space between limbs.
  nonlocal instance_triangles
  for part,m in [('shirt',kit),('face','Skin'),('legs','Dark')]:
   key=('seated',m,pose)
   mesh=prototypes.get(key)
   if mesh is None:
    vv=[];ff=[]
    def section(rows):
     start=len(vv);n=8
     for x,y,z,rx,rz in rows:
      for k in range(n):
       a=math.tau*k/n;vv.append((x+rx*math.cos(a),-(z+rz*math.sin(a)),y))
     for j in range(len(rows)-1):
      for k in range(n):
       a=start+j*n+k;b=start+j*n+(k+1)%n;ff.append((a,b,b+n,a+n))
     ff.append(tuple(start+(len(rows)-1)*n+k for k in range(n)))
    if part=='shirt':
     section([(0,.16,0,.15,.11),(0,.28,-.011,.16,.12),(0,.49,.014,.205,.125),(0,.56,.017,.174,.095),(0,.585,.017,.071,.070)])
     for sign in [-1,1]:
      reach=.1 if pose==1 and sign==1 else .175
      section([(sign*.145,.52,.01,.070,.07),(sign*.205,.42,.042,.063,.065),(sign*.212,.34,reach*.65,.052,.05)])
    elif part=='face':
     turn=(pose-1)*.027
     section([(0,.555,.013,.063,.062),(turn,.635,.037,.075,.075),(turn,.678,.042,.091,.093),(turn,.75,.022,.096,.096),(turn,.796,.012,.070,.064)])
     section([(turn,.681,.126,.018,.018),(turn,.712,.115,.016,.021)])
     for sign in [-1,1]:
      up=pose==1 and sign==1
      section([(sign*.21,.345,.105,.050,.05),(sign*.187,.345 if up else .291,.142,.041,.05),(sign*(.106 if up else .14),.618 if up else .22,.178 if up else .24,.034,.044)])
    else:
     section([((pose-1)*.027,.741,.013,.099,.099),((pose-1)*.027,.792,.014,.082,.080),((pose-1)*.027,.809,.014,.032,.04)])
     for sign in [-1,1]:
      section([(sign*.10,.164,.025,.088,.12),(sign*.105,.215,.065,.091,.146),(sign*.123,.224,.175,.079,.118)])
      section([(sign*.124,-.17,.211,.074,.119),(sign*.124,-.13,.192,.058,.080),(sign*.124,.136,.241,.065,.069),(sign*.123,.211,.221,.076,.086)])
    mesh=bpy.data.meshes.new('Seated '+part);mesh.from_pydata(vv,[],ff);mesh.materials.append(mats[m]);mesh.update()
    for poly in mesh.polygons:poly.use_smooth=True
    prototypes[key]=mesh
   o=bpy.data.objects.new('Instance_'+m,mesh);bpy.context.collection.objects.link(o);o.parent=instanceRoot
   o.location=(p[0],-p[2],p[1]);o.scale=(h,h,h);o.rotation_euler.z=yaw
   instance_triangles+=sum(len(f.vertices)-2 for f in mesh.polygons)
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
  for z in range(int(min(zs))-650,int(max(zs))+650,100):
   corners=[(x,z),(x,z+100),(x+100,z+100),(x+100,z)]
   tile=512 if night else 20
   face([(xx,ground(xx,zz)-2.0,zz) for xx,zz in corners],'CityGround' if night else 'Grass',[(xx/tile,zz/tile) for xx,zz in corners])
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
   # Cross-sections run between the actual endpoint frames so changing grade
   # and curvature remain continuous. Split joints cast a narrow contact shadow.
   def barrier_section(start, end, levels, material):
    for (h0,x0),(h1,x1) in zip(levels,levels[1:]):
     face([pt(start,off-side*x0,h0),pt(end,off-side*x0,h0),
           pt(end,off-side*x1,h1),pt(start,off-side*x1,h1)],material,
          [(start/4,h0),(end/4,h0),(end/4,h1),(start/4,h1)])
   if night:
    profile=[(.02,.34),(.19,.34),(.53,.17),(.98,.12),(1.05,.085),(1.05,-.12),(.03,-.30)]
    for start in [d,d+4]:
     barrier_section(start+.012,start+3.988,profile,'Concrete')
     joint=[pt(start+.012,off-side*x,h) for h,x in profile]
     for j in range(1,len(joint)-1):face([joint[0],joint[j],joint[j+1]],'Concrete')
   else:
    for h in [.17,.48,.79]:
     levels=[(h+dy,x) for dy,x in [(0,.12),(.044,.20),(.09,.205),(.154,.12),(.218,.205),(.265,.20),(.31,.12)]]
     barrier_section(d,d+8,levels,'Steel')
    for station in [d,d+4]:atbox(station,off+side*.11,.54,(.12,1.08,.15),'Steel')
   rod(a,(a[0],a[1]+4,a[2]),.045,'Steel');rod((a[0],a[1]+4,a[2]),pt(d,off-side*.5,4.6),.035,'Steel');
   for hh in [1.7,2.6,3.4]:rod(pt(d,off,hh),pt(d+8,off,hh),.009,'Steel',4)
   rod((a[0],a[1]+3.9,a[2]),(b[0],b[1]+3.9,b[2]),.026,'Steel')
   face([(a[0],a[1]+1,a[2]),(b[0],b[1]+1,b[2]),(b[0],b[1]+3.9,b[2]),(a[0],a[1]+3.9,a[2])],'Fence',[(0,0),(8,0),(8,3),(0,3)])
   if night or d%40==0:
    toward=-side*.35;aa=pt(d+.08,off+toward,.22);bb=pt(d+7.92,off+toward,.22);face([aa,bb,(bb[0],bb[1]+.75,bb[2]),(aa[0],aa[1]+.75,aa[2])],'Sign',[(1,0),(0,0),(0,1),(1,1)] if side>0 else None)
 strip(L-405,L+45,-26,-8,'Asphalt',.026)
 # Separate protected pit wall, keeping entry/exit gaps open.
 for d in range(int(L)-390,int(L)-20,8):atbox(d,-12,.65,(.45,1.3,8),'Concrete')
 # Recessed garages, mullions, balcony rail, fascia and roof overhang.
 for i in range(14):
  d=L-380+i*28;heightB=11 if night else 7.5
  atbox(d,-38.5,2.15,(9,4.3,27.8),'Concrete')
  atbox(d,-34,(heightB+4.3)/2,(18,heightB-4.3,27.8),'Concrete')
  atbox(d,-30.0,.052,(10,.10,27.8),'GarageFloor')
  atbox(d,-34,heightB+.2,(20,.35,28),'White')
  atbox(d,-36,heightB+.9,(3.6,1.2,5),'Steel')
  if i%3==0:
   atbox(d+11,-42,heightB*.45,(5,heightB*.9,4),'Glass')
   for step in range(14):atbox(d+11,-41-step*.2,.3+step*.43,(4,.18,.6),'Steel')
  # Raised timing islands between the apron and the racing surface.
  if i%2==0:
   atbox(d,-12.6,.46,(1.68,.82,7.6),'Concrete')
   atbox(d,-12.75,1.28,(1.25,.15,7.15),'Cabinet')
   for j in [-2.8,-1.4,0,1.4,2.8]:
    atbox(d+j,-12.46,1.83,(.15,.66,1.16),'Dark')
    atbox(d+j,-12.55,1.86,(.025,.52,1.01),'Glass')
   for j in [-3.32,3.32]:
    rod(pt(d+j,-13.11,.76),pt(d+j,-13.11,2.77),.057,'Steel')
    rod(pt(d+j,-13.11,2.7),pt(d+j,-11.72,2.52),.053,'Steel')
   atbox(d,-12.43,2.72,(2.0,.14,7.63),'Red' if i%4 else 'Dark')
   atbox(d,-11.47,2.62,(.07,.18,7.65),'White')
  for j in [-9,0,9]:
   atbox(d+j,-33.96,2.1,(.09,3.8,8.4),'Dark')
   atbox(d+j+4.34,-29.5,2.14,(9,4.28,.28),'GarageInterior')
   atbox(d+j-2.15,-30.6,.76,(.92,1.45,2.2),'Cabinet')
   atbox(d+j-2.15,-30.6,1.5,(1.04,.08,2.32),'Steel')
   for h in [.54,.84,1.14]:atbox(d+j-2.15,-30.12,h,(.035,.045,1.80),'Steel')
   for behind in [-27,-31]:atbox(d+j,behind,4.20,(.18,.055,5.4),'Ice' if night else 'White')
   # Wheel carts and monitor arms sit partly in the shade behind the raised shutters.
   if (i+j)%3!=0:
    atbox(d+j+2.6,-26.1,.52,(.76,.89,1.40),'ServiceRed' if i%2 else 'Cabinet')
    atbox(d+j+2.6,-26.1,1.0,(.84,.09,1.48),'Dark')
    for shelf in [.38,.59,.80]:atbox(d+j+2.6,-25.70,shelf,(.05,.035,1.18),'Steel')
    rod(pt(d+j+2.6,-26.1,1.02),pt(d+j+2.6,-26.1,1.62),.045,'Steel')
    atbox(d+j+2.6,-26.1,1.58,(.12,.48,.81),'Dark')
   row=(i+int(j/9))%4
   face([pt(d+j-3.82,-24.53,3.96),pt(d+j+3.82,-24.53,3.96),
         pt(d+j+3.82,-24.53,4.65),pt(d+j-3.82,-24.53,4.65)],'GarageFascia',
        [(0,1-(row+1)/4),(1,1-(row+1)/4),(1,1-row/4),(0,1-row/4)])
   atbox(d+j,-24.82,4.08,(.12,.15,7.7),'Ice' if night else 'Steel')
   # Garage doors sit behind jambs with folded shutters and recessed bays.
   for side in [-1,1]:atbox(d+j+side*3.63,-24.68,2.0,(.46,3.86,.16),'Steel')
   for slat in range(5):atbox(d+j,-24.73,3.08+slat*.16,(.18,.115,7.12),'Steel')
   atbox(d+j,-24.65,.12,(.5,.16,7.2),'Concrete')
   for k in [-4.2,4.2]:atbox(d+j+k,-24.9,2.2,(.25,4.4,.22),'White')
  atbox(d,-24.9,5.8,(.1,2.1,27),'Glass')
  for j in range(-13,14,3):atbox(d+j,-24.75,5.8,(.17,2.2,.1),'Steel')
  for j in [-11,-4,3,10]:
   rod(pt(d+j,-24.8,5.1),pt(d+j,-22.95,6.94),.07,'Steel')
   atbox(d+j,-23.9,6.98,(2.18,.18,.11),'Steel')
  atbox(d,-23.9,7.25,(2.1,.15,28),'White')
  for j in range(-13,14,4):atbox(d+j,-22.9,7.8,(.06,1.1,.06),'Steel')
  atbox(d,-22.9,8.35,(.06,.06,28),'Steel')
  if night:atbox(d,-24.6,10.7,(.15,.12,27),'Pink')
  for off in [-20,-17]:strip(d-10,d+10,off,off+.1,'White',.05)
 if not night:
  # The podium balcony projects out of the pit building at the finish.
  # Three stacked decks, a viewing gallery and a cantilevered steel gallery.
  atbox(-40,-32,9.2,(13,3.1,30),'Glass')
  for level in [7.8,10.82]:atbox(-40,-32,level,(14,.34,31.5),'White')
  for station in range(-54,-24,3):
   atbox(station,-25.45,9.2,(.21,2.95,.15),'Steel')
  atbox(-40,-23.5,10.7,(6,.46,24),'Concrete')
  atbox(-40,-20.5,11.3,(.11,1.15,24),'Glass')
  for station in range(-51,-27,3):atbox(station,-20.47,11.3,(.13,1.2,.13),'Steel')
  for jj in [-6.8,6.8]:
   rod(pt(-40+jj,-25.5,5.0),pt(-40+jj,-5.9,8.3),.32,'Steel',8)
   rod(pt(-40+jj,-25.3,8.3),pt(-40+jj,-6.1,8.3),.26,'Steel',8)
  atbox(-40,-16,8.57,(20.8,.55,14.8),'White')
  for station in [-47.32,-32.68]:
   for off in range(-25,-5,2):atbox(station,off,9.5,(.09,1.48,.09),'Steel')
   rod(pt(station,-25,10.2),pt(station,-5.65,10.2),.054,'Steel')
  for j,mat_name in enumerate(['Green','White','Red']):atbox(-45+j*5,-5.66,9.13,(.10,.91,4.93),mat_name)
  # Wind bends consecutive cloth strips into a changing three-dimensional silhouette.
  for flag in range(19):
   d=L-282+flag*13.4;off=49.1
   rod(pt(d,off,8.7),pt(d,off,16.3),.061,'Steel')
   for seg in range(12):
    def flagpoint(k,v):
     t=k/12;return pt(d+3.65*t,off+.53*math.sin(t*8+flag*.9)*t,16.15-1.92*v-.35*t+.31*math.sin(t*7+flag)*t)
    face([flagpoint(seg,0),flagpoint(seg+1,0),flagpoint(seg+1,1),flagpoint(seg,1)],['Green','White','Red'][seg//4])
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
     spectator(person,h,yaw+math.pi/2+random.uniform(-.25,.25),cloth,random.randrange(3))
   # Folded sheet canopy with a pitched face, purlins and exposed triangular trusses.
   for rib in range(16):
    start=d-15.98+rib*2
    for left,right,h0,h1 in [(-1.6,5.5,9.78,10.58),(5.5,12.2,10.58,10.14)]:
     face([pt(start,base+left,h0),pt(start+1.97,base+left,h0),
           pt(start+1.97,base+right,h1),pt(start,base+right,h1)],'RoofSheet')
     rod(pt(start,base+left,h0+.034),pt(start,base+right,h1+.034),.046,'Steel',4)
   for delta in [-15,-5,5,15]:
    station_d=d+delta
    for seg in range(7):
     o0=base-1.5+seg*2;o1=o0+2
     top=9.8+min(seg,7-seg)*.18
     rod(pt(station_d,o0,9.12),pt(station_d,o1,9.12),.063,'Steel',6)
     rod(pt(station_d,o0,9.12 if seg%2 else top),pt(station_d,o1,top if seg%2 else 9.12),.048,'Steel',5)
   for lip,h in [(-1.6,9.65),(12.2,10.0)]:atbox(d,base+lip,h,(.10,.29,31.95),'RoofSheet')
   for j in [-14,14]:
    for off in [base-1,base+11]:rod(pt(d+j,off),pt(d+j,off,10),.10,'Steel')
    rod(pt(d+j,base-1,8.9),pt(d+j,base+11,10),.07,'Steel');rod(pt(d+j,base-1,10),pt(d+j,base+11,8.9),.07,'Steel')
 # Gantry is a real triangulated lattice, with five signal boxes.
 for off in [-10,10]:rod(pt(0,off),pt(0,off,8),.16,'Steel')
 for y in [6.9,8]:rod(pt(0,-10,y),pt(0,10,y),.10,'Steel')
 for j in range(-10,10,2):rod(pt(0,j,6.9),pt(0,j+2,8),.06,'Steel');rod(pt(0,j,8),pt(0,j+2,6.9),.06,'Steel')
 face([pt(-.2,-10,7),pt(-.2,10,7),pt(-.2,10,8),pt(-.2,-10,8)],'Sign')
 # The start lamps sit in individual hoods under a catwalk, visible on approach.
 for lateral in [-10,10]:
  rod(pt(1,lateral),pt(1,lateral,8),.14,'Steel')
  rod(pt(0,lateral,8),pt(1,lateral,8),.09,'Steel')
 for h in [6.9,8]:rod(pt(1,-10,h),pt(1,10,h),.08,'Steel')
 for lateral in range(-10,10,2):
  rod(pt(1,lateral,6.9),pt(1,lateral+2,8),.055,'Steel')
  rod(pt(0,lateral,8),pt(1,lateral+2,8),.045,'Steel')
 for lamp in range(5):
  off=(lamp-2)*.47
  atbox(-.3,off,6.45,(.39,.88,.26),'Dark')
  for y in [6.25,6.64]:
   rod(pt(-.43,off,y),pt(-.46,off,y),.149,'SignalLens',14)
   atbox(-.50,off,y+.16,(.34,.036,.24),'Dark')
 for c in data['corners']:
  atbox(c['d']-30,23,1.2,(2,2.4,3),'White');atbox(c['d']-30,23,2.5,(2.4,.2,3.4),'Red');atbox(c['d']-30,21.9,1.7,(.03,.8,2),'Glass')
  for j in range(12):atbox(c['d']+30+j*1.3,27,.65,(1.1,1.3,1.2),'Red' if j%3 else 'White')
 if not night:
  # Layered, perforated oak/hornbeam branchlet fans and exposed branch structure.
  for i in range(5100):
   d=random.random()*L;off=random.choice([-1,1])*(43+random.random()**1.6*165);p=pt(d,off);x,y,z=p;y=ground(x,z)-2;p=(x,y,z)
   if min((x-q[0])**2+(z-q[1])**2 for q in coarse)<38**2:continue
   if (d>L-460 or d<150) and abs(off)<90:continue
   if min((x-pt(v,side)[0])**2+(z-pt(v,side)[2])**2 for v in range(int(L)-420,int(L)+100,35) for side in [-38,40])<28**2:continue
   species=(int(d/170)+i%7)%4
   h=random.uniform(8,24)*(1.12 if species==2 else 1);crown=h*[.39,.33,.19,.40][species]
   lean=math.sin(i*5.7)*h*.073;rod(p,(x+lean,y+h*.71,z),random.uniform(.16,.30),'Trunk',6)
   # Oak, hornbeam, columnar poplar and spreading pine: distinct crown proportions.
   lobes=[4,3,3,4][species]
   for k in range(lobes):
    a=k*math.tau/lobes+i*2.39996;spread=crown*(.28 if species==2 else .65)
    cx=x+lean+math.cos(a)*spread;cz=z+math.sin(a)*spread
    cy=y+h*([.66,.72,.55,.78][species]+k*[.035,.04,.14,.025][species])
    rod((x,y+h*.38,z),(cx,cy,cz),.075,'Trunk')
    blob((cx,cy,cz),(crown*random.uniform(.65,1.12),h*[.24,.28,.28,.14][species],crown*random.uniform(.65,1.05)),'Canopy'+str(species),8,4,i+k)

  # A second vegetation stratum breaks the bare-trunk horizon; no billboard foliage.
  # Reuse crown prototypes so shrubs and saplings stay in the existing instanced batches.
  for i in range(1800):
   d=random.random()*L;off=random.choice([-1,1])*random.uniform(39,105);x,y,z=pt(d,off);y=ground(x,z)-2
   if min((x-q[0])**2+(z-q[1])**2 for q in coarse)<36**2:continue
   if (d>L-470 or d<170) and abs(off)<92:continue
   h=random.uniform(2.4,8.5);species=i%4
   for k in range(2):blob((x+k*1.8,y+h*.65,z+math.sin(i)*2),(h*.65,h*.7,h*.6),'Canopy'+str(species),8,4,i+k)
 else:
  for d in range(0,int(L),45):
   for side in [-1,1]:
    rod(pt(d,side*10.5),pt(d,side*10.5,13),.08,'Steel');rod(pt(d,side*10.5,12.8),pt(d,side*7.5,12.8),.06,'Steel');atbox(d,side*7.5,12.7,(2.6,.15,.7),'Ice')
  # Curbside date palms break up the lamp rhythm and give the boulevard a
  # street-level silhouette beneath the resort skyline.
  for d in range(2550,4300,26):
   for side in [-1,1]:
    off=side*(25+4*math.sin(d));x,g,z=pt(d,off);h=7.8+2.7*math.sin(d*1.37)
    tip=(x+.65,g+h,z+.38);rod((x,g,z),tip,.19,'Trunk',7)
    for j in range(8):
     a=j*math.tau/8+d;width=.37;reach=3.1+.55*math.sin(d+j)
     def blade(t,w):
      return (tip[0]+reach*t*math.cos(a)-w*math.sin(a),tip[1]+1.1*math.sin(t*math.pi)-1.05*t*t,tip[2]+reach*t*math.sin(a)+w*math.cos(a))
     for k in range(5):
      t=k/5;u=(k+1)/5
      face([blade(t,-width*math.sin(t*math.pi)),blade(u,-width*math.sin(u*math.pi)),blade(u,width*math.sin(u*math.pi)),blade(t,width*math.sin(t*math.pi))],'Green')
  # A distant basin rim frames the low-rise city. Use broad folds, with
  # independent lower foothills and upper ridges to preserve depth at night.
  for layer in range(2):
   radius=3000+layer*700
   def ridge(k,base):
    a=k*math.tau/128
    r=radius+95*math.sin(5*a+layer)+64*math.sin(11*a)
    h=85+layer*85+63*math.sin(3*a+layer)+47*math.cos(7*a)+22*math.sin(19*a+.9*layer)
    return (r*math.cos(a),-8 if base else h,r*math.sin(a))
   for j in range(128):face([ridge(j,True),ridge(j+1,True),ridge(j+1,False),ridge(j,False)],'DistantRidge')
  origin=data['origin'];lat0=origin[1]*math.pi/180
  def project(lon,lat):return ((lon-origin[0])*111320*math.cos(lat0),-(lat-origin[1])*111320)
  def hotel(lon,lat,w,h,dep,name):
   x,z=project(lon,lat);g=ground(x,z)
   if name=='AURORA':
    # Bellagio-like crescent massing west of its lake. Original fictional architecture.
    # Tall central bay, stepped wings, pilasters and warm floodlit limestone cornices.
    for bay in range(-10,11):
     zz=z+bay*14;xx=x+abs(bay)**1.6*1.4;hh=145-abs(bay)*3.2;yaw=-math.copysign(.16+abs(bay)*.018,bay) if bay else 0
     box((xx,g+hh/2,zz),(35,hh,14.7),'WarmWindows',yaw)
     box((xx+18,g+hh/2,zz),(1.5,hh,1.3),'Travertine',yaw)
     for yy in [9,17,hh-8,hh]:box((xx,g+yy,zz),(38,1.3,15.5),'Travertine',yaw)
     box((xx+19,g+hh-6,zz),(.5,1.4,14),'Gold',yaw)
    box((x+3,g+151,z),(45,12,26),'Travertine')
    for side in [-1,1]:
     for bay in range(12):
      zz=z+side*bay*12;xx=x+48;box((xx,g+8,zz),(30,16,12),'Travertine')
      box((xx,g+17,zz),(33,1,13),'Gold');box((xx+15.2,g+8,zz),(.4,9,7),'Glass')
      for dz in [-4.5,4.5]:rod((xx+17,g,zz+dz),(xx+17,g+14,zz+dz),.55,'Travertine',8)
     # Copper pavilion domes and layered eaves beside the fountains.
     xx=x+65;zz=z+side*132;box((xx,g+11,zz),(29,22,29),'Travertine')
     blob((xx,g+23,zz),(18,7,18),'CopperRoof',24,12)
     for yy in [20,21.5]:box((xx,g+yy,zz),(33,.7,33),'Gold')
    return
   if name in ['EDEN','PALATIAL']:
    # Curved bronze resort wings, tall slit between towers and stepped crown.
    for wing in [-1,1]:
     for bay in range(9):
      a=(bay-4)*.105;xx=x+wing*(18+bay*11);zz=z+26*math.cos(a)-bay*3;hh=h*(1-.016*abs(bay-3))
      box((xx,g+hh/2,zz),(13,hh,dep*.60),'WarmWindows' if name=='PALATIAL' else 'Windows',wing*a)
      box((xx+wing*6.5,g+hh*.52,zz),(1,hh*.96,dep*.63),'CopperRoof',wing*a)
      box((xx,g+hh+1,zz),(14,2,dep*.64),'Gold',wing*a)
    box((x,g+6,z),(w+90,12,dep*1.8),'Travertine')
    return
   if name=='METROPOLIS':
    # Art-deco setbacks and a lit spire distinguish the south skyline.
    for tier in range(6):
     hh=h*(1-tier*.12);ww=w*(1-tier*.13);zz=z+tier*5
     box((x,g+hh/2+tier*11,zz),(ww,hh,dep*(1-tier*.11)),'Windows')
     box((x,g+hh+tier*11,zz),(ww+1,1.1,dep*(1-tier*.11)+1),'Ice')
    rod((x,g+h,z),(x,g+h+38,z),1.3,'Steel',8)
    box((x,g+10,z),(w*1.8,20,dep*1.6),'Travertine')
    return
   box((x,g+h/2,z),(w,h,dep),'WarmWindows' if name in ['IMPERIAL','SERENISSIMA'] else 'Windows');box((x,g+4,z),(w+24,8,dep+22),'Travertine')
   if name=='SERENISSIMA':
    # Venetian-inspired clock tower, arched loggia and pitched campanile roof.
    tx=x+w*.65;tz=z+dep*.8
    box((tx,g+44,tz),(17,88,17),'Travertine');box((tx,g+90,tz),(23,8,23),'CopperRoof')
    for side in [-1,1]:
     box((tx+side*9,g+84,tz),(.5,10,13),'Glass')
    apex=(tx,g+110,tz)
    corners=[(tx+dx,g+94,tz+dz) for dx,dz in [(-12,-12),(12,-12),(12,12),(-12,12)]]
    for j in range(4):face([corners[j],corners[(j+1)%4],apex],'CopperRoof',[(0,0),(1,0),(.5,1)])
   if name=='IMPERIAL':
    for side in [-1,1]:
     xx=x+side*w*.44;box((xx,g+h+7,z),(30,14,dep+8),'Travertine')
     blob((xx,g+h+15,z),(18,8,dep*.56),'CopperRoof',24,10)

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
  for i in range(330):
   d=random.random()*L;p=pt(d,random.choice([-1,1])*random.uniform(90,530));h=random.uniform(14,115)
   sphereXZ=project(-115.1621,36.1207)
   lake=project(-115.1745,36.1121)
   if ((p[0]-lake[0])/180)**2+((p[2]-lake[1])/240)**2<1:continue
   if any(abs(p[0]-project(lon,lat)[0])<95 and abs(p[2]-project(lon,lat)[1])<95 for lon,lat in [(-115.172,36.1125),(-115.1766,36.1127)]):continue
   if math.hypot(p[0]-sphereXZ[0],p[2]-sphereXZ[1])<140:continue
   if min((p[0]-q[0])**2+(p[2]-q[1])**2 for q in coarse)<65**2:continue
   w=random.uniform(20,58);dep=random.uniform(22,60);angle=random.choice([0,.12,-.18,.3]);box((p[0],p[1]+h/2,p[2]),(w,h,dep),'WarmWindows' if i%4==0 else 'Windows',angle)
   box((p[0],p[1]+3,p[2]),(w+12,6,dep+10),'Concrete',angle)
   for level in range(random.randint(1,3)):
    box((p[0],p[1]+h+level*4+2,p[2]),(w*(.8-level*.16),4,dep*(.8-level*.16)),'Glass',angle)
   accent=['Gold','Ice','Pink'][i%3]
   if i%3==0:box((p[0],p[1]+h*.83,p[2]+dep/2+.2),(w*.8,2,.4),accent)
   if i%5==0:
    box((p[0]+w/2+.25,p[1]+h*.6,p[2]),(.5,h*.6,1),accent)
    box((p[0],p[1]+h*.65,p[2]+dep/2+.3),(w*.7,8,.5),'Sign')
  x,z=project(-115.1745,36.1121);g=ground(x,z)
  for i in range(80):
   a=i*math.tau/80;b=(i+1)*math.tau/80;face([(x,g+.1,z),(x+95*math.cos(a),g+.1,z+135*math.sin(a)),(x+95*math.cos(b),g+.1,z+135*math.sin(b))],'Water');h=4+math.sin(a*3)**2*14;rod((x+65*math.cos(a),g,z+95*math.sin(a)),(x+65*math.cos(a),g+h,z+95*math.sin(a)),.13,'Gold')
  # Lit rings and parabolic fountain jets, tapered into the water rather than gold poles.
  for ring,rad in enumerate([35,65]):
   for i in range(64):
    a=i*math.tau/64;h=5+math.sin(a*3+ring)**2*14
    points=[]
    for j in range(7):
     t=j/6;r=rad+14*t;points.append((x+r*math.cos(a),g+.3+h*4*t*(1-t),z+r*1.4*math.sin(a)))
    for j in range(6):rod(points[j],points[j+1],.16*(1-j*.10),'Fountain',5)
    b=(i+1)*math.tau/64;rod((x+rad*math.cos(a),g+.2,z+rad*1.4*math.sin(a)),(x+rad*math.cos(b),g+.2,z+rad*1.4*math.sin(b)),.23,'Fountain',5)
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
  # Low-rise neighbourhoods and their lit arterial roads continue past the
  # race venue. Keep this illustrative skyline outside the circuit footprint
  # and the mapped Strip landmarks, clear of the actual racing surface.
  mat('DistrictStone',(.055,.061,.073),.93)
  mat('StreetLamp',(.82,.55,.28),.48,emission=2.6)
  tile_size=720
  tile_prefix='District_'
  town=random.Random(714)
  limits=(min(xs)-330,max(xs)+330,min(zs)-330,max(zs)+330)
  for row in range(-9,10):
   for col in range(-9,10):
    x=col*215;z=row*215
    if limits[0]<x<limits[1] and limits[2]<z<limits[3]:continue
    if min(abs(x-limits[0]),abs(x-limits[1]),abs(z-limits[2]),abs(z-limits[3]))>980:continue
    h=ground(x,z)-2
    for lot in range(3):
     dx=town.uniform(-79,80);dz=-63+lot*61;w=town.uniform(26,90);depth=town.uniform(18,42);bh=town.choice([8,10,15,18,24,34])
     box((x+dx,h+bh/2,z+dz),(w,bh,depth),'Windows')
     box((x+dx,h+bh+.3,z+dz),(w+1.1,.66,depth+1.1),'DistrictStone')
    for lamp in range(6):
     lx=x-90+lamp*35
     # Broad lenses stay visible at broadcast distances after tone mapping.
     box((lx,h+5.3,z+103),(1.6,.32,1.2),'StreetLamp')
  tile_size=180
  tile_prefix=''
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
   name='Canopy'+str(i);o=bpy.data.objects.new('LOD_'+name,leaf_sprays(name,16,i));bpy.context.collection.objects.link(o)
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
circuits=sys.argv[sys.argv.index('--')+2:] if '--' in sys.argv else []
for cid in circuits or ['monza','las-vegas']:
 if cid not in ('monza','las-vegas'):raise ValueError('Unknown circuit '+cid)
 build(cid)
