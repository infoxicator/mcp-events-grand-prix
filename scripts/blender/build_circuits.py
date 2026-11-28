"""Blender-authored, spatially chunked circuit GLBs. Y-up input -> Blender Z-up.
Source path is the exact authoritative race centreline. Coarse DEM is explicitly
smoothed: this is terrain-scale elevation, not a surveyed racing surface.
"""
import bpy,bmesh,json,math,random,statistics,sys,gzip
from pathlib import Path
from mathutils import Vector
from mathutils.kdtree import KDTree
sys.path.insert(0,str(Path(__file__).parent))
from pack_glb import pack
from pit_props import prototype
from grandstand_people import spectator_mesh
from check_monza_clearance import barrier_distance,check as check_monza
from track_people import staff_mesh,staff_material
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
   p=OUT/(tex+('.jpg' if tex=='gravel' else '.png')) if tex not in ('asphalt-color','grass-color') else ROOT/'src/race/assets'/(tex+'.jpg')
   if tex.endswith(('-timing','-garage')) or tex.startswith('upper-') or tex in ('formed-concrete','garage-backplate','resort-facade','hospitality-glass','desert-district'):p=OUT/(tex+'.jpg')
   node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(p),check_existing=True);m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
   if emission:m.node_tree.links.new(node.outputs['Color'],bs.inputs['Emission Color'])
   if alpha:m.node_tree.links.new(node.outputs['Alpha'],bs.inputs['Alpha']);m.surface_render_method='DITHERED'
  mats[name]=m;return name
 mat('Asphalt',(.19,.20,.21),.52 if night else .91,tex='asphalt-color');mat('Grass',(.23,.26,.15),tex='grass-color');mat('Gravel',(.62,.58,.49),tex='gravel');mat('White',(.76,.75,.68));mat('Red',(.46,.027,.022));mat('Green',(.10,.24,.15));mat('Steel',(.38,.42,.45),.48,.65);mat('Concrete',(.47,.48,.45),.86,tex='formed-concrete');mat('Dark',(.022,.027,.032));mat('Glass',(.10,.16,.20),.22,.45);mat('Fence',(.5,.5,.5),tex='fence',alpha=True);mat('Sign',(.6,.6,.6),tex='sign',emission=.25 if night else 0);mat('Windows',(.5,.4,.3),tex='hospitality-glass',emission=.70);mat('Gold',(.85,.52,.19),.5,emission=2);mat('Ice',(.6,.8,1),.5,emission=4);mat('Pink',(.8,.04,.3),emission=2);mat('Rubber',(.1,.1,.1),tex='rubber',alpha=True);mat('Water',(.015,.045,.06),.18,.5);mat('Trunk',(.14,.10,.07));mat('PalmFrond',(.12,.25,.085),.78);mat('Sphere',(.1,.5,.6),emission=1)
 for i,c in enumerate([(.085,.14,.035),(.12,.19,.05),(.17,.22,.065),(.09,.16,.07)]):mat('Canopy'+str(i),c,.94,tex='hornbeam',alpha=True)
 for i,c in enumerate([(.38,.025,.025),(.04,.08,.16),(.62,.60,.55),(.12,.15,.16)]):mat('Spectator'+str(i),c,.95)
 atlas=bpy.data.images.load(str(ROOT/'scripts/blender/textures/garage-staff.jpg'),check_existing=True)
 staff_material(mats['Spectator0'],bpy.data.images.load(str(ROOT/'scripts/blender/textures/spectators.jpg'),check_existing=True),'Wardrobe')
 mat('WorkshopBack',(.8,.8,.8),.85,tex=cid+'-garage',emission=.38 if night else .12)
 mat('GarageInterior',(.105,.103,.097),.92)
 mat('TimingScreen',(1,1,1),.58,emission=.68)
 mat('GantryCarbon',(.027,.033,.037),.35,.46)
 mat('WarmerFabric',(.055,.060,.065),.87)
 mat('GarageFloor',(.21,.22,.22),.22)
 mat('ServiceRed',(.27,.026,.029),.56,.16)
 mat('GarageFascia',(.45,.45,.43),.62,emission=.45 if night else 0)
 mat('RoofSheet',(.36,.395,.43),.54,.35)
 mat('Cabinet',(.11,.14,.15),.55,.23)
 mat('ImpactRed',(.58,.026,.016),.68)
 mat('ImpactIvory',(.73,.72,.65),.72)
 mat('RescueOrange',(.94,.16,.018),.8)
 mat('RunoffPaint',(.046,.24,.137),.89)
 mat('RepairCourse',(.15,.15,.16),.73,tex='asphalt-color');mat('TarSeam',(.045,.040,.037),.52)
 if not night:mat('GravelMargin',(.62,.58,.49),tex='gravel-margin',alpha=True)
 for i in range(4):mat('Sponsor'+str(i),(.8,.8,.8),.56,tex='sponsor-'+str(i),emission=.22 if night else 0)
 mat('BayAccent',(1,1,1),.42)
 accent_nodes=mats['BayAccent'].node_tree.nodes;attr=accent_nodes.new('ShaderNodeVertexColor');attr.layer_name='Team paint'
 mats['BayAccent'].node_tree.links.new(attr.outputs['Color'],accent_nodes.get('Principled BSDF').inputs['Base Color'])
 mat('PitTarget',(.95,.71,.024),.61)
 for name in ('GrandstandFlag','SafetyBoard','Photographer','SpareNoseRack','TyreBlanketRack'):
  mat(name,(1,1,1),.70)
  material=mats[name];nodes=material.node_tree.nodes;attribute=nodes.new('ShaderNodeVertexColor');attribute.layer_name='Equipment colour'
  material.node_tree.links.new(attribute.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
 for name,col in [('Stop',(.85,.018,.009)),('Go',(.012,.85,.12)),('Blue',(.02,.20,.94))]:mat('PitExit'+name,col,.29,emission=.7)
 for i in range(5):mat('GridLens'+str(i),(.11,.004,.003),.22,.16)
 mat('MarshalLED',(.03,.12,.04),.45,emission=.8)
 mat('SignalLens',(.084,.012,.009),.28,.15)
 mat('SeatedSkin',(.43,.28,.19),.9);mat('SeatedDark',(.022,.027,.032))
 for name in ('MarshalUniform','FinishUniform','PitCrewUniform'):
  mat(name,(1,1,1),.85)
  staff_material(mats[name],atlas)
 # Soft contact under the two soles remains visible beneath the garage canopy.
 mat('BootContact',(.012,.011,.01),1)
 contact=mats['BootContact'];nodes=contact.node_tree.nodes
 image=bpy.data.images.new('Boot contact',64,64,alpha=True);pixels=[]
 for iy in range(64):
  for ix in range(64):
   x=(ix+.5)/64*.76-.38;z=(iy+.5)/64*.82-.41
   alpha=0
   for side in [-1,1]:
    cz=(.072 if side<0 else -.07)+.055
    r=((x-side*.133)/.118)**2+((z-cz)/.205)**2
    alpha+=.47*math.exp(-1.38*r)+.11*math.exp(-.54*r)
   pixels.extend((.016,.015,.014,min(.69,alpha)))
 image.pixels.foreach_set(pixels);image.pack()
 ink=nodes.new('ShaderNodeTexImage');ink.image=image
 contact.node_tree.links.new(ink.outputs['Alpha'],nodes.get('Principled BSDF').inputs['Alpha'])
 mat('Skin',(.43,.28,.19),.9)
 mat('PaddockBanner',(.8,.82,.84),.48,tex='paddock-club')
 mat('LoungeLight',(1,.64,.31),.47,emission=1.4)
 mat('PitWallEngineer',(1,1,1),.78)
 uniform=mats['PitWallEngineer'];colour=uniform.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Wardrobe'
 uniform.node_tree.links.new(colour.outputs['Color'],uniform.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 mat('Hospitality',(.09,.16,.19) if night else (.34,.23,.16),.12,.46,emission=0 if night else .20)
 mat('LoungeLeather',(.22,.16,.097),.62)
 mat('LoungeWall',(.19,.22,.23),.64,emission=.18 if night else 0)
 mat('Balustrade',(.49,.60,.62),.17,.12)
 if not night:mat('ParkHorizon',(.68,.72,.65),tex='park-horizon',alpha=True)
 if night:
  mat('CityGround',(.29,.31,.34),.92,tex='desert-district',emission=.49)
  mat('DistantRidge',(.045,.048,.060),.94)
  mat('Travertine',(.62,.40,.21),.65,emission=.34)
  mat('WarmWindows',(.8,.58,.32),.4,tex='resort-facade',emission=.84)
  for style in ['Curtain','Stone','Ribbon']:
   mat('Upper'+style,(.43,.46,.5),.55,.11,tex='upper-'+style.lower(),emission=.68)
  mat('RecessGlass',(.065,.105,.128),.36,.22,emission=.20)
  mat('CopperRoof',(.25,.17,.10),.38,.45)
  mat('Fountain',(.86,.75,.48),.26,emission=3)

 if not night:
  mats['Armco']=mats['Steel'].copy();mats['Armco'].name='Armco'
 for number in [150,100,80,50]:mat('Brake'+str(number),(.8,.8,.8),tex='brake-'+str(number))
 batches={};accent_colors={}
 tile_size=520
 tile_prefix=""
 def face(points,material,uv=None,special=None,top=False):
  size=1200 if material in ('Grass','CityGround','DistantRidge','ParkHorizon') else tile_size
  centre=tuple(sum(p[i] for p in points)/len(points) for i in range(3));key=(special or f'{tile_prefix}{int(centre[0]//size)}_{int(centre[2]//size)}',material)
  if material.startswith('BayAccent'):
   bay=int(material[9:]);key=(key[0],'BayAccent')
   accent_colors.setdefault(key,[]).extend([(*uniforms[bay],1)]*len(points))
  # Road strips can run in either lateral direction. The upper surface faces the sky.
  if top:
   a,b,c=map(Vector,points[:3])
   if (b-a).cross(c-a).y<0:
    points=list(reversed(points))
    if uv:uv=list(reversed(uv))
  vs,fs,us=batches.setdefault(key,([],[],[]));start=len(vs);vs.extend((x,-z,y) for x,y,z in points);fs.append(tuple(range(start,start+len(points))));us.extend(uv or [(0,0),(1,0),(1,1),(0,1)][:len(points)])
 def box(p,size,m,yaw=0,facade_span=None):
  x,y,z=p;w,h,d=size;cs=math.cos(yaw);sn=math.sin(yaw)
  footing=night and y-h/2<=ground(x,z)+.2 and m in ('Travertine','UpperRibbon','UpperCurtain','UpperStone','Windows','DistrictStone','CopperRoof')
  if footing:
   depth=3.5;h+=depth;y-=depth/2
  v=[(x+xx*cs+zz*sn,y+yy,z-xx*sn+zz*cs) for xx,yy,zz in [(-w/2,-h/2,-d/2),(w/2,-h/2,-d/2),(w/2,h/2,-d/2),(-w/2,h/2,-d/2),(-w/2,-h/2,d/2),(w/2,-h/2,d/2),(w/2,h/2,d/2),(-w/2,h/2,d/2)]]
  for index,f in enumerate([(3,2,1,0),(4,5,6,7),(0,1,5,4),(7,6,2,3),(1,2,6,5),(4,7,3,0)]):
   points=[v[i] for i in f]
   if m.startswith('Upper'):
    if index in (2,3):face(points,'RoofSheet');continue
    # Complete, nonrepeating elevations. A segmented resort takes a
    # continuous slice across its long side; its end walls have their own span.
    origin,scale=facade_span if facade_span and index>=4 else (0,1)
    along=[0,1,1,0,0,1,1,0] if index<2 else [0,0,0,0,1,1,1,1]
    uv=[(origin+along[j]*scale,(v[j][1]-y+h/2)/h) for j in f]
   elif m in ('Windows','WarmWindows','Hospitality','StoreGlass'):
    # Map by world height and facade length on each of the four walls. The
    # lateral faces on narrow tower bays previously stretched a single window.
    period_x,period_y=(39,23) if m=='WarmWindows' else (36,20.4)
    span=d if index>=4 else w
    shift=(round(x/12)*.293+round(z/12)*.137)%1
    if index in (2,3):
     face(points,'RoofSheet');continue
    # Same vertical datum on all four walls; align sills around a corner.
    along=([0,1,1,0,0,1,1,0] if index<2 else [0,0,0,0,1,1,1,1])
    uv=[(shift+along[j]*span/period_x,(v[j][1]-y+h/2)/period_y) for j in f]
   else:
    along=[0,1,1,0,0,1,1,0] if index<2 else [0,0,0,0,1,1,1,1]
    uv=[(along[j],(v[j][1]-y+h/2)/h) for j in f] if index not in (2,3) else None
    if uv and m=='Concrete':uv=[(u*(d if index>=4 else w)/3,t*h/3) for u,t in uv]
   if uv and index in (0,4):
    span=max(u for u,_ in uv)+min(u for u,_ in uv)
    uv=[(span-u,t) for u,t in uv]
   face(points,m,uv)

 def rod(a,b,r,m,sides=5):
  nonlocal instance_triangles
  if m=='Trunk' or (night and m=='Steel' and abs(b[1]-a[1])>=10 and a[0]==b[0] and a[2]==b[2]):
   key=(m,sides,0,0);mesh=prototypes.get(key)
   if mesh is None:
    vv=[(math.cos(i*math.tau/sides),math.sin(i*math.tau/sides),z) for z in [-.5,.5] for i in range(sides)];ff=[(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)];mesh=bpy.data.meshes.new('Shared '+m+' rod');mesh.from_pydata(vv,[],ff);mesh.materials.append(mats[m]);mesh.update()
    for poly in mesh.polygons:poly.use_smooth=True
    prototypes[key]=mesh
   aa=Vector((a[0],-a[2],a[1]));bb=Vector((b[0],-b[2],b[1]));o=bpy.data.objects.new('Instance_'+m,mesh);bpy.context.collection.objects.link(o);o.parent=instanceRoot;o.location=(aa+bb)/2;o.rotation_euler=(bb-aa).to_track_quat('Z','Y').to_euler();o.scale=(r,r,(bb-aa).length);instance_triangles+=sides*2;return
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
 def prop(name,p,yaw,scale=1):
  nonlocal instance_triangles
  if name not in prototypes:prototypes[name]=prototype(name,mats[name])
  mesh=prototypes[name];obj=bpy.data.objects.new('Instance_'+name,mesh);bpy.context.collection.objects.link(obj)
  obj.parent=instanceRoot;x,y,z=p;obj.location=(x,-z,y);obj.rotation_euler.z=yaw;obj.scale=(scale,scale,scale)
  instance_triangles+=sum(len(f.vertices)-2 for f in mesh.polygons)
 def monitor_face(d,off,h,w,tall,quadrant):
  u=(quadrant%2)*.5;v=(1-quadrant//2)*.5
  face([pt(d+a,off,h+b) for a,b in [(-w/2,-tall/2),(w/2,-tall/2),(w/2,tall/2),(-w/2,tall/2)]],
       'TimingScreen',[(u,v),(u+.5,v),(u+.5,v+.5),(u,v+.5)])
 def staff(role,p,yaw,kit=(.031,.09,.14),uniform=None,alternate=False):
  nonlocal instance_triangles
  key=(role,kit,alternate)
  if key not in prototypes:
   material=uniform or {'marshal':'MarshalUniform','finish':'FinishUniform','crew':'PitCrewUniform','observer':'PitCrewUniform'}[role]
   prototypes[key]=staff_mesh(role,mats[material],kit,alternate)
  mesh=prototypes[key];o=bpy.data.objects.new('Instance_'+role,mesh)
  bpy.context.collection.objects.link(o);o.parent=instanceRoot
  x,y,z=p;o.location=(x,-z,y);o.rotation_euler.z=yaw
  instance_triangles+=sum(len(f.vertices)-2 for f in mesh.polygons)
  cs=math.cos(yaw);sn=math.sin(yaw)
  face([(x+xx*cs+zz*sn,y+.003,z-xx*sn+zz*cs) for xx,zz in [(-.38,-.41),(.38,-.41),(.38,.41),(-.38,.41)]],'BootContact',top=True)
 def spectator(p,h,yaw,kit,pose,engineer_colour=None):
  nonlocal instance_triangles
  kit='Spectator0' if engineer_colour is None else kit
  if engineer_colour is not None:engineer_colour=(1,1,1)
  key=(kit,pose,engineer_colour)
  if key not in prototypes:prototypes[key]=spectator_mesh(mats[kit],pose,engineer_colour=engineer_colour)
  mesh=prototypes[key];o=bpy.data.objects.new('Instance_PitWallEngineer' if engineer_colour is not None else 'Instance_Spectator',mesh)
  bpy.context.collection.objects.link(o);o.parent=instanceRoot
  x,y,z=p;o.location=(x,-z,y);o.scale=(h*(.98+.065*math.sin(x*3)),h,h);o.rotation_euler.z=yaw
  instance_triangles+=sum(len(f.vertices)-2 for f in mesh.polygons)
 pavement_profile=json.loads((ROOT/'data/pavement.json').read_text())[cid]
 def pavement(d,offset):
  a=d*math.tau/L;w=pavement_profile['waves'];amp=pavement_profile['amplitudes']
  return amp[0]*math.sin(a*w[0])+amp[1]*math.sin(a*w[1]+.6)+offset*.00011*math.sin(a*w[0]+.9)+.012*max(0,1-(offset/sample(d)['width'])**2)
 def strip(start,end,left,right,m,y=.02,step=2,ys=None):
  count=math.ceil((end-start)/step)
  for i in range(count):
   a=start+(end-start)*i/count;b=start+(end-start)*(i+1)/count;l=left(a) if callable(left) else left;r=right(a) if callable(right) else right;lb=left(b) if callable(left) else left;rb=right(b) if callable(right) else right
   levels=[y,y,y+(ys or 0),y+(ys or 0)];coords=[(a,l),(b,lb),(b,rb),(a,r)]
   uv=[(x/3,q/3) for q,x in coords]
   if m in ('Rubber','GravelMargin'):
    pitch=6 if m=='Rubber' else 3
    uv=[(0,a/pitch),(0,b/pitch),(1,b/pitch),(1,a/pitch)]
   face([pt(q,x,h+(pavement(q,x) if m=='Asphalt' else 0)) for (q,x),h in zip(coords,levels)],m,uv,top=True)
 def atbox(d,off,y,size,m):
  s=sample(d);box(pt(d,off,y),size,m,math.atan2(s['tx'],s['tz']))
 def street_hardware(d,off,h,size,material):
  # Gutter bars and reflectors use the same unit casting. Keep their transforms
  # as Blender/glTF instances instead of encoding a cube at each world position.
  nonlocal instance_triangles
  key=('street hardware',material)
  mesh=prototypes.get(key)
  if mesh is None:
   mesh=bpy.data.meshes.new('Street hardware '+material)
   bm=bmesh.new();bmesh.ops.create_cube(bm,size=1);bm.to_mesh(mesh);bm.free()
   mesh.materials.append(mats[material]);prototypes[key]=mesh
  obj=bpy.data.objects.new('Instance_StreetHardware',mesh)
  bpy.context.collection.objects.link(obj);obj.parent=instanceRoot
  x,y,z=pt(d,off,h);obj.location=(x,-z,y);obj.scale=(size[0],size[2],size[1])
  tangent=sample(d);obj.rotation_euler.z=math.atan2(tangent['tx'],tangent['tz'])
  instance_triangles+=12
 # Broad land follows the coarse DEM; fine surface always follows exact exported track.
 xs=[s['x'] for s in samples];zs=[s['z'] for s in samples]
 for x in range(int(min(xs))-650,int(max(xs))+650,100):
  for z in range(int(min(zs))-650,int(max(zs))+650,100):
   corners=[(x,z),(x,z+100),(x+100,z+100),(x+100,z)]
   tile=512 if night else 20
   face([(xx,ground(xx,zz)-2.0,zz) for xx,zz in corners],'CityGround' if night else 'Grass',[(xx/tile,zz/tile) for xx,zz in corners])
 if not night:
  strip(0,L,-38,38,'Grass',-.06,step=4)
  for side in (-1,1):
   for k in range(math.ceil(L/4)):
    a=4*k;b=min(a+4,L)
    corners=[pt(a,side*38,-.06),pt(b,side*38,-.06)]
    for station in (b,a):
     x,_,z=pt(station,side*49);corners.append((x,ground(x,z)-2.25,z))
    if side>0:corners.reverse()
    face(corners,'Grass',[(x/20,z/20) for x,_,z in corners],top=True)
 def lane_edge(d,j):return (sample(d)['width']+(2 if night else .7))*(j/3-1)
 for j in range(6):strip(0,L,lambda d:lane_edge(d,j),lambda d:lane_edge(d,j+1),'Asphalt',step=4)
 # Resurfacing patches share their crown and transition length with the tyre model.
 for start,end,left,right,rise in pavement_profile['patches']:
  span=end-start;steps=math.ceil((span-.8)/1.6)
  stations=[start,start+.09]+[start+.4+(span-.8)*i/steps for i in range(steps+1)]+[end-.09,end]
  across=[left,left+.09,left+.4,right-.4,right-.09,right]
  def patch_vertex(d,x):
   edge=min(d-start,end-d,x-left,right-x);t=min(1,edge/.4)
   top=.0215+rise*t*t*(3-2*t)+.0022*math.exp(-(edge-.09)**2/.0025)
   return pt(d,x,top+pavement(d,x))
  for i,(a,b) in enumerate(zip(stations,stations[1:])):
   for j,(l,r) in enumerate(zip(across,across[1:])):
    coords=[(a,l),(b,l),(b,r),(a,r)]
    seam=i in (0,len(stations)-2) or j in (0,len(across)-2)
    face([patch_vertex(q,x) for q,x in coords],'TarSeam' if seam else 'RepairCourse',[(x/3,q/3) for q,x in coords],top=True)
 # Clip the circuit-edge paint, gravel and raised kerbs at the actual openings.
 def clear_ranges(start,end,side):
  cursor=start
  if side<0:
   for a,b in data['pitOpenings']:
    if b<=cursor or a>=end:continue
    if a>cursor:yield cursor,a
    cursor=max(b,cursor)
  if cursor<end:yield cursor,end
 for side in [-1,1]:
  for a,b in clear_ranges(0,L,side):strip(a,b,lambda d:side*sample(d)['width']-.07,lambda d:side*sample(d)['width']+.07,'White',.035)
 # The merge is a single paved apron. Lay its lower course underneath the
 # racing surface and service lane, including the narrow strip between them.
 strip(data['pitEntry'],L+data['pitExit'],lambda d:min(-sample(d)['width'],sample(d)['pit']-3.4),lambda d:-sample(d)['width']+.1,'Asphalt',.006)
 strip(data['pitEntry'],L+data['pitExit'],lambda d:sample(d)['pit']-3.4,lambda d:sample(d)['pit']+3.4,'Asphalt',.025)
 strip(data['pitEntry'],L+data['pitExit'],lambda d:sample(d)['pit']-3.25,lambda d:sample(d)['pit']-3.12,'White',.04)

 last_braking_corner=-1000
 for c in data['corners']:
  if c['speed']>78:continue
  start=c['d']-(18 if night else 140 if c['name']=='Parabolica' else 45);end=c['d']+(25 if night else 180 if c['name']=='Parabolica' else 70)
  for side in [-1,1]:
   if not night:
    def apron(d):
     taper=min(1,max(0,(d-start+25)/25),max(0,(end+30-d)/30))
     return 1.1+2.9*taper*taper*(3-2*taper)
    if c['name']=='Rettifilo':
     # Loose aggregate settles into a scalloped grass margin. Keep the
     # whole boundary in one low strip with coarse, distance-stable detail.
     def gravel_edge(d):
      fan=max(0,math.sin(math.pi*(d-start+35)/(end-start+75)))**.75
      return sample(d)['width']+apron(d)+18*fan
     def shoulder(d):
      return .50+.26*math.sin(d*.31+side)+.22*math.sin(d*.71)
     for a,b in clear_ranges(start-18,end+20,side):
      edge=lambda d:sample(d)['width']+apron(d)
      strip(a,b,lambda d:side*(edge(d)-.23-.22*math.sin(d*.41+side)-.13*math.cos(d*.79)),lambda d:side*(edge(d)+.60),'Gravel',.039,step=1.)
     strip(start-29,end+33,lambda d:side*(gravel_edge(d)-.40),lambda d:side*(gravel_edge(d)+shoulder(d)),'Gravel',.038,step=1.5)
     strip(start-29,end+33,lambda d:side*(gravel_edge(d)+shoulder(d)),lambda d:side*(gravel_edge(d)+shoulder(d)+1.24+.33*math.sin(d*.23)),'GravelMargin',.037,step=1.5)
    for a,b in clear_ranges(start-25,end+30,side):strip(a,b,lambda d:side*(sample(d)['width']+1.1),lambda d:side*(sample(d)['width']+apron(d)),'RunoffPaint',.03)
    if c['name']!='Parabolica' or side<0:
     def trap_edge(q):
      fan=max(0,math.sin(math.pi*(q-start+35)/(end-start+75)))**.75
      return sample(q)['width']+apron(q)+18*fan
     for a,b in clear_ranges(start-35,end+40,side):
      strip(a,b,lambda q:side*(sample(q)['width']+apron(q)),lambda q:side*trap_edge(q),'Gravel',.025)
      if c['name']!='Rettifilo':
       strip(a,b,lambda q:side*trap_edge(q),lambda q:side*(trap_edge(q)+1.10+.24*math.sin(q*.23)),'GravelMargin',.026)
   d=start
   while d<end:
    if side<0 and any(a<d+1.8 and b>d for a,b in data['pitOpenings']):
     d+=1.8;continue
    w=.85 if night else 1.1
    m=(('Red','White','Dark') if night else ('Red','White','Green'))[round((d-start)/1.8)%3]
    stop=min(d+1.8,end);rise=.025 if night else .07
    strip(d,stop,lambda q:side*sample(q)['width'],lambda q:side*(sample(q)['width']+w),m,.04,step=2,ys=rise)
    edgepts=[pt(q,side*(sample(q)['width']+w),y) for q,y in [(d,.04+rise),(stop,.04+rise),(stop,-.015),(d,-.015)]]
    face(edgepts if side<0 else list(reversed(edgepts)),m)
    for q,reverse in [(d,side>0),(stop,side<0)]:
     pts=[pt(q,side*(sample(q)['width']+off),y) for off,y in [(0,.04),(w,.04+rise),(w,-.015),(0,-.015)]]
     face(pts[::-1] if reverse else pts,m)
    if not night:
     for q in [d+.25,d+.85,d+1.45]:atbox(q,side*(sample(q)['width']+.54),.085,(.78,.076,.18),m)
    d+=1.8
   if not night and c['speed']<45:
    for j in range(7):atbox(c['d']-9+j*3,side*(sample(c['d'])['width']+1.4),.105,(.3,.17,1.7),'Red')
  # In a sequence of turns, mark the braking approach once. Mount the
  # printed face across the driver's sightline with the lettering upright.
  if c['speed']<=70 and c['d']-last_braking_corner>210:
   last_braking_corner=c['d']
   for delta in [150,100,50]:
    st=c['d']-delta;off=-sample(st)['width']-(1.67 if night else 2.65)
    bottom=1.24 if night else .34
    for x in [-.43,.43]:
     rod(pt(st+.08,off+x,.03),pt(st+.08,off+x,bottom+.92),.030,'Steel',5)
    atbox(st+.05,off,bottom+.47,(1.35,.94,.073),'RoofSheet')
    face([pt(st,off+x,bottom+y) for x,y in [(-.65,.022),(.65,.022),(.65,.92),(-.65,.92)]],
         'Brake'+str(delta),[(0,0),(1,0),(1,1),(0,1)])

 # Grid and painted pit stalls.
 strip(0,.35,-7.5,7.5,'White',.05)
 for i in range(20):
  d=-8-i*8;off=3 if i%2 else -3;strip(d,d+.12,off-1.1,off+1.1,'White',.05);strip(d-4,d,off-1.1,off-1,'White',.05)
 def inpit(d):return d>data['pitEntry']-8 or d<data['pitExit']+15
 def edge(d):
  if night:return sample(d)['width']+2
  return barrier_distance(data,d)
 # The pit wall guards the track through the service zone. Outside its ends
 # the regular barrier follows the outer edge of the entry and exit tapers.
 wall_start=data['pitWallStart'];wall_end=data['pitExit']-90
 def barrier_offset(d,side):
  if side>0:return edge(d)
  return -max(edge(d),-sample(d)['pit']+4.6)
 for d in range(0,int(L),8):
  for side in [-1,1]:
   if side<0 and (d>=wall_start or d+8<=wall_end):continue
   off=barrier_offset(d,side);a=pt(d,off);b=pt(d+8,barrier_offset(d+8,side));yaw=math.atan2(b[0]-a[0],b[2]-a[2]);mid=tuple((a[i]+b[i])/2 for i in range(3));length=math.dist(a,b)
   # Cross-sections run between the actual endpoint frames so changing grade
   # and curvature remain continuous. Split joints cast a narrow contact shadow.
   def barrier_section(start, end, levels, material):
    for (h0,x0),(h1,x1) in zip(levels,levels[1:]):
     points=[pt(start,barrier_offset(start,side)-side*x0,h0),pt(end,barrier_offset(end,side)-side*x0,h0),
             pt(end,barrier_offset(end,side)-side*x1,h1),pt(start,barrier_offset(start,side)-side*x1,h1)]
     uv=[(start/4,h0),(end/4,h0),(end/4,h1),(start/4,h1)]
     face(points if side<0 else points[::-1],material,uv if side<0 else uv[::-1])
   if night:
    if 3600<d<4050:
     # Cast-in lifting sockets and low kick course on the roadside face.
     for st in (d+1.15,d+5.78):
      atbox(st,side*(edge(st)-.16),.78,(.065,.082,.23),'Dark')
     barrier_section(d+.04,d+7.96,[(.055,.351),(.175,.351),(.20,.339)],'Concrete')
    profile=[(.02,.34),(.19,.34),(.53,.17),(.98,.12),(1.05,.085),(1.05,-.12),(.03,-.30)]
    for start in [d,d+4]:
     barrier_section(start+.012,start+3.988,profile,'Concrete')
     for station in (start+.012,start+3.988):
      joint=[pt(station,barrier_offset(station,side)-side*x,h) for h,x in profile]
      if (station<start+2)==(side>0):joint.reverse()
      for j in range(1,len(joint)-1):face([joint[0],joint[j],joint[j+1]],'Concrete')
   else:
    for h in [.17,.48,.79]:
     levels=[(h+dy,x) for dy,x in [(0,.12),(.044,.20),(.09,.205),(.154,.12),(.218,.205),(.265,.20),(.31,.12)]]
     barrier_section(d,d+8,levels,'Armco')
    for station in [d,d+4]:atbox(station,barrier_offset(station,side)+side*.11,.54,(.12,1.08,.15),'Steel')
   rod(a,(a[0],a[1]+4,a[2]),.045,'Steel');rod((a[0],a[1]+4,a[2]),pt(d,off-side*.5,4.6),.035,'Steel');
   for hh in [1.7,2.6,3.4]:rod(pt(d,off,hh),pt(d+8,barrier_offset(d+8,side),hh),.009,'Steel',4)
   rod((a[0],a[1]+3.9,a[2]),(b[0],b[1]+3.9,b[2]),.026,'Steel')
   face([(a[0],a[1]+1,a[2]),(b[0],b[1]+1,b[2]),(b[0],b[1]+3.9,b[2]),(a[0],a[1]+3.9,a[2])],'Fence',[(0,0),(8,0),(8,3),(0,3)])
   # Boards occupy groups of concrete spans. Breaks expose the formed wall
   # and give the floodlights real joints and shoulder reflectors to pick up.
   sponsored=(d//8+(4 if side>0 else 0))%17<8 if night else d%40==0
   if sponsored:
    toward=-side*.35;aa=pt(d+.08,off+toward,.22);bb=pt(d+7.92,barrier_offset(d+7.92,side)+toward,.22);face([aa,bb,(bb[0],bb[1]+.75,bb[2]),(aa[0],aa[1]+.75,aa[2])],'Sign',[(1,0),(0,0),(0,1),(1,1)] if side>0 else None)
   elif night and d%24==0:
    street_hardware(d+1,off-side*.18,.78,(.06,.25,.15),'Dark')
    street_hardware(d+1,off-side*.218,.79,(.025,.15,.095),'Gold')
  if night and d%48==0 and not inpit(d):
   # Storm drains sit flush with the road in the gutter, inside the walls.
   side=-1 if d%96==0 else 1
   gutter=side*(edge(d)-.74)
   street_hardware(d,gutter,.030,(.48,.015,1.03),'Steel')
   street_hardware(d,gutter,.039,(.40,.006,.94),'Dark')
   for j in range(9):street_hardware(d-.40+j*.10,gutter,.045,(.39,.009,.028),'Steel')
 # Modular impact absorbers follow the outside of each braking zone.
 # The moulded shoulders and tie channels catch light under grazing angles.
 for corner in data['corners']:
  if corner['speed']>(40 if night else 68):continue
  d=corner['d']
  incoming=sample(d-16);outgoing=sample(d+16)
  bend=incoming['tx']*outgoing['tz']-incoming['tz']*outgoing['tx']
  side=-1 if bend>0 else 1
  if side<0 and inpit(d):continue
  start=d-12 if night else d-30
  for index in range(18 if night else 33):
   st=start+index*1.95;material='ImpactRed' if index//3%2==0 else 'ImpactIvory'
   # Raised ribs run across the face, with the dark belt below the shoulder.
   profile=[(0,.95),(.10,1.04),(.24,1.06),(.27,1.02),(.48,1.02),(.51,1.07),(.86,1.07),(.96,.98),(.96,.22)]
   for (h0,x0),(h1,x1) in zip(profile,profile[1:]):
    u=st+.015;v=st+1.935
    face([pt(u,side*(edge(u)-x0),h0),pt(v,side*(edge(v)-x0),h0),
          pt(v,side*(edge(v)-x1),h1),pt(u,side*(edge(u)-x1),h1)],material)
   if index in (0,(17 if night else 32)):
    e=st+(.015 if index==0 else 1.935)
    face([pt(e,side*(edge(e)-x),h) for x,h in [(.22,.03),(1.03,.03),(1.03,.93),(.22,.93)]],material)
  # Staff and equipment stay inside the protected post, behind the catch fence.
  st=d+8;off=side*(edge(st)+2.4)
  atbox(st,off,.12,(2.7,.24,4.6),'Concrete')
  for j in [-1.8,1.8]:
   for x in [-1.03,1.03]:rod(pt(st+j,off+x,.20),pt(st+j,off+x,2.98),.052,'Steel')
  atbox(st,off,2.98,(2.85,.13,4.65),'RoofSheet')
  atbox(st,off-side*1.38,2.86,(.07,.19,4.64),'RescueOrange')
  atbox(st,off+side,1.04,(.09,1.6,3.7),'Cabinet')
  atbox(st-1.25,off-side*.20,.78,(.45,1.08,.66),'ServiceRed')
  heading=sample(st);yaw=math.atan2(heading['tx'],heading['tz'])+side*math.pi/2
  atbox(st-2.50,off,3.05,(.11,1.46,.11),'Steel')
  atbox(st-2.50,off,3.76,(1.70,1.08,.16),'Dark')
  atbox(st-2.65,off,4.32,(1.81,.07,.46),'RoofSheet')
  face([pt(st-2.60,off+x,3.76+y) for x,y in [(.79,-.46),(.79,.46),(-.79,.46),(-.79,-.46)]],
       'MarshalLED',[(0,0),(0,1),(1,1),(1,0)])
  alternate=int(st)%3==0
  staff('marshal',pt(st-.54,off,.24),yaw,alternate=alternate)
  prop('SafetyBoard',pt(st+.78,off+.28*side,.24),yaw+.36)
  staff('observer',pt(st+.78,off+.28*side,.24),yaw+.36,(.55,.12,.015),alternate=not alternate)
 for j in range(14):
  corner=data['corners'][j%len(data['corners'])];st=corner['d']+18+(j//len(data['corners']))*65
  off=edge(st)+4.3;heading=sample(st);yaw=math.atan2(heading['tx'],heading['tz'])+math.pi/2
  prop('Photographer',pt(st,off,.03),yaw)
  if not night and j<7:
   st+=45;off=edge(st)+3.2
   atbox(st,off,.12,(2.1,.24,3.4),'Concrete')
   atbox(st,off+1.1,1.42,(.12,2.4,3.4),'Cabinet')
   atbox(st,off,2.72,(2.3,.12,3.6),'RoofSheet')
   staff('marshal',pt(st,off,.24),yaw,alternate=bool(j%2))
 # Finish official stands behind the pit wall, level with the timing line.
 atbox(-2,-14.4,.62,(1.6,1.24,2.2),'Concrete')
 v=sample(-2);staff('finish',pt(-2,-14.4,1.24),math.atan2(v['tx'],v['tz'])-math.pi/2)
 strip(L-405,L+45,-26,-8,'Asphalt',.026)
 # Separate protected pit wall, keeping entry/exit gaps open.
 wall_start=data['pitWallStart']
 wall_length=L+wall_end-wall_start
 spans=math.ceil(wall_length/4)
 for i in range(spans):
  a=wall_start+wall_length*i/spans;b=wall_start+wall_length*(i+1)/spans
  for l,h,r,j in [(-12.23,0,-12.23,1.3),(-12.23,1.3,-11.77,1.3),(-11.77,1.3,-11.77,0)]:
   uv=[(a/3,1),(b/3,1),(b/3,0),(a/3,0)]
   if not night and h!=j:
    # Reserve one UV tile for each four-metre mould in the existing concrete batch.
    uv=[(-8,-8+j/1.3),(-7,-8+j/1.3),(-7,-8+h/1.3),(-8,-8+h/1.3)]
   face([pt(a,r,j),pt(b,r,j),pt(b,l,h),pt(a,l,h)],'Concrete',uv)
 # Delineate the splitter on the neutral strip between the two traffic lanes.
 for i in range(4):
  d=wall_start-21+i*4
  strip(d,d+.30,-12.72,-11.28,'White',.052)
 atbox(wall_start+.75,-12,.50,(.68,1.00,1.50),'RescueOrange')
 uniforms={}
 for stall in data['pitBoxes']:
  value=stall['colour'].lstrip('#')
  srgb=[int(value[k:k+2],16)/255 for k in (0,2,4)]
  linear=tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in srgb)
  uniforms[stall['bay']]=linear
 mats['GarageUniform']=mats['PitCrewUniform'].copy();mats['GarageUniform'].name='GarageUniform'
 def lounge(d,front,h):
  # Place seating, cafe tables and continuous lighting behind the glazing.
  atbox(d,front-3.7,h+1.16,(.16,2.32,27.7),'LoungeWall')
  atbox(d,front-1.8,h,(3.7,.12,27.7),'RoofSheet')
  atbox(d,front-1.5,h+2.13,(.16,.09,26.8),'LoungeLight')
  for j in [-8,0,8]:atbox(d+j,front-3.57,h+1.34,(.11,.14,.62),'LoungeLight')
  for j in (-10,-3,4,11):
   atbox(d+j,front-2.9,h+.43,(.7,.43,2.45),'LoungeLeather')
   atbox(d+j,front-3.18,h+.83,(.17,.52,2.45),'LoungeLeather')
   atbox(d+j,front-1.95,h+.50,(.65,.085,1.20),'White')
   atbox(d+j,front-1.95,h+.25,(.14,.50,.14),'Steel')
 # Recessed garages, mullions, balcony rail, fascia and roof overhang.
 for i in range(14):
  d=L-380+i*28;heightB=11 if night else 7.5
  atbox(d,-38.5,2.15,(9,4.3,27.8),'Concrete')
  atbox(d,-36,(heightB+4.3)/2,(14,heightB-4.3,27.8),'Concrete')
  atbox(d,-30.0,.052,(10,.10,27.8),'GarageFloor')
  atbox(d,-34,heightB+.2,(20,.35,28),'White')
  atbox(d,-36,heightB+.9,(3.6,1.2,5),'Steel')
  if i%3==0:
   atbox(d+11,-42,heightB*.45,(5,heightB*.9,4),'Glass')
   for step in range(14):atbox(d+11,-41-step*.2,.3+step*.43,(4,.18,.6),'Steel')
  if i in uniforms:
   accent='BayAccent'+str(i);yaw=math.atan2(sample(d)['tx'],sample(d)['tz'])
   prop('SpareNoseRack',pt(d-5.4,-28.4,.106),yaw)
   prop('TyreBlanketRack',pt(d+3,-28.6,.106),yaw)
   atbox(d,-33.68,2.92,(.04,.19,27.5),accent)
   for seam in (-9,-4.5,0,4.5,9):
    strip(d+seam-.012,d+seam+.012,-34.8,-25.2,'TarSeam',.105)
   # Cantilevered triangulated boom. Both lower rails and the upper chord
   # terminate over the stopped car without a column in the working rectangle.
   for dz in (-.24,.24):
    rod(pt(d+dz,-26.8,.12),pt(d+dz,-26.8,3.52),.065,'GantryCarbon',8)
    rod(pt(d+dz,-26.8,3.12),pt(d+dz,-20.9,3.12),.055,'GantryCarbon',8)
   rod(pt(d,-26.8,3.6),pt(d,-20.9,3.55),.06,'GantryCarbon',8)
   for k in range(8):
    off=-26.8+k*.74
    for dz in (-.24,.24):
     rod(pt(d+dz,off,3.12),pt(d,off+.37,3.57),.028,'GantryCarbon',6)
     rod(pt(d,off+.37,3.57),pt(d+dz,off+.74,3.12),.028,'GantryCarbon',6)
   atbox(d,-23.5,3.08,(4.8,.07,.15),'Ice')
   # The outboard LED housing makes an empty service position legible down the lane.
   atbox(d,-20.93,3.30,(.19,.36,1.49),'GantryCarbon')
   atbox(d,-20.81,3.44,(.06,.044,1.41),'Ice')
   for dz in (1.55,-2.05):
    rod(pt(d,-23,3.19),pt(d+dz,-23,3.03),.035,'GantryCarbon')
    for side in (-1,1):
     outlet=-23-side*.90
     rod(pt(d+dz,-23,3.03),pt(d+dz,outlet,3.03),.027,'GantryCarbon')
     rod(pt(d+dz,outlet,3.05),pt(d+dz,outlet,2.97),.036,'Steel',10)
   atbox(d,-20.94,3.05,(.16,.20,.22),'GantryCarbon')
   atbox(d,-20.94,2.9,(.12,.55,1.40),'GantryCarbon')
  # Raised timing islands between the apron and the racing surface.
  if i in uniforms:
   atbox(d,-13.02,.58,(1.76,1.08,7.6),'Concrete')
   atbox(d,-13.57,1.62,(.72,.12,7.15),'Cabinet')
   for monitor,jj in enumerate([-2.7,-.9,.9,2.7]):
    station=d+jj
    atbox(station,-12.87,1.36,(.52,.12,.50),'Cabinet')
    atbox(station,-12.64,1.49,(.08,.24,.46),'Dark')
    v=sample(station);yaw=math.atan2(v['tx'],v['tz'])+math.pi/2
    spectator(pt(station,-12.89,1.40),1.05,yaw,'PitWallEngineer',(i+monitor)%4,uniforms[i])
    atbox(station,-13.65,1.94,(.11,.50,1.26),'Dark')
    monitor_face(station,-13.58,1.94,1.18,.43,monitor)
   for j in [-3.32,3.32]:
    rod(pt(d+j,-13.79,1.15),pt(d+j,-13.79,3.03),.049,'Steel')
    rod(pt(d+j,-13.79,3.0),pt(d+j,-12.13,2.89),.046,'Steel')
   atbox(d,-13.15,3.05,(1.9,.11,7.63),accent)
   atbox(d,-13.35,2.98,(.09,.034,7.0),'LoungeLight')
   # The fine guard mesh continues between timing stands on the concrete wall.
   for segment in range(4):
    a=d-14+segment*7;b=a+7
    face([pt(a,-11.8,1.31),pt(b,-11.8,1.31),pt(b,-11.8,2.38),pt(a,-11.8,2.38)],'Fence',[(0,0),(10,0),(10,1.6),(0,1.6)])
    rod(pt(a,-11.8,1.30),pt(a,-11.8,2.39),.027,'Steel')
  for j in [-9,0,9]:
   uv=[(0,0),(1,0),(1,1),(0,1)] if (i+j)%2 else [(1,0),(0,0),(0,1),(1,1)]
   face([pt(d+j-4.02,-33.82,.16),pt(d+j+4.02,-33.82,.16),pt(d+j+4.02,-33.82,3.99),pt(d+j-4.02,-33.82,3.99)],'WorkshopBack',uv)
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
    monitor_face(d+j+2.6,-26.032,1.58,.74,.42,(i+j)%4)
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
  heading=sample(d);yaw=math.atan2(heading['tx'],heading['tz'])-math.pi/2
  kit,uniform=((1,1,1),'GarageUniform') if i in uniforms else ((.031,.09,.14),'PitCrewUniform')
  staff('crew',pt(d,-31.4,.104),yaw+.24,kit,uniform)
  staff('crew',pt(d+1.25,-31.9,.104),yaw-.59,kit,uniform,alternate=True)
  lounge(d,-24.9,4.72)
  atbox(d,-24.9,5.8,(.1,2.1,27),'Hospitality')
  for j in range(-13,14,3):atbox(d+j,-24.75,5.8,(.17,2.2,.1),'Steel')
  for j in [-11,-4,3,10]:
   rod(pt(d+j,-24.8,5.1),pt(d+j,-22.95,6.94),.07,'Steel')
   atbox(d+j,-23.9,6.98,(2.18,.18,.11),'Steel')
  atbox(d,-23.9,7.25,(2.1,.15,28),'White')
  if not night:
   for offset in [-7,7]:
    a=d+offset-6.95;b=d+offset+6.95
    face([pt(a,-22.78,6.89),pt(b,-22.78,6.89),pt(b,-22.78,7.36),pt(a,-22.78,7.36)],'PaddockBanner',[(0,0),(1,0),(1,1),(0,1)])
  for j in range(-13,14,4):atbox(d+j,-22.9,7.8,(.06,1.1,.06),'Steel')
  atbox(d,-22.9,8.35,(.06,.06,28),'Steel')
  if not night:
   # Two occupied lounge levels over the working garage, with continuous
   # cantilevered terraces and vertical stair cores at the module joints.
   for deck in range(2):
    h=7.7+deck*3.35
    lounge(d,-26.8,h+.15)
    atbox(d,-24.18,h+.10,(.09,.045,27.8),'LoungeLight')
    atbox(d,-26.8,h+1.47,(.10,2.94,27.95),'Hospitality')
    atbox(d,-26.23,h,(4.0,.26,27.95),'Concrete')
    atbox(d,-24.22,h+.72,(.08,1.0,27.85),'Balustrade')
    for station in range(-12,14,4):
     atbox(d+station,-26.65,h+1.53,(.22,3.12,.16),'White')
     atbox(d+station,-24.18,h+.68,(.085,1.16,.085),'Steel')
    atbox(d,-24.20,h+1.30,(.073,.075,27.96),'Steel')
    for jj in range(-11,13,3):
     if (i+jj)%4: spectator(pt(d+jj,-25.47,h+.05),1.0,math.atan2(sample(d)['tx'],sample(d)['tz'])-math.pi/2,'Spectator'+str((i+jj)%4),(i+jj)%3)
   atbox(d,-32.7,14.52,(17.2,.30,28),'White')
   atbox(d,-24.2,14.48,(.16,.49,28),'RoofSheet')
   if i%4==2:
    atbox(d+9,-34,8.0,(10.2,15.9,4.5),'Concrete')
    for yy in [4.0,7.5,11.0,14.5]:atbox(d+9,-28.78,yy,(.08,.70,3.15),'Glass')
  if night:atbox(d,-24.6,10.7,(.15,.12,27),'Pink')
 for stall in data['pitBoxes']:
  d=stall['distance'];off=stall['offset']
  strip(d-3.5,d+3.5,off-1.89,off+1.89,'GantryCarbon',.047)
  strip(d-3.5,d+3.5,off-1.89,off-1.77,'BayAccent'+str(stall['bay']),.052)
  strip(d+1.46,d+1.62,off-1.55,off+1.55,'PitTarget',.057)
  for j in range(-12,14,2):
   face([pt(d+j+a,-20+b,.054) for a,b in [(0,0),(.13,0),(1.13,.69),(1,.69)]],'White',top=True)
  for side in (-1,1):
   stripe=off+side*1.16
   strip(d-3,d+3,stripe-.055,stripe+.055,'White',.052)
   strip(d+1.49,d+1.61,stripe-.28,stripe+.28,'White',.054)
  for sign in (-1,1):
   a=d+4*sign;b=d+6*sign
   strip(min(a,b),max(a,b),lambda q:off+1.16+(q-a)*sign*.65,lambda q:off+1.28+(q-a)*sign*.65,'White',.052)
 for st in [data['pitEntry']+29,data['pitExit']-30]:
  off=sample(st)['pit']
  strip(st-.11,st+.11,off-1.6,off+1.6,'White',.056)
  # Outside the drive corridor, the cantilevered speed board spans the lane at 4.4 m.
  post=min(off-3,-edge(st)-2)
  atbox(st,post,2.4,(.11,4.8,.11),'Steel')
  rod(pt(st,post,4.78),pt(st,off,4.78),.044,'Steel')
  face([pt(st,off+x,4.43+y) for x,y in [(-.50,-.34),(-.50,.34),(.50,.34),(.50,-.34)]],'Brake80',[(0,0),(0,1),(1,1),(1,0)])
  face([pt(st+a,off+b,.059) for a,b in [(0,-.75),(0,.75),(1.12,.75),(1.12,-.75)]],'Brake80',[(0,0),(1,0),(1,1),(0,1)],top=True)
  if st<data['length']/2:
   atbox(st,post,2.80,(.44,1.04,.26),'Dark')
   for j,lens in enumerate(['Blue','Go','Stop']):
    rod(pt(st-.14,post,2.47+.32*j),pt(st-.17,post,2.47+.32*j),.126,'PitExit'+lens,14)
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
  for colour in ('Green','White','Red'):
   name='ItalianFlag'+colour;mats[name]=mats[colour].copy();mats[name].name=name
  for flag in range(19):
   d=L-282+flag*13.4;off=49.1
   rod(pt(d,off,8.7),pt(d,off,16.3),.061,'Steel')
   for seg in range(12):
    def flagpoint(k,v):
     t=k/12;return pt(d+3.65*t,off+.53*math.sin(t*8+flag*.9)*t,16.15-1.92*v-.35*t+.31*math.sin(t*7+flag)*t)
    face([flagpoint(seg,0),flagpoint(seg+1,0),flagpoint(seg+1,1),flagpoint(seg,1)],['ItalianFlagGreen','ItalianFlagWhite','ItalianFlagRed'][seg//4])
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
     heading=yaw+math.pi/2+random.uniform(-.34,.34);variant=random.randrange(3)
     # Per-row shuffle leaves neighbouring seats distinct without a tiled pose sequence.
     if j==-14 or 'row_key' not in locals() or row_key!=(station,block,row):
      row_key=(station,block,row);previous=[];rng=random.Random(round(station)*113+block*427+row*59)
     pool=[p for p in range(12) if p not in previous and (p not in (6,7,10) or rng.random()<.26)]
     pose=rng.choice(pool);previous=(previous+[pose])[-4:]
     spectator(person,h,heading,cloth,pose)
     if (j*7+row*13+block)%20==0:prop('GrandstandFlag',person,heading,h)
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
 if not night:
  for j,d in enumerate([780,1430,4020,L-980]):
   for side in [-1,1]:
    off=side*(edge(d)+2)
    rod(pt(d,off),pt(d,off,7.7),.22,'Steel',8)
   for h in [6.5,7.7]:rod(pt(d,-edge(d)-2,h),pt(d,edge(d)+2,h),.11,'Steel',8)
   for off in range(-int(edge(d)),int(edge(d)),2):rod(pt(d,off,6.5),pt(d,off+2,7.7),.074,'Steel')
   for direction in (-1,1):
    station=d+direction*.20;left=direction*edge(d)
    face([pt(station,left,6.35),pt(station,-left,6.35),pt(station,-left,7.78),pt(station,left,7.78)],'Sponsor'+str(j))
  for station in [1010,4180,L-840]:
   off=edge(station)+12
   for row in range(5):
    atbox(station,off+row*.8,.8+row*.48,(.84,.28,28),'Concrete')
    for seat in range(-13,14,2):
     bearing=sample(station+seat)
     spectator(pt(station+seat,off+row*.8,.94+row*.48),1.,math.atan2(bearing['tx'],bearing['tz'])+math.pi/2,'Spectator0',row%3)
   atbox(station,off+2.0,1.32,(4.1,2.55,28),'Dark')
   for j in range(-14,15,7):rod(pt(station+j,off+3.6),pt(station+j,off+3.6,4.5),.09,'Steel')
   atbox(station,off+3.6,4.48,(.08,.08,28),'Steel')
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
   rod(pt(-.43,off,y),pt(-.46,off,y),.149,'GridLens'+str(lamp),14)
   atbox(-.50,off,y+.16,(.34,.036,.24),'Dark')
 def outside(c):
  a,b=sample(c['d']-16),sample(c['d']+16)
  return -1 if a['tx']*b['tz']-a['tz']*b['tx']>0 else 1
 for c in ([] if night else data['corners']):
  side=outside(c);off=side*(edge(c['d']-30)+4.5)
  atbox(c['d']-30,off,1.2,(2,2.4,3),'White');atbox(c['d']-30,off,2.5,(2.4,.2,3.4),'Red');atbox(c['d']-30,off-side*1.1,1.7,(.03,.8,2),'Glass')
  for j in range(12):atbox(c['d']+30+j*1.3,side*(edge(c['d']+30+j*1.3)+2.5),.65,(1.1,1.3,1.2),'Red' if j%3 else 'White')
 if not night:
  # Layered, perforated oak/hornbeam branchlet fans and exposed branch structure.
  corridor=KDTree(len(samples))
  clearance=[edge(s['d']) for s in samples]
  for i,s in enumerate(samples):corridor.insert((s['x'],s['z'],0),i)
  corridor.balance();max_clearance=max(clearance)
  for i in range(5100):
   d=random.random()*L;off=random.choice([-1,1])*(edge(d)+4+random.random()**1.6*175);p=pt(d,off);x,y,z=p;y=(height(d)-.07 if abs(off)<38 else ground(x,z)-2);p=(x,y,z)
   if (d>L-460 or d<150) and abs(off)<90:continue
   if min((x-pt(v,side)[0])**2+(z-pt(v,side)[2])**2 for v in range(int(L)-420,int(L)+100,35) for side in [-38,40])<28**2:continue
   species=(int(d/170)+i%7)%4
   h=random.uniform(8,24)*(1.12 if species==2 else 1);crown=h*[.39,.33,.19,.40][species]
   if 490<d<1210:
    # Stagger copses along the braking approach. Open meadow between
    # foreground trees gives a moving observer sight through to the second row.
    side=1 if off>0 else -1
    clearing=max(0,math.sin(d/44+side*.8)+.38*math.sin(d/17))
    setback=clearing*34 if abs(off)<85 else 0
    x,_,z=pt(d,off+side*setback);y=height(d)-(.12 if abs(off)+setback<38 else 1.96);p=(x,y,z)
    scale=.81+.18*math.sin(d/61+side)+(.28 if abs(off)>88 else 0)
    h*=scale;crown*=scale*(.78 if i%4==1 else 1.09)
   # Test the final setback and the entire crown against every nearby track leg.
   envelope=crown*3.55+.073*h+1.5
   if any(dist<clearance[j]+envelope for _,j,dist in corridor.find_range((x,z,0),max_clearance+envelope)):continue
   lean=math.sin(i*5.7)*h*.073;rod(p,(x+lean,y+h*.71,z),random.uniform(.16,.30),'Trunk',6)
   # Oak, hornbeam, columnar poplar and spreading pine: distinct crown proportions.
   lobes=[4,3,3,4][species]
   for k in range(lobes):
    a=k*math.tau/lobes+i*2.39996;spread=crown*(.28 if species==2 else .65)
    cx=x+lean+math.cos(a)*spread;cz=z+math.sin(a)*spread
    cy=y+h*([.66,.72,.55,.78][species]+k*[.035,.04,.14,.025][species])
    rod((x,y+h*.38,z),(cx,cy,cz),.075,'Trunk')
    blob((cx,cy,cz),(crown*random.uniform(.65,1.12),h*[.24,.28,.28,.14][species],crown*random.uniform(.65,1.05)),'Canopy'+str(species),8,4,i+k)

  # Distant oak stands sit beyond the individual trees. Map continuous
  # canopy silhouettes along shallow arcs so the nearest layers retain parallax.
  for side in [-1,1]:
   for d in range(170,int(L)-485,20):
    offsets=[side*(108+12*math.sin(st/127)+8*math.sin(st/72)) for st in (d,d+20)]
    endpoints=[pt(st,off) for st,off in zip((d,d+20),offsets)]
    if any(min((x-q[0])**2+(z-q[1])**2 for q in coarse)<60**2 for x,_,z in endpoints):continue
    pts=[]
    for st,(x,_,z) in zip((d,d+20),endpoints):
     base=ground(x,z)-4;pts.append(((x,base,z),(x,base+(16+5*math.sin(st/51)+3*math.sin(st/23) if 440<st<1290 else 23+3*math.sin(st/83)),z)))
    face([pts[0][0],pts[1][0],pts[1][1],pts[0][1]],'ParkHorizon',[(d/74,0),((d+20)/74,0),((d+20)/74,1),(d/74,1)])
  # Mown verge, rough grass and the exposed floor of the first woodland row.
  mat('RoughMeadow',(.30,.245,.14),.98,tex='grass-color')
  mat('LeafLitter',(.18,.135,.083),1,tex='gravel')
  for side in [-1,1]:
   for j in range(20):
    station=550+j*31;near=edge(station)+1.8
    broad=2.4+2*math.sin(j*1.73+side)**2
    for offset,span,material in [(near,broad,'RoughMeadow'),(near+broad,5.,'LeafLitter')]:
     points=[pt(station+d,side*(offset+w),-.047) for d,w in
             [(0,.7),(9,0),(24,.4),(31,1.0),(24,span),(11,span+1.4),(3,span*.68)]]
     face(points,material,[(v[0]/7,v[2]/7) for v in points],top=True)
  # A second vegetation stratum breaks the bare-trunk horizon; no billboard foliage.
  # Reuse crown prototypes so shrubs and saplings stay in the existing instanced batches.
  for i in range(1800):
   d=random.random()*L;off=random.choice([-1,1])*random.uniform(39,105);x,y,z=pt(d,off);y=ground(x,z)-2
   if (d>L-470 or d<170) and abs(off)<92:continue
   h=random.uniform(2.4,8.5);species=i%4
   if 490<d<1210:
    x,_,z=pt(d,off+math.copysign(18*max(0,math.sin(d/44+math.copysign(.8,off))),off));h*=.56+.29*math.sin(d/53)**2
   envelope=h*1.85+4.0
   if any(dist<clearance[j]+envelope for _,j,dist in corridor.find_range((x,z,0),max_clearance+envelope)):continue
   for k in range(2):blob((x+k*1.8,y+h*.65,z+math.sin(i)*2),(h*.65,h*.7,h*.6),'Canopy'+str(species),8,4,i+k)
 else:
  for d in range(0,int(L),45):
   for side in [-1,1]:
    if side<0 and (d>L-422 or d<30):continue  # The pit building carries the apron lights.
    rod(pt(d,side*10.5),pt(d,side*10.5,13),.08,'Steel');rod(pt(d,side*10.5,12.8),pt(d,side*7.5,12.8),.06,'Steel');atbox(d,side*7.5,12.7,(2.6,.15,.7),'Ice')
  # Curbside date palms break up the lamp rhythm and give the boulevard a
  # street-level silhouette beneath the resort skyline.
  for d in range(2550,4300,26):
   for side in [-1,1]:
    off=side*(25+4*math.sin(d));x,g,z=pt(d,off);h=7.8+2.7*math.sin(d*1.37)
    tip=(x+.65,g+h,z+.38);rod((x,g,z),tip,.19,'Trunk',7)
    key=('PalmFrond',)
    if key not in prototypes:
     verts=[];polys=[]
     for j in range(8):
      angle=j*math.tau/8;reach=3.1+.55*math.sin(j)
      def blade(t,w):
       dx=reach*t*math.cos(angle)-w*math.sin(angle)
       dz=reach*t*math.sin(angle)+w*math.cos(angle)
       verts.append((dx,-dz,1.1*math.sin(t*math.pi)-1.05*t*t))
       return len(verts)-1
      for k in range(9):
       t=k/9;u=(k+1)/9
       polys.append((blade(t,-.036),blade(u,-.024),blade(u,.024),blade(t,.036)))
       for wing in (-1,1):
        width=.57*math.sin(math.pi*(t+.09))**.7
        polys.append((blade(t,0),blade(min(1,u+.13),width*wing),blade(u,.03*wing)))
     crown=bpy.data.meshes.new('Date palm crown');crown.from_pydata(verts,[],polys)
     crown.materials.append(mats['PalmFrond']);crown.update();prototypes[key]=crown
    crown=prototypes[key];palm=bpy.data.objects.new('Instance_PalmFrond',crown)
    bpy.context.collection.objects.link(palm);palm.parent=instanceRoot
    palm.location=(tip[0],-tip[2],tip[1]);palm.rotation_euler.z=-d
    instance_triangles+=sum(len(poly.vertices)-2 for poly in crown.polygons)
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
  # Street-level scale: parallel service lanes, stone pavements, safe
  # pedestrian crossings and lit resort porte-cocheres alongside the Strip.
  for offside in [-1,1]:
   for d0 in range(3150,4920,120):
    strip(d0,d0+118,offside*11.6,offside*19.4,'Concrete',.016,step=10)
    strip(d0,d0+118,offside*19.5,offside*29.2,'Asphalt',.018,step=10)
    for station in range(0,114,13):strip(d0+station,d0+station+4.6,offside*24.05,offside*24.19,'White',.035,step=6)
    for j in range(6):strip(d0+109+j*1.1,d0+109+j*1.1+.44,offside*19.72,offside*28.98,'White',.041,step=2)
    for j in [16,48,80]:
     atbox(d0+j,offside*15.4,.38,(1.5,.72,5.5),'Travertine')
     atbox(d0+j,offside*15.4,.83,(1.25,.29,5.15),'Green')
    if (d0//120+offside)%3==0:
     atbox(d0+51,offside*35.8,4.4,(10.6,.47,22),'CopperRoof')
     atbox(d0+51,offside*30.42,4.32,(.12,.17,22),'Gold')
     for j in [-8.6,8.6]:rod(pt(d0+51+j,offside*31.3),pt(d0+51+j,offside*31.3,4.22),.31,'Travertine',8)
  # A continuous pedestrian frontage frames the road under the resort towers.
  # Keep the lake's side open beside its surveyed shoreline.
  mat('Marquee',(.9,.85,.72),.52,tex='boulevard-marquees',emission=1.8)
  mat('StoreGlass',(.76,.72,.66),.38,.12,tex='hospitality-glass',emission=.92)
  def frontage_fits(d,side,inset,length):
   # The shop, projecting canopy and trim form one lot. Near a switchback
   # its far end can cross a different leg even when the centre is set back.
   cx,_,cz=pt(d,side*(inset+5))
   frame=sample(d)
   for q in samples:
    dx=q['x']-cx;dz=q['z']-cz
    along=abs(dx*frame['tx']+dz*frame['tz'])
    across=abs(dx*frame['tz']-dz*frame['tx'])
    gap=math.hypot(max(0,along-length*.5-1),max(0,across-12))
    if gap<q['width']+4: return False
   return True
  frontage=random.Random(947)
  for side in [-1,1]:
   for block in range(3040,5200,62):
    if side>0 and 4460<block<4860:continue
    d=block+frontage.uniform(-3,3);length=frontage.uniform(37,56);h=frontage.choice([6.6,8.5,10.6,13.2])
    inset=frontage.uniform(32,39);driveway=side*(inset-.12);roof=side*(inset+8)
    if not frontage_fits(d,side,inset,length):continue
    if 3500<d<4110:
     # Set back the glass between projecting stone piers. The narrow
     # reveals and opaque soffit hold their value behind the safety fence.
     atbox(d,side*(inset+10),h*.5,(12,h,length),'StoreGlass')
     for bay in [-.26,0,.26]:
      atbox(d+bay*length,side*(inset+2.8),1.87,(.22,2.83,.23*length),'RecessGlass')
      atbox(d+bay*length,side*(inset+2.51),.51,(.58,.20,.23*length),'CopperRoof')
      atbox(d+bay*length,side*(inset+2.61),2.68,(.32,.08,.23*length),'CopperRoof')
     for bay in [-.39,-.13,.13,.39]:
      atbox(d+bay*length,side*(inset+1.65),h*.5,(4.5,h,1.35),'Travertine')
     atbox(d,side*(inset+1.8),h-.5,(5.1,.92,length),'CopperRoof')
    else:atbox(d,roof,h*.5,(16,h,length),'StoreGlass')
    atbox(d,roof,h+.24,(18.2,.47,length+1.3),'CopperRoof')
    for offset in [-length*.44,0,length*.44]:
     atbox(d+offset,driveway,h*.5,(.7,h,1.3),'Travertine')
    atbox(d,side*(inset-2.3),3.62,(5.9,.37,length+1.4),'CopperRoof')
    atbox(d,side*(inset-5.26),3.68,(.16,.24,length+1.4),'Gold' if block%3 else 'Ice')
    row=(block//62+(side+1))%4
    a=d-length*.39;b=d+length*.39;off=side*(inset-.42)
    u=(row+1)/4;v=row/4
    points=[pt(a,off,h-2.4),pt(b,off,h-2.4),pt(b,off,h-.36),pt(a,off,h-.36)]
    face(points,'Marquee',[(0 if side<0 else 1,v),(1 if side<0 else 0,v),(1 if side<0 else 0,u),(0 if side<0 else 1,u)])
    for vent in [-.27,.29]:atbox(d+vent*length,roof,h+1.0,(3.8,1.25,4.3),'Cabinet')
  origin=data['origin'];lat0=origin[1]*math.pi/180
  def project(lon,lat):return ((lon-origin[0])*111320*math.cos(lat0),-(lat-origin[1])*111320)
  def hotel(lon,lat,w,h,dep,name):
   x,z=project(lon,lat)
   if name=='PALATIAL':
    # Place the entire 230 m podium inside the block between Sands and
    # the Strip, behind the shops on both approaches to Turn 12.
    x+=26;z+=138
   g=ground(x,z)
   if name=='AURORA':
    # Bellagio-like crescent massing west of its lake. Original fictional architecture.
    # Tall central bay, stepped wings, pilasters and warm floodlit limestone cornices.
    for bay in range(-10,11):
     zz=z+bay*14;xx=x+abs(bay)**1.6*1.4;hh=145-abs(bay)*3.2;yaw=-math.copysign(.16+abs(bay)*.018,bay) if bay else 0
     box((xx,g+hh/2,zz),(35,hh,14.7),'UpperStone',yaw,((bay+10)/21,1/21))
     box((xx+18,g+hh/2,zz),(1.5,hh,1.3),'Travertine',yaw)
     for yy in [9,17,hh-8,hh]:box((xx,g+yy,zz),(38,1.3,15.5),'Travertine',yaw)
     box((xx+19,g+hh-6,zz),(.5,1.4,14),'Gold',yaw)
    box((x+3,g+151,z),(45,12,26),'Travertine')
    box((x-5,g+160,z),(31,8,19),'CopperRoof')
    box((x-11,g+166,z),(13,6,12),'Travertine')
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
      box((xx,g+hh/2,zz),(13,hh,dep*.60),'UpperRibbon' if name=='PALATIAL' else 'UpperCurtain',wing*a,((bay+(0 if wing<0 else 9))/18,1/18))
      if name=='EDEN' and 2<=bay<=5:
       crown=(6-abs(bay-3)*1.4)
       box((xx,g+hh+crown/2,zz+2),(11.6,crown,dep*.48),'CopperRoof',wing*a)
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
   surface='UpperStone' if name in ['IMPERIAL','SERENISSIMA'] else 'UpperCurtain'
   # The two resort slabs seen beside the campanile have separate roof masses.
   # Recess the upper occupied floors; keep the boulevard podium line level.
   cut=.78 if name=='SERENISSIMA' else .86 if name=='LUMIERE' else 1
   box((x,g+h*cut/2,z),(w,h*cut,dep),surface)
   box((x,g+4,z),(w+24,8,dep+22),'Travertine')
   if cut<1:
    tiers=[(.15,.78,.74,-.06),(.07,.49,.51,-.15)] if name=='SERENISSIMA' else [(.14,.61,.70,.14)]
    y=cut*h
    for frac,span,depth,shift in tiers:
     box((x+shift*w,g+y+.7,z-2),(w*span+1.6,1.4,dep*depth+1.6),'CopperRoof')
     box((x+shift*w,g+y+frac*h/2,z-2),(w*span,frac*h,dep*depth),'UpperRibbon')
     y+=frac*h
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

   for y in [h*.1,h*cut*.85,h*cut]:box((x,g+y,z),(w+1,.45,dep+1),'Gold')
   for dx in range(-int(w/2),int(w/2),12):box((x+dx,g+h*cut/2,z+dep/2),(.7,h*cut,1),'Concrete')
   # Architectural wings give stepped, compound footprints rather than solitary boxes.
   if ROUND>=2:
    for side in [-1,1]:
     angle={'AURORA':.22,'IMPERIAL':-.25,'SERENISSIMA':0,'PALATIAL':.13,'EDEN':-.35,'LUMIERE':.32,'METROPOLIS':0}[name]*side
     box((x+side*w*.38,g+h*.39,z-dep*.55),(w*.23,h*.78,dep*1.5),'Windows',angle)
    roof_x=x+(tiers[-1][3]*w if cut<1 else 0)
    roof_z=z-2 if cut<1 else z
    span,depth=(tiers[-1][1],tiers[-1][2]) if cut<1 else (1,1)
    for tier in range(3):
     box((roof_x,g+h+1.5+tier*3,roof_z),(w*span*(.72-tier*.12),3,dep*depth*(.82-tier*.16)),'Concrete' if name in ['SERENISSIMA','IMPERIAL'] else 'Glass')
    if name in ['SERENISSIMA','IMPERIAL']:
     for dx in range(-int(w/2),int(w/2)+1,18):
      rod((x+dx,g+8,z+dep/2+4),(x+dx,g+25,z+dep/2+4),.7,'White',8)
    else:
     for yy in range(12,int(h*cut),8):box((x,g+yy,z+dep/2+.4),(w,.22,.4),'Gold' if name=='EDEN' else 'Steel')
  for args in [(-115.1766,36.1127,220,145,54,'AURORA'),(-115.1762,36.1175,150,125,60,'IMPERIAL'),(-115.1699,36.1212,160,145,70,'SERENISSIMA'),(-115.1688,36.1245,140,145,58,'PALATIAL'),(-115.1655,36.1271,150,185,55,'EDEN'),(-115.1706,36.1127,145,105,50,'LUMIERE'),(-115.1745,36.1086,80,180,54,'METROPOLIS')]:hotel(*args)
  for i in range(330):
   d=random.random()*L;p=pt(d,random.choice([-1,1])*random.uniform(90,530));h=random.uniform(14,115)
   sphereXZ=project(-115.1621,36.1207)
   lake=project(-115.1745,36.1121)
   if ((p[0]-lake[0])/180)**2+((p[2]-lake[1])/240)**2<1:continue
   if any(abs(p[0]-project(lon,lat)[0])<95 and abs(p[2]-project(lon,lat)[1])<95 for lon,lat in [(-115.172,36.1125),(-115.1766,36.1127)]):continue
   if math.hypot(p[0]-sphereXZ[0],p[2]-sphereXZ[1])<140:continue
   if min((p[0]-q[0])**2+(p[2]-q[1])**2 for q in coarse)<65**2:continue
   w=random.uniform(20,58);dep=random.uniform(22,60);angle=random.choice([0,.12,-.18,.3])
   if 3000<d<4490:
    # Podium, recessed mechanical floor and off-centre guest tower. Alternate
    # slab, split crown and terraced silhouettes at a scale visible down the strip.
    x,g,z=p;style=i%3
    podium=min(22,h*.29);band=2.8
    box((x,g+podium/2,z),(w+8,podium,dep+6),'StoreGlass',angle)
    box((x,g+podium+band/2,z),(w-3,band,dep-3),'Dark',angle)
    upper=h-podium-band
    if style==0:
     for shift,fraction in [(-.225,1),(.27,.73)]:
      box((x+w*shift,g+podium+band+upper*fraction/2,z),(w*.46,upper*fraction,dep),'UpperRibbon',angle)
    else:
     box((x,g+podium+band+upper*.5,z),(w,upper,dep),'UpperStone' if style==1 else 'UpperCurtain',angle)
     if style==1:
      for j in range(3):box((x+j*w*.055,g+h+3+j*5,z),(w*(.78-j*.18),6,dep*(.83-j*.17)),'Windows',angle)
     else:
      box((x+w*.28,g+h+4,z),(w*.25,8,dep*.85),'Steel',angle)
      # A separate glazed shoulder and a dark plant deck step away from the boulevard.
      box((x-w*.16,g+h+5,z),(w*.48,10,dep*.69),'UpperRibbon',angle)
      box((x-w*.19,g+h+12,z),(w*.34,4,dep*.56),'RecessGlass',angle)
   else:
    surface=('UpperCurtain','UpperStone','UpperRibbon')[i%3] if h>65 and 2550<d<5200 else ('WarmWindows' if i%4==0 else 'Windows')
    box((p[0],p[1]+h/2,p[2]),(w,h,dep),surface,angle)
   box((p[0],p[1]+3,p[2]),(w+12,6,dep+10),'Concrete',angle)
   for level in range(random.randint(1,3)):
    box((p[0],p[1]+h+level*4+2,p[2]),(w*(.8-level*.16),4,dep*(.8-level*.16)),'Glass',angle)
   accent=['Gold','Ice','Pink'][i%3]
   if i%3==0:box((p[0]+math.sin(angle)*(dep/2+.2),p[1]+h*.83,p[2]+math.cos(angle)*(dep/2+.2)),(w*.8,2,.4),accent,angle)
   if i%5==0:
    box((p[0]+math.cos(angle)*(w/2+.25),p[1]+h*.6,p[2]-math.sin(angle)*(w/2+.25)),(.5,h*.6,1),accent,angle)
    width=min(w*.70,64);panel_h=width/8
    sn,cs=math.sin(angle),math.cos(angle)
    cx=p[0]+sn*(dep/2+.30);cz=p[2]+cs*(dep/2+.30);cy=p[1]+h*.65
    box((cx,cy,cz),(width+.20,panel_h+.20,.46),'Dark',angle)
    face([(cx+dx*cs+.24*sn,cy+dy,cz-dx*sn+.24*cs)
          for dx,dy in [(-width/2,-panel_h/2),(width/2,-panel_h/2),(width/2,panel_h/2),(-width/2,panel_h/2)]],'Sign')
  # An internally lit Montgolfier-style boulevard marquee, including its
  # tapered lower skirt, gold meridians and a suspended basket.
  x,z=project(-115.17173,36.11211);g=ground(x,z)
  mat('CobaltGlass',(.028,.082,.54),.29,emission=1.22)
  mat('RubyGlass',(.68,.031,.055),.35,emission=.85)
  rows=[(18,3.8),(23,5.2),(28,7.2),(34,11.8),(40,14.0),(46,14.4),(52,12.8),(57,8.4),(60,3.3),(61,0.35)]
  def balloon(k,h,r):
   a=k*math.tau/48;return (x+r*math.cos(a),g+h,z+r*math.sin(a))
  for row in range(len(rows)-1):
   for k in range(48):
    h,r=rows[row];hh,rr=rows[row+1]
    material='RubyGlass' if (row in (0,7) or (k%12==0 and row in (2,3,4))) else 'CobaltGlass'
    face([balloon(k,h,r),balloon(k+1,h,r),balloon(k+1,hh,rr),balloon(k,hh,rr)],material,[(k/48,(h-18)/43),((k+1)/48,(h-18)/43),((k+1)/48,(hh-18)/43),(k/48,(hh-18)/43)])
    if k%4==0:rod(balloon(k,h,r+.09),balloon(k,hh,rr+.09),.13,'Gold',5)
    if row in (1,3,6):rod(balloon(k,h,r+.14),balloon(k+1,h,r+.14),.20,'Gold',5)
  box((x,g+13,z),(8.5,5.8,8.5),'Travertine')
  for side in [-1,1]:
   for dz in [-3.4,3.4]:rod((x+side*3.4,g+5,z+dz),(x+side*3.4,g+18,z+dz),.25,'Gold',6)
  box((x,g+.4,z),(10.6,7.0,10.6),'Travertine')
  box((x,g+5.3,z),(12.3,2.8,12.3),'RubyGlass')
  x,z=project(-115.1745,36.1121);g=ground(x,z)
  # Tiered stone promenade at the water line, with a continuous illuminated coping.
  for i in range(96):
   a=i*math.tau/96;b=(i+1)*math.tau/96
   def shore(angle,rise,h):return (x+(95+rise)*math.cos(angle),g+h,z+(135+rise)*math.sin(angle))
   for inner,outer,h0,h1,material in [(0,1.55,.11,.7,'Travertine'),(1.55,2.1,.71,.71,'Gold'),(2.1,8.5,.7,.75,'Concrete'),(8.5,9,.75,.94,'Travertine')]:
    face([shore(a,inner,h0),shore(b,inner,h0),shore(b,outer,h1),shore(a,outer,h1)],material)
  for i in range(80):
   a=i*math.tau/80;b=(i+1)*math.tau/80;face([(x,g+.1,z),(x+95*math.cos(a),g+.1,z+135*math.sin(a)),(x+95*math.cos(b),g+.1,z+135*math.sin(b))],'Water',top=True)
  # Lit rings and parabolic fountain jets, tapered into the water rather than gold poles.
  for ring,rad in enumerate([35,65]):
   for i in range(64):
    a=i*math.tau/64;h=5+math.sin(a*3+ring)**2*14
    points=[]
    for j in range(7):
     t=j/6;r=rad+14*t;points.append((x+r*math.cos(a),g+.3+h*4*t*(1-t),z+r*1.4*math.sin(a)))
    for j in range(6):rod(points[j],points[j+1],.33*(1-j*.09),'Fountain',5)
    b=(i+1)*math.tau/64;rod((x+rad*math.cos(a),g+.2,z+rad*1.4*math.sin(a)),(x+rad*math.cos(b),g+.2,z+rad*1.4*math.sin(b)),.23,'Fountain',5)
  x,z=project(-115.172,36.1125);g=ground(x,z)
  for level in range(10):
   y=g+level*12;a=25*(1-level/11)**1.6;b=25*(1-(level+1)/11)**1.6
   for sx in [-1,1]:
    for sz in [-1,1]:rod((x+sx*a,y,z+sz*a),(x+sx*b,y+12,z+sz*b),.4,'Gold');rod((x+sx*a,y,z+sz*a),(x-sx*b,y+12,z+sz*b),.1,'Gold')
   if level in [3,6]:box((x,y,z),(a*2+3,1,a*2+3),'Gold')
  # Wrought lattice and four base arches, visible in the broadcast silhouette.
  for k in range(30):
   y0=k*4;y1=y0+4;w0=25*(1-y0/132)**1.6;w1=25*(1-y1/132)**1.6
   for side in [-1,1]:
    for axes in [0,1]:
     def tp(v,w,y):return (x+v if axes==0 else x+side*w,g+y,z+side*w if axes==0 else z+v)
     rod(tp(-w0,w0,y0),tp(w0,w0,y0),.16 if k<14 else .12,'Gold',5)
     for edge in [-1,1]:
      rod(tp(edge*w0,w0,y0),tp(edge*w1*.68,w1,y1),.16,'Travertine',5)
      rod(tp(edge*w0*.68,w0,y0),tp(edge*w1,w1,y1),.12,'Gold',5)
  for side in [-1,1]:
   for axes in [0,1]:
    def archpoint(t,r):
     v=r*math.cos(t);yy=3+r*.77*math.sin(t);w=24-yy*.25
     return (x+v if axes==0 else x+side*w,g+yy,z+side*w if axes==0 else z+v)
    for j in range(20):
     a=j*math.pi/20;b=(j+1)*math.pi/20
     for radius in [19,20.8]:rod(archpoint(a,radius),archpoint(b,radius),.22,'Gold',7)
     rod(archpoint(a,19),archpoint(b,20.8),.13,'Travertine',5)
  rod((x,g+120,z),(x,g+165,z),.3,'Gold')
  x,z=project(-115.1681,36.1176);g=ground(x,z)
  mat('RollerRim',(.49,.63,.84),.28,.46,emission=1.1)
  mat('RollerSpoke',(.33,.37,.41),.43,.6)
  mat('RollerCabin',(.10,.23,.29),.23,.58,emission=.25)
  roller_center=(x,g+84,z)
  for i in range(100):
   a=i*math.tau/100;b=(i+1)*math.tau/100;rod((x+70*math.cos(a),g+84+70*math.sin(a),z),(x+70*math.cos(b),g+84+70*math.sin(b),z),.3,'RollerRim')
   if i%4==0:rod((x,g+84,z),(x+70*math.cos(a),g+84+70*math.sin(a),z),.07,'RollerSpoke');box((x+70*math.cos(a),g+84+70*math.sin(a),z),(3,3,4),'RollerCabin')
  for dx in [-28,28]:rod((x+dx,g-3,z),(x,g+84,z),1,'Steel')
  x,z=project(-115.1621,36.1207);g=ground(x,z);radius=78.6384;cy=32.9184;thetaMax=math.acos(-cy/radius)
  for i in range(48):
   a=i*math.tau/48;b=(i+1)*math.tau/48
   rod((x+69*math.cos(a),g+.1,z+69*math.sin(a)),(x+73.7*math.cos(b),g+9,z+73.7*math.sin(b)),.31,'Steel',8)
   rod((x+73.7*math.cos(a),g+9,z+73.7*math.sin(a)),(x+73.7*math.cos(b),g+9,z+73.7*math.sin(b)),.32,'Steel',8)
  for j in range(48):
   for i in range(96):
    pts=[];uv=[]
    for ii,jj in [(i,j),(i+1,j),(i+1,j+1),(i,j+1)]:
     a=ii*math.tau/96;t=jj*thetaMax/48;pts.append((x+radius*math.sin(t)*math.cos(a),g+cy+radius*math.cos(t),z+radius*math.sin(t)*math.sin(a)));uv.append((ii/96,1-jj/48))
    face(pts,'Sphere',uv,special='Sphere')
  base=math.sqrt(radius*radius-cy*cy)
  for i in range(96):
   a=i*math.tau/96;b=(i+1)*math.tau/96
   face([(x+base*math.cos(t),g+h,z+base*math.sin(t)) for t,h in [(a,-3.5),(a,0),(b,0),(b,-3.5)]],'RoofSheet')
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
  tile_size=1200
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
     rod((lx,h-.5,z+103),(lx,h+5.3,z+103),.14,'Steel',6)
     box((lx,h+5.3,z+103),(1.6,.32,1.2),'StreetLamp')
  tile_size=520
  tile_prefix=''
 # Round-specific finishing based on screenshot reviews.
 if ROUND>=2:
  for c in data['corners']:
   for k in range(6):strip(c['d']-60+k*1.1,c['d']-15+k*.3,lambda q:sample(q)['line']-1.1+k*.45,lambda q:sample(q)['line']-.98+k*.45,'Rubber',.047,step=3)
 if ROUND>=3:
  # Pit lane details: painted service boxes, garage lighting, timing tower.
  for stall in data['pitBoxes']:
   d=stall['distance'];atbox(d,-25,4.3,(.18,.12,8),'Ice' if night else 'White')
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
    x,y,z=pt(c['d']+22+k*.75,outside(c)*(edge(c['d']+22+k*.75)+3.7))
    for row in range(3):
     for i in range(10):
      a=i*math.tau/10;b=(i+1)*math.tau/10
      face([(x+.34*math.cos(a),y+row*.28,z+.34*math.sin(a)),(x+.34*math.cos(b),y+row*.28,z+.34*math.sin(b)),(x+.34*math.cos(b),y+row*.28+.26,z+.34*math.sin(b)),(x+.34*math.cos(a),y+row*.28+.26,z+.34*math.sin(a))],'Dark')
 # Preserve the near silhouettes in the stands. At track-crossing distances a
 # seated and standing reduction share the same authored UVs and materials.
 for label,pose in [('Seated',0),('Standing',6)]:
  mesh=spectator_mesh(mats['Spectator0'],pose,distant=True)
  obj=bpy.data.objects.new('LOD_Grandstand'+label,mesh)
  bpy.context.collection.objects.link(obj)
 # Garage staff and track officials keep their uniforms and flag at distance.
 # The close meshes retain their complete equipment and faces.
 for material in ['PitCrewUniform','MarshalUniform','FinishUniform','GarageUniform']:
  mesh=next(mesh for key,mesh in prototypes.items() if key[0] in ('crew','marshal','finish') and mesh.materials[0].name==material)
  obj=bpy.data.objects.new('LOD_Staff'+material,mesh.copy());bpy.context.collection.objects.link(obj)
  bpy.context.view_layer.objects.active=obj
  mod=obj.modifiers.new('Distant staff silhouette','DECIMATE');mod.ratio=min(1,330/max(1,sum(len(f.vertices)-2 for f in obj.data.polygons)))
  bpy.ops.object.modifier_apply(modifier=mod.name)
 # Authored distant crown LODs; runtime uses these meshes, never generated substitutes.
 if not night:
  for i in range(4):
   name='Canopy'+str(i)
   for prefix,fans in [('LOD_',16),('LOD_Distant',6)]:
    obj=bpy.data.objects.new(prefix+name,leaf_sprays(name,fans,i))
    bpy.context.collection.objects.link(obj)
 if not night:
  from canopy_light import bake_canopy_light
  bpy.context.view_layer.update()
  check_monza(data)
  bake_canopy_light(OUT,samples,height)
 # Export per-material spatial chunks; GLB geometries, including all terrain, are Blender-authored.
 triangles=instance_triangles
 for (tile,m),(verts,faces,uvs) in batches.items():
  mesh=bpy.data.meshes.new(f'{tile}_{m}');mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new(name='UVMap')
  if m=='BayAccent':
   colour=mesh.color_attributes.new(name='Team paint',type='BYTE_COLOR',domain='POINT')
   for index,c in enumerate(accent_colors[(tile,m)]):colour.data[index].color=c
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
 bpy.ops.export_scene.gltf(filepath=str(OUT/f'{cid}.glb'),export_format='GLB',export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_gpu_instances=True,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_draco_position_quantization=18,export_draco_texcoord_quantization=16,export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
 # Identical Blender geometry, gzip encoded for MCP hosts that prohibit workers/WASM.
 raw=Path('/tmp')/f'jgp-{cid}-mcp.glb'
 bpy.ops.export_scene.gltf(filepath=str(raw),export_format='GLB',export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_gpu_instances=True,export_draco_mesh_compression_enable=False,export_yup=True,export_cameras=False,export_lights=False)
 pack(raw,OUT/f'{cid}-mcp.glb.gz',positions=True);raw.unlink()
 (OUT/f'{cid}.glb.gz').write_bytes(gzip.compress((OUT/f'{cid}.glb').read_bytes(),compresslevel=9,mtime=0))
 profile={'length':L,'step':L/nr,'heights':heights,'source':'OpenTopoData Mapzen; median + Gaussian terrain smoothing; not survey grade','triangles':triangles,'chunks':len(batches),'sharedPrototypes':len(prototypes),'solidInstances':sum(1 for o in bpy.context.scene.objects if o.name.startswith('Instance_')),'round':ROUND,'blender':bpy.app.version_string}
 if night:profile['rollerCenter']=roller_center
 (OUT/f'{cid}-manifest.json').write_text(json.dumps(profile,indent=2)+'\n');print('CIRCUIT',cid,triangles,'triangles',len(batches),'chunks',flush=True)
circuits=sys.argv[sys.argv.index('--')+2:] if '--' in sys.argv else []
for cid in circuits or ['monza','las-vegas']:
 if cid not in ('monza','las-vegas'):raise ValueError('Unknown circuit '+cid)
 build(cid)
