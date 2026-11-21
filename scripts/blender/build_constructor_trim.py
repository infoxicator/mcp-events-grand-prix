"""Build eleven cooling packages, wheel spokes, wing elements and tyre contacts in game metres."""
import bpy, gzip, math, tempfile, json, struct
from mathutils.bvhtree import BVHTree
from pathlib import Path
root=Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
def part(name,verts,faces,colors,flap_uv=None):
    geo=bpy.data.meshes.new(name);geo.from_pydata(verts,[],faces);geo.update()
    obj=bpy.data.objects.new(name,geo);bpy.context.collection.objects.link(obj)
    ink=geo.color_attributes.new(name='Finish',type='BYTE_COLOR',domain='POINT')
    for i,col in enumerate(colors):ink.data[i].color=col
    if flap_uv:
        # Only the upper flap samples the rear print. The other faces retain
        # their body-space artwork at both distances.
        layer=geo.uv_layers.new(name='Flap')
        for loop in geo.loops:
            u,v=flap_uv.get(loop.vertex_index,(-1,0))
            layer.data[loop.index].uv=(u,1-v)
    for poly in geo.polygons:poly.use_smooth=True
# Register cooling outlets on the actual Blender field skin. A ray in chassis
# space picks up the compound taper of the engine cover at each blade end.
raw=gzip.decompress((root/'src/race/assets/field-near.glb.gz').read_bytes())
size=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+size]);blob=raw[28+size:]
def read_accessor(i):
    acc=doc['accessors'][i];view=doc['bufferViews'][acc['bufferView']]
    fmt='<'+{'SCALAR':'','VEC3':'3'}[acc['type']]+{5123:'H',5125:'I',5126:'f'}[acc['componentType']]
    stride=view.get('byteStride',struct.calcsize(fmt));offset=view.get('byteOffset',0)+acc.get('byteOffset',0)
    return [struct.unpack_from(fmt,blob,offset+j*stride) for j in range(acc['count'])]
skin=[];triangles=[]
for m in doc['meshes']:
    if m['name'] not in ('Paint','Accent'):continue
    for prim in m['primitives']:
        start=len(skin);skin.extend(read_accessor(prim['attributes']['POSITION']))
        idx=read_accessor(prim['indices']);triangles.extend(tuple(start+idx[j+k][0] for k in range(3)) for j in range(0,len(idx),3))
surface=BVHTree.FromPolygons(skin,triangles,all_triangles=True)
# Inlet lip rise, crest cutback, cooling-bank count, pitch, aft sweep.
forms={'Rolled':{'Ferrari':(.018,.032,6,.075,.115),'Haas':(-.027,-.042,4,.108,.091),
                'Audi':(.035,.009,5,.083,.146),'Cadillac':(-.015,-.072,4,.095,.157)},
       'Blade':{'Mercedes':(.014,.026,7,.063,.119),'AstonMartin':(-.035,.018,6,.079,.163),
                'Williams':(.023,-.055,5,.093,.132),'Alpine':(-.021,-.031,4,.119,.087)},
       'Sculpted':{'RedBullRacing':(.015,.022,5,.079,.106),'RacingBulls':(-.026,-.027,6,.065,.092),
                   'McLaren':(.042,-.064,7,.063,.161)}}
def field_intake(family, vertices, faces, colors):
    # The lip sits in front of the shared intake. Keep enough throat depth
    # for it to read above the cockpit of an overlapping car in either LOD.
    profiles={
      'Blade':[(0,1.155),(.093,1.139),(.156,1.086),(.166,1.023),(.133,.988),(.058,.976),(0,.974)],
      'Rolled':[(0,1.166),(.043,1.154),(.091,1.096),(.135,1.019),(.134,.986),(.075,.967),(0,.965)],
      'Sculpted':[(0,1.144),(.065,1.142),(.127,1.117),(.156,1.079),(.157,1.036),(.092,1.007),(0,1.002)]}
    half=profiles[family]
    outline=half+[(-x,y) for x,y in reversed(half[1:-1])]
    first=len(vertices);count=len(outline)
    for z,scale,shade in [(-.71,.91,.66),(-.553,1.,.89),(-.499,1.,1.0),
                           (-.490,.86,.56),(-.512,.77,.087),(-.548,.73,.041)]:
        for x,y in outline:
            vertices.append((x*scale,1.064+(y-1.064)*scale,z));colors.append((shade,shade,shade,1))
    for row in range(5):
        for i in range(count):
            a=first+row*count+i;b=first+row*count+(i+1)%count
            faces.append((a,b,b+count,a+count))
    faces.append(tuple(range(first+5*count,first+6*count)))

# Rear flap shoulder position, central trailing-edge rise, tip rise, sweep.
# The pivot and outer span stay at the base field car's fixed mounting points.
rear_forms={
 'Ferrari':(.59,.110,.070,.020),'Mercedes':(.73,.095,.171,.052),
 'McLaren':(.48,.152,.056,.043),'RedBullRacing':(.70,.145,.098,.014),
 'RacingBulls':(.43,.081,.159,.029),'Alpine':(.58,.083,.178,.065),
 'Haas':(.64,.132,.113,.045),'Audi':(.52,.165,.059,.022),
 'Williams':(.76,.148,.083,.061),'AstonMartin':(.40,.113,.144,.042),
 'Cadillac':(.74,.088,.141,.014)}
def rear_flap(team,vertices,faces,colours):
    shoulder,centre,tip,sweep=rear_forms[team]
    uv={};first=len(vertices)
    for t in [-1,-.92,-shoulder,-.22,0,.22,shoulder,.92,1]:
        a=abs(t);blend=min(1,max(0,(a-.22)/(shoulder-.22)))
        blend=blend*blend*(3-2*blend)
        rise=centre+(tip-centre)*blend
        for chord,camber,value in [(0,0,.56),(.08,.012,.85),(.55,.018,1),(1,0,.95),(1,-.009,.42),(.45,-.004,.67),(0,-.006,.64)]:
            x=.776*t;z=-2.405-.245*chord-sweep*a*a
            y=.816+.026*a*a+rise*chord+camber
            uv[len(vertices)]=((1-t)/2,chord)
            vertices.append((x,y,z));colours.append((value,value,value,1))
    for j in range(8):
        for k in range(7):
            a=first+j*7+k;b=first+j*7+(k+1)%7
            faces.append((a,b,b+7,a+7))
    faces.extend([tuple(range(first,first+7)),tuple(reversed(range(first+56,first+63)))])
    return uv

# Cross-sections along the shoulder turn down into the sidepod undercut.
for name,stations in {
 'Rolled':[(.55,.32,.78,.623),(.46,.31,.814,.656),(.27,.38,.858,.676),(-.12,.55,.897,.686),(-.61,.69,.876,.657)],
 'Blade':[(.575,.35,.795,.568),(.475,.348,.831,.610),(.22,.47,.865,.653),(-.14,.58,.90,.672),(-.56,.66,.888,.646),(-1.08,.62,.76,.575)],
 'Sculpted':[(.52,.33,.78,.59),(.41,.36,.83,.633),(.14,.49,.877,.657),(-.32,.65,.902,.669),(-.76,.66,.836,.638)]}.items():
    v=[];f=[];colors=[]
    for side in (-1,1):
        start=len(v)
        for j,(z,inner,outer,y) in enumerate(stations):
            for t,h,shade in [(0,-.010,.13),(.12,.004,.58),(.71,.015,1),(.97,.007,.82),(1,-.012,.34),(.83,-.026,.08),(.21,-.017,.07)]:
                v.append((side*(inner+(outer-inner)*t),y+h,z))
                colors.append((shade,shade,shade,1))
            if j:
                for i in range(7):
                    a=start+7*(j-1)+i;b=start+7*(j-1)+(i+1)%7
                    f.append((a,b,b+7,a+7))
        f.extend([tuple(range(start,start+7)),tuple(range(len(v)-7,len(v)))])
    # Raised aft engine-spine profiles and flared cooling exits. Each
    # constructor family keeps its own rear silhouette in shared field LOD.
    crest={'Rolled':[(-2.19,.027,.898),(-1.94,.048,.988),(-1.59,.058,1.032),(-1.27,.060,1.056)],
           'Blade':[(-2.17,.017,.986),(-1.99,.026,1.108),(-1.64,.032,1.125),(-1.23,.055,1.073)],
           'Sculpted':[(-2.16,.043,.903),(-1.98,.065,.944),(-1.70,.088,1.014),(-1.24,.071,1.059)]}[name]
    start=len(v)
    for row,(z,w,top) in enumerate(crest):
        for t,h,light in [(-1,-.102,.31),(-.70,-.014,.68),(0,0,.92),(.70,-.014,.68),(1,-.102,.31)]:
            v.append((t*w,top+h,z));colors.append((light,light,light,1))
        if row:
            for k in range(4):
                a=start+(row-1)*5+k;f.append((a,a+1,a+6,a+5))
    for side in [-1,1]:
        start=len(v)
        for j,(z,x,y) in enumerate([(-1.54,.47,.491),(-1.72,.421,.441),(-1.96,.331,.353),(-2.09,.235,.305)]):
            x+=.034 if name=='Rolled' else -.024 if name=='Blade' else 0
            for dx,dy,light in [(-.07,.032,.70),(0,.016,.79),(.020,-.012,.39),(-.017,-.047,.14),(-.081,-.043,.08)]:
                v.append((side*(x+dx),y+dy,z));colors.append((light,light,light,1))
            if j:
                for k in range(5):
                    a=start+(j-1)*5+k;b=start+(j-1)*5+(k+1)%5;f.append((a,b,b+5,a+5))
        f.append(tuple(range(len(v)-5,len(v))))
    # Three aft fin cut-outs visible through the rear wing. Join to the
    # existing crest and close both sides so the profile reads from either lane.
    sections={
        'Blade':[(-2.06,.92),(-1.92,1.14),(-1.50,1.19),(-1.25,1.10)],
        'Rolled':[(-2.06,.88),(-1.91,.94),(-1.56,1.01),(-1.25,1.10)],
        'Sculpted':[(-2.06,.90),(-1.97,1.00),(-1.60,1.07),(-1.25,1.10)]}[name]
    fin_faces=len(f)
    start=len(v)
    for z,top in sections:
        for x,y,shade in [(-.035,.865,.31),(-.020,top-.016,.65),(0.,top,.9),(.020,top-.016,.65),(.035,.865,.31)]:
            v.append((x,y,z));colors.append((shade,shade,shade,1))
    for j in range(3):
        for k in range(5):
            a=start+5*j+k;b=start+5*j+(k+1)%5
            f.append((a,b,b+5,a+5))
    f.extend([tuple(range(start,start+5)),tuple(reversed(range(start+15,start+20)))])
    distant=list(v);distant_faces=list(f);distant_colors=list(colors)
    field_intake(name,distant,distant_faces,distant_colors)

    for team,(rise,cutback,count,pitch,sweep) in forms[name].items():
        far=list(distant);ff=list(distant_faces);fc=list(distant_colors)
        far_uv=rear_flap(team,far,ff,fc)
        part('Far'+team,far,ff,fc,far_uv)
        panel=[];faces=list(f);shades=list(colors)
        for x,y,z in v:
            if abs(x)>.5 and z>-.99:y+=rise*min(1,abs(x)/.85)
            if abs(x)<.08 and z<-1.24:y+=cutback*min(1,(-z-1.24)/.75)
            panel.append((x,y,z))
        for side in [-1,1]:
            for blade in range(count):
                start=len(panel)
                for z,y in [(-.92-blade*pitch,.72),(-.92-blade*pitch-sweep*.5,.77),(-.92-blade*pitch-sweep,.815)]:
                    for lip,depth,light in [(0,.010,.77),(.012,.015,.54),(.021,.008,.055),(.034,.006,.025)]:
                        pos,*_=surface.ray_cast((side*1.2,y,z-lip),(-side,0,0),1.2)
                        if pos is None:pos=(side*.13,y,z-lip)
                        panel.append((pos[0]+side*depth,y,z-lip));shades.append((light,light,light,1))
                for row in range(2):
                    for col in range(3):
                        a=start+row*4+col;faces.append((a,a+1,a+5,a+4))
        if team in ('Ferrari','Mercedes'):
            # Cooling slots follow the fin in the field mesh. Preserve their
            # indices on the hero package while omitting the field-only faces.
            part('Body'+team,panel,faces[:fin_faces]+faces[len(f):],shades)
        field_intake(name,panel,faces,shades)
        # The close-field front fence terminates the wing at the same fixed
        # span. Its entry radius, crown, aft notch and foot differ by car.
        fences={'Ferrari':(.012,.12,.78,.030),'Mercedes':(.024,.19,.56,.057),
                'RedBullRacing':(.026,.15,.71,.024),'RacingBulls':(.047,.18,.67,.048),
                'McLaren':(.055,.13,.84,.018),'Alpine':(.065,.14,.78,.050),
                'Haas':(.017,.17,.59,.041),'Audi':(.027,.15,.84,.016),
                'Williams':(.049,.18,.52,.051),'AstonMartin':(.034,.15,.66,.035),
                'Cadillac':(.060,.16,.62,.021)}
        radius,rise,peak,notch=fences[team]
        for side in (-1,1):
            start=len(panel)
            for u,top in [(0,.130),(.075,.15+radius),(.30,.176+rise*.25),
                          (peak,.15+rise),(.93,.14+rise-notch),(1,.12+rise-notch)]:
                z=2.78-.71*u
                for x,y,shade in [(.957,.106,.29),(.977,.116,.75),(.974,top-.014,.93),
                                  (.964,top,1.),(.953,top-.009,.67),(.951,.116,.35)]:
                    panel.append((side*x,y,z));shades.append((shade,shade,shade,1))
            for j in range(5):
                for k in range(6):
                    a=start+j*6+k;b=start+j*6+(k+1)%6;faces.append((a,b,b+6,a+6))
            faces.extend([tuple(range(start,start+6)),tuple(range(start+30,start+36))])
        near_uv=rear_flap(team,panel,faces,shades)
        part('Field'+team,panel,faces,shades,near_uv)
# Station lofts for the outboard wing foot and diffuser lip. The return
# closes on the existing end fence, leaving the nose pylons, wing pivot,
# axles and undertray mounting plane at their original game coordinates.
for name in ('SF26Aero','W17Aero'):
    ferrari=name=='SF26Aero'
    v=[];f=[];colors=[]
    def loft_sections(stations,side):
        start=len(v)
        for row,(z,x,y,width,height) in enumerate(stations):
            # Rounded leading edge, convex pressure surface, thin trailing edge.
            for u,h,shade in [(0,0,.48),(.10,.58,.83),(.40,1,1),(.78,.65,.92),
                              (1,.06,.70),(.96,-.13,.49),(.39,-.28,.39),(.09,-.23,.37)]:
                v.append((side*(x+u*width),y+h*height,z));colors.append((shade,shade,shade,1))
            if row:
                for i in range(8):
                    a=start+(row-1)*8+i;b=start+(row-1)*8+(i+1)%8
                    f.append((a,b,b+8,a+8))
        f.extend([tuple(range(start+7,start-1,-1)),tuple(range(len(v)-8,len(v)))])
    for side in (-1,1):
        if ferrari:
            # Low, long outwashed shelf with a short kicked-up trailing lip.
            foot=[(2.80,.933,.114,.010,.004),(2.72,.950,.121,.035,.009),
                  (2.54,.959,.125,.045,.010),(2.31,.959,.145,.040,.013),
                  (2.14,.956,.178,.036,.022),(2.04,.951,.201,.010,.015)]
            # Twin arched mouths peak outboard of the central crash structure.
            throat=[(-2.39,.304,.191,.290,.028),(-2.51,.281,.230,.345,.053),
                    (-2.63,.247,.249,.410,.087),(-2.73,.223,.258,.459,.095)]
        else:
            # The upright outer wall rides a short blade foot. Its aft corner
            # turns in to meet the raised tip of the upper flap.
            foot=[(2.69,.935,.140,.012,.005),(2.60,.949,.146,.041,.009),
                  (2.46,.961,.166,.038,.020),(2.33,.963,.206,.031,.044),
                  (2.20,.957,.259,.022,.062),(2.11,.951,.317,.008,.061)]
            # Flatter outboard exit and a taller, tighter inboard channel.
            throat=[(-2.39,.119,.198,.213,.020),(-2.51,.120,.234,.235,.042),
                    (-2.63,.119,.255,.267,.062),(-2.73,.123,.277,.278,.064)]
        loft_sections(foot,side);loft_sections(throat,side)
        # The floor return runs underneath the pod independently of its shoulder.
        undercut=([( .38,.54,.279,.19,.021),(.12,.55,.260,.24,.022),
                  (-.59,.54,.215,.30,.026),(-1.38,.49,.182,.22,.015)] if ferrari else
                 [(.41,.52,.314,.16,.019),(.02,.59,.266,.20,.018),
                  (-.83,.58,.181,.25,.016),(-1.47,.45,.168,.21,.011)])
        loft_sections(undercut,side)
        # Tunnel divider terminates inside the mouth, below the upper kick.
        blade_x=.43 if ferrari else .31
        loft_sections([(-2.38,blade_x,.144,.013,.037),(-2.57,blade_x,.155,.016,.075),
                       (-2.71,blade_x,.178,.012,.095)],side)
        # Recessed run-out below the kick. A second, narrower shelf catches
        # reflected road light behind the lip, leaving the exit open.
        x=.30 if ferrari else .18
        loft_sections([(-2.41,x,.137,.25,.014),(-2.56,x,.154,.29,.019),
                       (-2.68,x,.178,.30,.025)],side)
        # Rounded inner face and trailing flange are inset from the printed fence.
        loft_sections([(2.59,.918,.161,.017,.014),(2.46,.923,.181,.024,.024),
                       (2.28,.926,.204,.026,.037),(2.17,.927,.220,.018,.040)],side)
        # Two ferrules sit between the beam-wing upright and impact structure.
        # An open centre and contrasting inner bore survive the low rear view.
        for cx,cy,cz,r in [(side*.135,.484,-2.60,.050),(side*.211,.378,-2.53,.034)]:
            base=len(v);segments=16
            for dz,scale,shade in [(.12,.82,.28),(.022,1,.56),(0,.96,.78),(0,.67,.52),(.074,.64,.16)]:
                for k in range(segments):
                    angle=math.tau*k/segments
                    v.append((cx+r*scale*math.cos(angle),cy+r*scale*math.sin(angle),cz+dz))
                    colors.append((shade,shade*.95,shade*.89,1))
            for row in range(4):
                for k in range(segments):
                    a=base+row*segments+k;b=base+row*segments+(k+1)%segments
                    f.append((a,b,b+segments,a+segments))
    part(name,v,f,colors)
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from wheel_trim import spoke_faces
part('ForgedSpokes',*spoke_faces())
# Pressed bright wheel faces on the Racing Bulls and Cadillac reference cars.
# Keep the centre fastener open. The rolled outer lip stops inside the tyre bead.
v=[];f=[];colors=[]
for side in (-1,1):
    for axle in (-2.05,1.55):
        base=len(v);sectors=32
        for radius,depth,value in [(.063,-.010,.18),(.072,.001,.48),(.187,.005,.69),
                                   (.207,.002,.54),(.218,.006,.79),(.225,-.001,.32)]:
            for j in range(sectors):
                angle=j*math.tau/sectors
                v.append((side*(.974+depth),.36+radius*math.cos(angle),axle+radius*math.sin(angle)))
                colors.append((value*.98,value,value,1))
        for row in range(5):
            for j in range(sectors):
                a=base+row*sectors+j;b=base+row*sectors+(j+1)%sectors
                face=(a,a+sectors,b+sectors,b)
                f.append(face if side>0 else tuple(reversed(face)))
part('BrightWheelFaces',v,f,colors)
v=[];f=[];colors=[]
for x,z in [(-.818,1.55),(.818,1.55),(-.768,-2.05),(.768,-2.05)]:
    base=len(v)
    for scale,alpha in [(0.06,.65),(.53,.46),(1,0)]:
        for i in range(20):
            a=math.tau*i/20;v.append((x+.245*scale*math.cos(a),.018,z+.35*scale*math.sin(a)));colors.append((.012,.012,.012,alpha))
    f.append(tuple(range(base,base+20)))
    for j in range(2):
        for i in range(20):
            a=base+j*20+i;b=base+j*20+(i+1)%20;f.append((a,b,b+20,a+20))
part('Contact',v,f,colors)
# Reuse one legible trackside marker at the legacy activation lines.
v=[];faces=[];colors=[];uv=[]
for left,right,low,high,support in [(-.58,.58,.75,1.43,False),(-.41,-.37,0,.78,True),(.37,.41,0,.78,True)]:
    start=len(v)
    for x,y,u,t in [(left,low,0,0),(left,high,0,1),(right,high,1,1),(right,low,1,0)]:
        v.append((x,y,.016 if support else 0));uv.append((.02,.98) if support else (u,t))
        colors.append((.19,.19,.19,1) if support else (1,1,1,1))
    faces.append(tuple(range(start,start+4)))
part('RulesBoard',v,faces,colors);geo=bpy.data.meshes['RulesBoard'];art=geo.uv_layers.new(name='Board')
for loop in geo.loops:art.data[loop.index].uv=uv[loop.vertex_index]
with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/'constructor.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_yup=False,export_materials='NONE',export_vertex_color='ACTIVE',export_all_vertex_colors=True)
    (root/'src/race/assets/constructor-trim.glb.gz').write_bytes(gzip.compress(path.read_bytes(),mtime=0))
