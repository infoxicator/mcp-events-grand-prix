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
# Closed fabric skins. The renderer bends each sleeve and trouser leg about
# its bind joint. The bias folds cross that joint uninterrupted.
def tailored(profile,col,n,fold,panel):
    previous=None
    for j,(y,rx,rz,z) in enumerate(profile):
        row=[]
        for i in range(n):
            a=-math.tau*i/n
            crease=fold*math.sin(82*y+2.7*math.cos(a)+.65*math.sin(3*a))
            radius=1+crease+.025*math.cos(3*a-.6)
            # Reinforced flex panels and inset seams break up the silhouette at
            # the waist, knee and elbow. Edges taper with the garment pattern.
            panel_edge=abs(math.cos(a))
            if panel=='jacket':
                inset=panel_edge>.89+.055*math.cos(8*y) and .065<y<.43
            elif panel=='trouser':
                inset=(math.sin(a)<-.42 and .34<y<.50) or (panel_edge>.94 and .12<y<.79)
            else:
                inset=(math.sin(a)<-.57 and .235<y<.40) or (panel_edge>.9 and .13<y<.52)
            shade=(1+.45*crease)*(.18 if inset else 1)
            row.append(vertex((rx*math.cos(a)*radius,y,z+rz*math.sin(a)*radius),
                tuple(c*shade for c in col),(.613+.352*i/n,1-(533+209*j/(len(profile)-1))/768)))
        if previous:
            for i in range(n):faces.append((previous[i],previous[(i+1)%n],row[(i+1)%n],row[i]))
        else:faces.append(tuple(reversed(row)))
        previous=row
    faces.append(tuple(previous))
def section(rows,steps=3):
    profile=[]
    for a,b in zip(rows,rows[1:]):
        for i in range(steps):
            t=i/steps;profile.append(tuple(x+(y-x)*t for x,y in zip(a,b)))
    return profile+[rows[-1]]
# Tucked seat, natural waist, rib cage, shoulder yoke and padded collar.
tailored(section([(-.086,.11,.084,-.018),(-.03,.173,.126,-.025),(.052,.186,.139,-.024),
    (.13,.159,.111,-.008),(.21,.171,.121,0),(.32,.199,.146,.004),(.42,.204,.148,.003),
    (.475,.180,.128,-.004),(.51,.104,.090,0)]),white,40,.023,'jacket')
rings([(0,.114,0,.161,.116),(0,.134,0,.16,.115)],(.08,.09,.10),28)
rings([(0,.491,0,.109,.094),(0,.537,-.006,.095,.083)],dark,24)
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
rings([(0,.037,.036,.065,.098),(0,.058,.029,.095,.119),(0,.094,.025,.104,.134),
       (0,.151,.011,.118,.136),(0,.207,-.004,.117,.124),(0,.244,-.013,.095,.103),
       (0,.267,-.010,.064,.076),(0,.279,-.007,.022,.030)],(.08,.106,.145),32)
make('Helmet')
# Continuous wraparound visor and brow gasket, with shaped chin opening.
for bottom,top,col in [(.113,.202,(.012,.015,.021)),(.119,.193,(.025,.069,.098)),
                       (.186,.192,(.125,.18,.21)),(.073,.087,(.024,.028,.035))]:
    rows=[]
    for j in range(4):
        ring=[]
        for i in range(37):
            a=(i-18)*.078;t=j/3;y=bottom+(top-bottom)*t-.022*(abs(a)/1.42)**1.8
            ring.append(vertex((.116*math.sin(a),y,.017+(.138+.003*math.sin(t*math.pi))*math.cos(a)),col))
        rows.append(ring)
    for a,b in zip(rows,rows[1:]):
        for i in range(36):faces.append((a[i],a[i+1],b[i+1],b[i]))
make('PitVisor')
# Stack tear-offs along the visor edge and mould a ridge into the helmet shell.
for side in [-1,1]:
    for j in range(2):
        rod((side*.094,.153+j*.012,.096),(side*.108,.150+j*.012,.084),.004,(.51,.52,.48),n=8)
    rod((side*.077,.239,.052),(side*.076,.249,-.049),.008,(.042,.047,.053))
for j in range(4):rod((-.042,.102+j*.010,-.119),(.042,.102+j*.010,-.119),.003,dark)
for side in (-1,1):
    rod((side*.104,.155,.030),(side*.12,.155,.030),.015,metal)
    rod((side*.10,.119,-.045),(side*.113,.119,-.045),.029,dark)
rod((-.104,.123,.058),(-.088,.096,.146),.004,dark)
rod((-.088,.096,.146),(-.045,.093,.157),.006,dark)
for side in (-1,1):
    rings([(side*.119,.077,-.026,.016,.034),(side*.121,.094,-.026,.033,.047),
           (side*.122,.150,-.026,.034,.049),(side*.116,.170,-.026,.023,.035)],dark,16)
    rod((side*.122,.16,-.026),(side*.096,.234,-.031),.007,metal,n=8)
for i in range(24):
    def cable(k):
        t=k/24
        return (-.125+.007*math.cos(t*math.tau*4),.085-.088*t,-.04-.063*t+.007*math.sin(t*math.tau*4))
    rod(cable(i),cable(i+1),.003,dark,n=5)
make('HelmetHardware')
rings([(0,-.075,.043,.046,.029),(0,-.040,.068,.072,.039),(0,.030,.071,.077,.042),(0,.082,.049,.050,.030)],dark,14)
make('KneePad')
rings([(0,0,0,.049,.029),(0,.082,0,.049,.029)],dark,8)
rod((0,.082,0),(0,.092,0),.016,red,n=8)
make('ReleaseController')
tailored(section([(-.054,.018,.023,0),(-.028,.069,.066,0),(.022,.086,.077,.004),
    (.095,.084,.080,.005),(.178,.075,.069,0),(.252,.063,.063,-.005),(.31,.059,.061,-.008),
    (.354,.065,.064,-.005),(.405,.066,.060,0),(.494,.050,.047,0),(.575,.039,.039,0)]),
    white,24,.034,'sleeve')
rings([(0,.547,0,.044,.043),(0,.581,0,.041,.041)],(.10,.11,.13),18);make('Arm')
tailored(section([(-.062,.056,.060,0),(-.025,.095,.101,-.012),(.045,.114,.111,-.011),
    (.128,.111,.109,0),(.228,.102,.097,.007),(.334,.084,.085,.003),(.43,.078,.078,-.003),
    (.51,.078,.083,0),(.587,.079,.088,.012),(.714,.060,.065,.009),(.836,.054,.058,0),
    (.858,.051,.055,0)]),white,28,.033,'trouser');make('Leg')
# Pre-curled fingers and a separate thumb form a grasp around a tyre or tool.
rings([(0,-.023,0,.032,.034),(0,.012,.009,.046,.040),(0,.045,.013,.043,.033)],dark,18)
for i in range(4):
    x=(i-1.5)*.019;reach=.064-.009*abs(i-1)
    rod((x,.028,.016),(x,.042,reach),.012,dark,.011)
    rod((x,.042,reach),(x,.022,reach+.016),.011,dark,.009)
rod((-.030,.009,.009),(-.050,.014,.040),.015,dark,.012)
left=([( -x,y,z) for x,y,z in verts],[tuple(reversed(f)) for f in faces],cols.copy(),uvs.copy())
make('Glove')
verts[:],faces[:],cols[:],uvs[:]=left
make('GloveLeft')
rings([(0,-.004,.046,.062,.131),(0,.016,.049,.072,.142),
       (0,.035,.052,.074,.139),(0,.054,.039,.070,.126),
       (0,.075,.003,.062,.083),(0,.117,-.017,.052,.061)],dark,28)
rings([(0,-.005,.048,.062,.134),(0,.004,.049,.073,.143),(0,.011,.05,.071,.143)],(.013,.014,.015),28)
for side in [-1,1]:
    rod((side*.072,.036,.066),(side*.065,.048,-.006),.0038,(.35,.35,.33))
for i in range(3):
    rod((-.035,.061+i*.006,.066-i*.017),(.035,.061+i*.006,.061-i*.017),.0028,(.27,.28,.27))
make('Boot')
rod((0,0,-.046),(0,0,.136),.054,(.21,.23,.24),.060,20)
rod((0,0,.128),(0,0,.202),.050,dark,.045)
rod((0,0,.197),(0,0,.265),.032,metal,.026)
rod((0,0,.260),(0,0,.310),.037,(.13,.15,.15),.030)
rod((0,-.119,.017),(0,-.018,.038),.028,dark)
rod((0,-.092,.053),(0,-.044,.069),.011,red)
# Air coupling, impact-head retaining ring and recessed drive socket.
rod((0,0,.28),(0,0,.305),.042,metal,.041,20)
rod((0,0,.305),(0,0,.312),.029,dark,.029,6)
rod((0,-.118,.018),(0,-.148,.018),.016,metal,.014,12)
for j in range(4):
    rod((-.039,.031,-.019+j*.027),(.039,.031,-.019+j*.027),.007,dark)
# Mark the LED by its saturated white vertex colour and axial range.
rod((0,0,.209),(0,0,.222),.039,(1,1,1),n=20)
make('SocketGun')
# A one-metre hose section, instanced along the hanging lines.
rod((0,0,0),(0,1,0),.011,(.044,.048,.052),n=10);make('AirHose')
rod((0,.07,0),(0,2.86,0),.054,(.11,.12,.13))
rod((0,2.85,0),(-5.4,2.85,0),.041,(.16,.17,.18))
rod((0,2.15,0),(-1.15,2.85,0),.034,(.13,.14,.15))
for x in [-1.35,-4.45]:
    rod((x,2.85,-.10),(x,2.85,.10),.049,metal)
make('HoseBoom')
# Twin clamp posts bolt the pod directly to the end chord.
rings([(0,-.11,0,.34,.105),(0,.14,0,.34,.105)],dark,8)
for x in (-.20,.20):rod((x,.12,0),(x,.39,0),.027,metal)
for x in (-.24,-.08,.08,.24):
    rod((x,.033,-.06),(x,.033,-.13),.065,dark,n=16)
    rod((x,.095,-.070),(x,.095,-.164),.011,metal,n=8)
make('ReleaseHousing')
rod((0,0,-.131),(0,0,-.135),.047,(1,1,1),n=18);make('ReleaseLens')
rubber=(.034,.033,.031)
tyre_ring([(-.15,.224),(-.166,.261),(-.159,.310),(-.128,.349),(-.082,.36),(.082,.36),(.128,.349),(.159,.310),(.166,.261),(.15,.224)],rubber)
for sign in [-1,1]:
    tyre_ring([(sign*.151,.23),(sign*.153,.219),(sign*.135,.201),(sign*.112,.097),(sign*.12,.046),(sign*.132,.04)],dark)
    tyre_ring([(sign*.151,.232),(sign*.155,.229),(sign*.153,.225)],metal)
    from wheel_trim import spoke_faces
    points,polys,alloy=spoke_faces()
    start=len(verts)
    for (x,y,z),shade in zip(points,alloy):
        vertex((sign*(.154+x),y,z),shade[:3])
    for poly in polys:faces.append(tuple(start+i for i in (poly if sign>0 else reversed(poly))))
    # Captive centre lock, recessed hex and screw circle on the off-car rim.
    rod((sign*.123,0,0),(sign*.149,0,0),.047,metal,.041,6)
    rod((sign*.150,0,0),(sign*.152,0,0),.023,dark,n=6)
    for j in range(12):
        a=j*math.tau/12
        rod((sign*.139,.209*math.cos(a),.209*math.sin(a)),(sign*.147,.209*math.cos(a),.209*math.sin(a)),.004,metal,n=6)
make('SpareWheel')
for sign in [-1,1]:tyre_ring([(sign*.161,.292),(sign*.162,.297)],white)
make('CompoundBand')
for side in [-1,1]:
    rod((side*.195,.073,-.21),(side*.125,.078,.35),.032,metal)
    rod((side*.145,.085,.12),(side*.062,.20,.33),.027,red)
    rod((side*.20,.070,-.13),(side*.245,.070,-.13),.071,dark)
rod((-.2,.09,-.15),(.2,.09,-.15),.031,metal);make('JackFoot')
# Low rear fork straddles the crash structure and hooks behind its lip.
for side in (-1,1):
    rod((side*.17,.063,-.19),(side*.085,.090,.28),.031,metal,n=8)
    rod((side*.085,.09,.28),(side*.085,.22,.33),.032,red,n=8)
    rod((side*.085,.22,.33),(side*.085,.22,.39),.026,dark,n=8)
    rod((side*.14,.061,-.13),(side*.20,.061,-.13),.062,dark,n=8)
rod((-.17,.073,-.13),(.17,.073,-.13),.03,metal,n=8);make('RearJackFoot')
for side in (-1,1):rod((side*.10,0,0),(side*.10,.055,.42),.027,red,n=10)
make('JackLiftArm')
rod((-.113,.155,.345),(.113,.155,.345),.038,dark);make('JackCradle')
rod((0,0,0),(0,.82,-.69),.029,metal);rod((-.21,.82,-.69),(.21,.82,-.69),.028,dark)
rod((.15,.82,-.69),(.15,.76,-.64),.012,red,n=8)
rod((.15,.76,-.64),(.073,.76,-.64),.012,red,n=8);make('JackHandle')
# Soft occlusion under an individual planted sole. The renderer follows each
# boot so the contact opens out and fades as its weight shifts to the other leg.
contact=bpy.data.materials.new('Sole contact');contact.use_nodes=True
nodes=contact.node_tree.nodes;bs=nodes.get('Principled BSDF')
bs.inputs['Base Color'].default_value=(.009,.008,.008,1)
im=bpy.data.images.new('Service sole occlusion',32,32,alpha=True)
pixels=[]
for iz in range(32):
    for ix in range(32):
        x=(ix+.5)/16-1;z=(iz+.5)/16-1
        pixels.extend((1,1,1,.58*max(0,1-x*x-z*z)**2))
im.pixels.foreach_set(pixels);im.pack()
tex=nodes.new('ShaderNodeTexImage');tex.image=im
contact.node_tree.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
for x,z,u,v in [(-.17,-.19,0,0),(-.17,.29,0,1),(.17,.29,1,1),(.17,-.19,1,0)]:
    vertex((x,0,z),white,(u,v))
faces.append((0,1,2,3));make('SoleContact');parts[-1].data.materials[0]=contact
# Replacement nose and layered carbon flaps carried in by the front-wing adjusters.
for z,h,chord in [(.04,.07,.29),(-.15,.13,.21),(-.27,.20,.14)]:
    for side in [-1,1]:
        sections=[]
        for w in [.06,.38,.71,.96]:
            y=h+.045*w*w
            sections.append([vertex((side*w,y+dy,z-w*.09+dz),dark) for dy,dz in [(0,0),(.023,-.13*chord),(.026,-chord),(.008,-chord)]])
        for a,b in zip(sections,sections[1:]):
            for j in range(4):faces.append((a[j],a[(j+1)%4],b[(j+1)%4],b[j]))
        faces.append(tuple(sections[-1]))
for z,rx,ry in [(.13,.087,.047),(-.22,.115,.068),(-.62,.17,.10)]:
    ring=[vertex((rx*math.cos(j*math.tau/16),.21+ry*math.sin(j*math.tau/16),z),white) for j in range(16)]
    if z==.13:faces.append(tuple(ring))
    else:
        for j in range(16):faces.append((prev[j],prev[(j+1)%16],ring[(j+1)%16],ring[j]))
    prev=ring
faces.append(tuple(reversed(prev)));make('ServiceNose')
# Each mesh can be inspected individually in the native file.
for i,o in enumerate(parts):o.location.x=i*.65
bpy.ops.wm.save_as_mainfile(filepath=str(root/'scripts/blender/pit-equipment.blend'))
# Keep the suit bind meshes in the native file for build_service_suit.py.
for part in parts:
    part.select_set(part.name not in {'Torso','Arm','Leg','AirHose','HoseBoom'})
raw=Path('/tmp/jgp-service-kit.glb')
bpy.ops.export_scene.gltf(filepath=str(raw),export_format='GLB',use_selection=True,export_vertex_color='ACTIVE',export_all_vertex_colors=False,export_yup=True,export_cameras=False,export_lights=False)
pack(raw,out/'pit-equipment.glb.gz')
