"""Articulation library for the service crews. Positive Y up and Z forward in game space.
Each limb's first joint is at its origin and its bind axis points up local Y.
"""
import bpy,math,sys
from mathutils import Vector
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from track_people import staff_material
from pack_glb import pack
root=Path(__file__).resolve().parents[2];out=root/'src/race/assets'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
mat=bpy.data.materials.new('Crew kit');mat.use_nodes=True
staff_material(mat,bpy.data.images.load(str(root/'scripts/blender/textures/crew-atlas.jpg')))
white=(.85,.85,.82);dark=(.024,.034,.049);metal=(.41,.44,.46);red=(.68,.037,.019)
parts=[]
def vertex(p,col,uv=(.96,.327)):
    x,y,z=p;verts.append((x,-z,y));cols.append((*col,1));uvs.append(uv);return len(verts)-1
def rings(rows,col,n=24,cloth=False):
    prev=None
    for j,(x,y,z,rx,rz) in enumerate(rows):
        ring=[vertex((x+rx*math.cos(-i*math.tau/n),y,z+rz*math.sin(-i*math.tau/n)),col,((.613+.352*i/n,1-(533+209*j/max(1,len(rows)-1))/768) if cloth else (.96,.327))) for i in range(n)]
        if prev:
            for i in range(n):faces.append((prev[i],prev[(i+1)%n],ring[(i+1)%n],ring[i]))
        else:faces.append(tuple(reversed(ring)))
        prev=ring
    faces.append(tuple(prev))
def rod(a,b,r,col,r2=None,n=12):
    a,b=Vector(a),Vector(b);v=(b-a).normalized();u=v.cross(Vector((1,0,0)))
    if u.length<.01:u=v.cross(Vector((0,1,0)))
    u.normalize();w=v.cross(u);rr=[]
    for p,rad in [(a,r),(b,r if r2 is None else r2)]:
        rr.append([vertex(p+rad*(u*math.cos(i*math.tau/n)+w*math.sin(i*math.tau/n)),col) for i in range(n)])
    for i in range(n):faces.append((rr[0][i],rr[0][(i+1)%n],rr[1][(i+1)%n],rr[1][i]))
    faces.extend([tuple(reversed(rr[0])),tuple(rr[1])])
def tyre_ring(profile,col,n=64):
    rr=[[vertex((x,r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n)),col) for i in range(n)] for x,r in profile]
    for a,b in zip(rr,rr[1:]):
        for i in range(n):faces.append((a[i],a[(i+1)%n],b[(i+1)%n],b[i]))
def make(name):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(mat);mesh.update()
    color=mesh.color_attributes.new(name='Uniform and equipment',type='BYTE_COLOR',domain='POINT')
    for i,c in enumerate(cols):color.data[i].color=c
    art=mesh.uv_layers.new(name='Artwork')
    for p in mesh.polygons:
        p.use_smooth=True
        for li in p.loop_indices:art.data[li].uv=uvs[mesh.loops[li].vertex_index]
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);parts.append(obj)
    verts.clear();faces.clear();cols.clear();uvs.clear()
verts=[];cols=[];faces=[];uvs=[]
# Torso is relative to the hips. Pleats are narrow at the waist and open over the ribs.
rows=[]
for i in range(25):
    y=.57*i/24
    width=.175+.044*math.exp(-((y-.43)/.13)**2)-.093*max(0,(y-.48)/.09)
    r=.122+.028*math.sin(math.pi*y/.57)+.006*math.sin(94*y)*math.exp(-((y-.19)/.10)**2)
    rows.append((0,y,0,width,r))
rings(rows,white,cloth=True)
rings([(0,.095,0,.178,.137),(0,.132,0,.178,.140)],dark)
for side in (-1,1):
    rod((side*.045,.437,.147),(side*.175,.442,.09),.005,dark)
    rod((side*.069,.2,.129),(side*.142,.235,.098),.004,dark)
    cx=side*.090;y=.345;rr=[]
    for j in range(2):
        row=[]
        for i in range(7):
            x=cx+.116*(i/6-.5);z=.156*math.sqrt(1-(x/.215)**2)+.007
            row.append(vertex((x,y+.035*j,z),white,((10+282*i/6)/512,1-((526 if side<0 else 605)+64-61*j)/768)))
        rr.append(row)
    for i in range(6):faces.append((rr[0][i],rr[0][i+1],rr[1][i+1],rr[1][i]))
# Rear crew identifiers follow the curvature of the shoulder blades.
for y,row,width in [(.377,605,.274),(.311,526,.146)]:
 rr=[]
 for j in range(2):
    strip=[]
    for i in range(13):
        x=width*(i/12-.5);z=-.154*math.sqrt(max(0,1-(x/.214)**2))-.007
        strip.append(vertex((x,y+.050*j,z),white,((292-282*i/12)/512,1-(row+64-61*j)/768)))
    rr.append(strip)
 for i in range(12):faces.append((rr[0][i],rr[1][i],rr[1][i+1],rr[0][i+1]))
for side in (-1,1):
 rod((side*.038,.455,-.144),(side*.169,.45,-.094),.007,dark)
 rod((side*.155,.25,-.098),(side*.177,.145,-.06),.009,dark)
rod((0,.14,.139),(0,.495,.124),.004,dark);make('Torso')
# Fireproof balaclava, mirrored visor, shell and hinge hardware.
rings([(0,0,.004,.074,.077),(0,.061,.015,.083,.09)],dark)
rings([(0,.04,.022,.084,.101),(0,.073,.021,.104,.122),(0,.157,.009,.117,.123),(0,.224,-.003,.104,.107),(0,.266,-.008,.065,.070),(0,.277,-.008,.027,.035)],(.18,.205,.235))
for j in range(5):
    a=.085+j*.017;rr=[]
    for y in [a,a+.017]:
        rr.append([vertex((.113*math.sin(t*.075),y,.022+.113*math.cos(t*.075)),(.026+.013*j,.042+.015*j,.057+.016*j)) for t in range(-18,19)])
    for i in range(36):faces.append((rr[0][i],rr[0][i+1],rr[1][i+1],rr[1][i]))
# Recessed rear vent strip and shell ribs catch the garage light.
for j in range(4):rod((-.042,.102+j*.010,-.106),(.042,.102+j*.010,-.106),.003,dark)
for side in (-1,1):rod((side*.11,.126,.019),(side*.121,.126,.019),.017,metal)
make('Helmet')
for name,length,r0,r1 in [('Sleeve',.31,.080,.065),('Forearm',.27,.067,.045),('Thigh',.43,.105,.081),('Shin',.43,.082,.061)]:
    rows=[]
    for i in range(13):
        t=i/12;r=(r0*(1-t)+r1*t)*(1+.085*math.sin(28*t+.3)*math.exp(-((t-.78)/.24)**2))
        rows.append((0,t*length,0,r,r*.93))
    rings(rows,white,16,cloth=True)
    rings([(0,length*.86,0,r1*1.13,r1*1.06),(0,length*.92,0,r1*1.11,r1*1.04)],dark,16)
    make(name)
rings([(0,-.04,.026,.041,.045),(0,.003,.029,.051,.050),(0,.045,.022,.042,.041)],dark,14);make('Glove')
rings([(0,0,.034,.076,.133),(0,.027,.037,.082,.140),(0,.061,.027,.076,.125),(0,.114,-.015,.067,.074)],dark);make('Boot')
rod((0,0,0),(0,0,.18),.055,red,.060);rod((0,0,.18),(0,0,.31),.032,metal,.025)
rod((0,-.104,.045),(0,-.018,.024),.026,dark);rod((0,.014,-.044),(0,.014,.002),.045,dark);make('SocketGun')
rubber=(.034,.033,.031)
tyre_ring([(-.15,.224),(-.166,.261),(-.159,.310),(-.128,.349),(-.082,.36),(.082,.36),(.128,.349),(.159,.310),(.166,.261),(.15,.224)],rubber)
for sign in [-1,1]:
    tyre_ring([(sign*.151,.23),(sign*.153,.219),(sign*.135,.201),(sign*.112,.097),(sign*.12,.046),(sign*.132,.04)],dark)
    tyre_ring([(sign*.151,.232),(sign*.155,.229),(sign*.153,.225)],metal)
    for i in range(7):
        a=math.tau*i/7
        rod((sign*.12,.089*math.cos(a),.089*math.sin(a)),(sign*.137,.205*math.cos(a+.20),.205*math.sin(a+.20)),.005,(.11,.12,.13))
make('SpareWheel')
for sign in [-1,1]:tyre_ring([(sign*.161,.292),(sign*.162,.297)],white)
make('CompoundBand')
for side in [-1,1]:
    rod((side*.195,.073,-.21),(side*.125,.078,.35),.032,metal)
    rod((side*.145,.085,.12),(side*.062,.20,.33),.027,red)
    rod((side*.20,.070,-.13),(side*.245,.070,-.13),.071,dark)
rod((-.2,.09,-.15),(.2,.09,-.15),.031,metal);rod((-.113,.155,.345),(.113,.155,.345),.038,dark);make('JackFoot')
rod((0,.09,-.13),(0,.91,-.82),.029,metal);rod((-.21,.91,-.82),(.21,.91,-.82),.028,dark);make('JackHandle')
# Each mesh can be inspected individually in the native file.
for i,o in enumerate(parts):o.location.x=i*.65
bpy.ops.wm.save_as_mainfile(filepath=str(root/'scripts/blender/pit-equipment.blend'))
raw=Path('/tmp/jgp-service-kit.glb')
bpy.ops.export_scene.gltf(filepath=str(raw),export_format='GLB',export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_yup=True,export_cameras=False,export_lights=False)
pack(raw,out/'pit-equipment.glb.gz')
