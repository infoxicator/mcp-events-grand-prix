"""Cockpit components in metres, X across the car, Y up, Z forward."""
import math
import bpy
from mathutils import Matrix, Vector


def closed_rings(rings):
    count = len(rings[0])
    faces = []
    for row in range(len(rings) - 1):
        for i in range(count):
            a = row * count + i
            b = row * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    faces += [tuple(reversed(range(count))), tuple(range((len(rings)-1)*count, len(rings)*count))]
    return [point for ring in rings for point in ring], faces


def rounded(value, power):
    return math.copysign(abs(value) ** power, value)


def build_halo(mesh, interp, carbon, titanium, cavity, rod):
    # An oval aerodynamic shroud follows the wishbone in plan. Its long axis
    # turns into the surface normal of the side rail as it dives into the mount.
    shroud = carbon.copy()
    shroud.name = 'HaloComposite'
    rails = [[-.316,.603,-.537,.042,.052],[-.332,.686,-.505,.038,.050],
             [-.354,.815,-.409,.033,.041],[-.354,.884,-.19,.027,.039],
             [-.324,.913,.102,.022,.043],[-.259,.914,.32,.019,.044],
             [-.151,.899,.475,.019,.042],[-.071,.887,.545,.020,.040],
             [0,.884,.558,.021,.042]]
    rail = interp(rails + [[-x,y,z,h,w] for x,y,z,h,w in reversed(rails[:-1])], 5)
    rings = []
    for i, row in enumerate(rail):
        centre = Vector(row[:3])
        tangent = Vector(rail[min(i+1,len(rail)-1)][:3])-Vector(rail[max(i-1,0)][:3])
        tangent.normalize()
        across = tangent.cross(Vector((0,1,0))).normalized()
        up = across.cross(tangent).normalized()
        rings.append([centre + across * (row[4]*math.cos(k*math.tau/24)) +
                      up * (row[3]*math.sin(k*math.tau/24)) for k in range(24)])
    mesh('Halo', *closed_rings(rings), shroud)

    # A narrow spoiler is bonded to the upper, outer edge of the titanium
    # shroud. Each side tapers back into the swept wishbone before the centre.
    for half in [rail[:len(rail)//2],list(reversed(rail[len(rail)//2+1:]))]:
        rows=[]
        for i,row in enumerate(half[4:-1],start=4):
            t=(i-4)/(len(half)-6)
            tangent=(Vector(half[i+1][:3])-Vector(half[i-1][:3])).normalized()
            across=tangent.cross(Vector((0,1,0))).normalized()
            if across.x*row[0]<0:across.negate()
            up=Vector((0,1,0))
            envelope=math.sin(math.pi*t)**.7
            centre=Vector(row[:3])+across*(row[4]*.78)+up*(row[3]*.36)
            rows.append([centre+across*w*envelope+up*h*envelope for w,h in
                         [(0,0),(.008,.008),(.011,.022),(.008,.024),(.003,.017),(-.002,.005)]])
        mesh('Bonded halo upper fairing',*closed_rings(rows),carbon)

    # The front leg flares beneath the junction and sits on a teardrop foot.
    stations = interp([[.601,.679,.042,.080],[.622,.671,.040,.070],
                       [.657,.667,.020,.046],[.748,.631,.014,.045],
                       [.838,.586,.017,.042],[.870,.562,.032,.038],
                       [.887,.552,.059,.029]], 5)
    rings = [[(width*math.cos(a)*(1+.22*math.sin(a)), h, z+depth*math.sin(a))
              for a in [k*math.tau/32 for k in range(32)]] for h,z,width,depth in stations]
    mesh('Faired centre leg', *closed_rings(rings), shroud)
    # Moulded landing pads follow the load path as it spreads into the tub.
    for side in (-1, 0, 1):
        rear = side != 0
        rings = []
        for h,scale in [(0,1),(.008,.97),(.016,.80),(.025,.62)]:
            rings.append([(side*.318+scale*(.058 if rear else .073)*math.cos(a),
                           (.641 if rear else .619)+h,
                           (-.535 if rear else .675)+scale*(.091 if rear else .102)*math.sin(a))
                          for a in (i*math.tau/32 for i in range(32))])
        mesh('Halo mounting collar',*closed_rings(rings), carbon)
    for side in [-1,1]:
        for z in [-.570,-.498]:
            x = side*.322
            rod('Rear halo mounting washer',(x,.647,z),(x,.651,z),.007,titanium,vertices=16)
            rod('Socket recess',(x,.651,z),(x,.652,z),.003,cavity,vertices=6)


def fit_glove_skin(hand, suffix, shells, paths, fabric, leather, mesh):
    # Fuse the thumb web and all four knuckle roots into the same textile
    # volume. The individual fingers still have their own weighted joints.
    bpy.context.view_layer.update()
    to_hand=hand.matrix_world.inverted()
    verts=[];faces=[]
    for obj in shells:
        transform=to_hand@obj.matrix_world
        offset=len(verts)
        verts.extend(transform@v.co for v in obj.data.vertices)
        faces.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
    # The woven fabric carries the pigment field on its actual vertices.
    shader=fabric.node_tree.nodes.get('Principled BSDF')
    ink=fabric.node_tree.nodes.get('Racing glove pigment')
    if ink is None:
        ink=fabric.node_tree.nodes.new('ShaderNodeVertexColor');ink.name='Racing glove pigment';ink.layer_name='Racewear'
        fabric.node_tree.links.new(ink.outputs['Color'],shader.inputs['Base Color'])
    skin=mesh('Continuous glove '+suffix,verts,faces,fabric,hand)
    for obj in shells:bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.view_layer.objects.active=skin
    fuse=skin.modifiers.new('Tailored one-piece shell','REMESH')
    fuse.mode='VOXEL';fuse.voxel_size=.0017;fuse.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=fuse.name)
    smooth=skin.modifiers.new('Blend finger webs','SMOOTH');smooth.factor=.82;smooth.iterations=4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    reduce=skin.modifiers.new('Preserve knuckle profile','DECIMATE');reduce.ratio=.193
    bpy.ops.object.modifier_apply(modifier=reduce.name)
    side=-1 if suffix=='L' else 1
    colors=skin.data.color_attributes.new(name='Racewear',type='BYTE_COLOR',domain='POINT')
    def smooth(lo,hi,x):
        t=min(1,max(0,(x-lo)/(hi-lo)));return t*t*(3-2*t)
    def mix(a,b,t):return [aa+(bb-aa)*t for aa,bb in zip(a,b)]
    # Dye, suede and cuff print share the exact skinned surface. The moving
    # thumb web cannot clip through a floating overlay.
    for vertex in skin.data.vertices:
        x,y,z=vertex.co;x*=side
        wrist_y=-.062+.057*smooth(-.105,-.022,z)
        angle=math.atan2((y-wrist_y)/.044,(x-.209)/.033)
        palm=smooth(-.004,.020,z)*.88
        edge=(1-smooth(.05,.17,abs(angle+1.29)-.56))*smooth(-.102,-.089,z)
        cuff=1-smooth(-.094,-.085,z+.006*math.sin(angle))
        base=mix((.69,.16,.20),(.19,.17,.19),max(palm,edge,cuff*.89))
        # A narrow cream bias binding follows the cuff, while the inner palm
        # has darker silicone contact pads around the curled finger tips.
        piping=1-smooth(.0004,.0019,abs(z+.092+.006*math.sin(angle)))
        colors.data[vertex.index].color_srgb=(*mix(base,(.84,.83,.78),piping*.84),1)
    skin.data.materials.append(leather)
    for face in skin.data.polygons:
        face.use_smooth=True
        if face.center.z>.015 and face.normal.z>.28:face.material_index=1
    bpy.context.view_layer.update()
    for trim in list(hand.children_recursive):
        if trim==skin:continue
        transform=to_hand@trim.matrix_world;inverse=transform.inverted()
        if trim.type=='CURVE':
            for spline in trim.data.splines:
                for knot in spline.bezier_points:
                    ok,point,normal,_=skin.closest_point_on_mesh(transform@knot.co)
                    if ok:knot.co=inverse@(point+normal*.00060)
            continue
        if trim.type!='MESH':continue
        for vertex in trim.data.vertices:
            ok,point,normal,_=skin.closest_point_on_mesh(transform@vertex.co)
            if ok:vertex.co=inverse@(point+normal*.00105)
        trim.data.update()

    # Bind the piping and printed trim to the same skin as the shell. Their
    # cuff ends must move with the wrist and their knuckle ends with the palm.
    trims=[o for o in hand.children_recursive if o!=skin and o.type in {'MESH','CURVE'}]
    for trim in trims:
        if trim.type=='CURVE':
            bpy.ops.object.select_all(action='DESELECT');trim.select_set(True)
            bpy.context.view_layer.objects.active=trim;bpy.ops.object.convert(target='MESH')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [skin]+trims:obj.select_set(True)
    bpy.context.view_layer.objects.active=skin;bpy.ops.object.join()
    rig_data=bpy.data.armatures.new('Glove skeleton '+suffix)
    rig=bpy.data.objects.new('GloveRig'+suffix,rig_data)
    bpy.context.collection.objects.link(rig);rig.parent=hand
    skin.parent=rig
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    root=rig_data.edit_bones.new('Palm'+suffix);root.head=(0,0,0);root.tail=(0,.035,0)
    carpal=Vector((side*.208,-.033,-.059))
    wrist=rig_data.edit_bones.new('Wrist'+suffix)
    wrist.head=carpal;wrist.tail=carpal+Vector((0,.025,0));wrist.parent=root
    names=[]
    for digit,path in enumerate(paths):
        name='Finger'+suffix+str(digit);names.append(name)
        bone=rig_data.edit_bones.new(name);bone.head=path[0];bone.tail=path[0]+Vector((0,.026,0));bone.parent=root
    bpy.ops.object.mode_set(mode='OBJECT')
    palm=skin.vertex_groups.new(name='Palm'+suffix)
    gauntlet=skin.vertex_groups.new(name='Wrist'+suffix)
    joints=[skin.vertex_groups.new(name=name) for name in names]
    from mathutils.kdtree import KDTree
    points=[(digit,i/(len(path)-1),point) for digit,path in enumerate(paths) for i,point in enumerate(path)]
    tree=KDTree(len(points))
    for i,(_,_,point) in enumerate(points):tree.insert(point,i)
    tree.balance()
    for vertex in skin.data.vertices:
        _,i,distance=tree.find(vertex.co);digit,t,_=points[i]
        mix=min(1,max(0,(t-.07)/.48))*min(1,max(0,(.030-distance)/.011))
        mix=mix*mix*(3-2*mix)
        # A smooth bend through the wrist. The entire gauntlet mouth follows
        # the forearm. Finger contact surfaces remain attached to the wheel.
        cuff=(1-mix)*(1-smooth(-.091,-.048,vertex.co.z))
        # Flare the gauntlet mouth over the sleeve; keep wrist weights on the
        # existing pivot so the fingers and grip are unaffected at full lock.
        hem=(1-smooth(-.105,-.087,vertex.co.z))*cuff
        vertex.co.x+=(vertex.co.x-side*.215)*.10*hem
        vertex.co.y+=(vertex.co.y+.062)*.10*hem
        vertex.co.z-=.012*hem
        if cuff>0:gauntlet.add([vertex.index],cuff,'REPLACE')
        if 1-mix-cuff>1e-6:palm.add([vertex.index],1-mix-cuff,'REPLACE')
        if mix>0:joints[digit].add([vertex.index],mix,'REPLACE')
    modifier=skin.modifiers.new('Finger articulation','ARMATURE');modifier.object=rig
    return rig

def build_driver(group, mesh, curve, interp, steer, body, materials):
    fabric, insert, leather, thread, suit = materials
    hands = group('Hands')
    hands.parent = steer
    for side, suffix in [(-1,'L'),(1,'R')]:
        hand = group('Hand'+suffix)
        hand.parent = hands
        # Retain adult hand proportions on a compact Formula wheel.
        hand.scale=(1/.85,1/.9,1)
        hand.location=(side*.205*(1-1/.85),0,0)
        # Sections run fore-aft, from the open gauntlet to the metacarpal heads.
        # Width grows mainly in Y because the palm faces the inside of the rim.
        stations = interp([
            [-.104,.215,-.062,.036,.032],[-.100,.215,-.060,.036,.033],
            [-.087,.213,-.053,.029,.032],[-.073,.208,-.040,.031,.039],
            [-.057,.207,-.023,.034,.048],[-.042,.207,-.011,.030,.049],
            [-.029,.210,-.006,.025,.046],[-.019,.210,-.004,.021,.042],
            [-.013,.211,-.008,.015,.033]],4)
        def backhand_point(station, angle, ease=0):
            z,x,y,rx,ry = station
            c,s = math.cos(angle),math.sin(angle)
            # Swept dorsal seam follows the rise of the index metacarpal.
            # Four dorsal ridges follow the flexed metacarpals beneath the fabric.
            width=ry*rounded(s,.84)
            tendon=math.exp(-((z+.044)/.028)**2)*max(0,c)*.0027*math.cos((width+.008)*math.tau/.020)
            return (side*(x+rounded(c,.84)*(rx+ease)+.006*s+tendon),
                    y+rounded(s,.84)*(ry+ease), z-.012*s)
        rings = [[backhand_point(row, k*math.tau/32) for k in range(32)] for row in stations]
        glove = mesh('Precurved gauntlet', *closed_rings(rings), fabric, hand)
        shells=[glove];paths=[]
        def seam(name,points,radius,material,parent):
            detail=curve(name,points,radius,material,parent)
            detail.data.resolution_u=3
            detail.data.bevel_resolution=1
        for angle in [.70, 2.05, 5.22]:
            seam('Gauntlet piping',[backhand_point(row,angle,.0006) for row in stations[1:-3:3]],.0007,thread,hand)

        # Contrasting, curved backhand insert and two printed chevrons. Sample
        # the shell parametrically to keep every applique on the textile.
        # Each curved dart follows a distinct metacarpal on the knuckle fan.
        for dart,angle in enumerate([-.83,-.28,.22,.78]):
            seam('Metacarpal gusset',[backhand_point(row,angle+.13*t,.0008)
                 for t,row in enumerate(stations[15+dart:30:3])],.00065,leather,hand)
        # A small three-stroke screen print bends with the back of the glove.
        # Project its strips against the local palm, viewed from the driver's seat.
        forward=Vector((side*.20,.68,-.71)).normalized()
        right=Vector((1,0,0))
        right=(right-forward*forward.dot(right)).normalized()
        up=forward.cross(right).normalized()
        mark_centre=Vector((side*.210,-.026,-.065))
        # A printed wing mark spans the actual dorsum, with tapered strokes
        # wrapping over the textile. Per-vertex projection follows the folds.
        for stroke in range(2):
            verts=[];faces=[]
            for j in range(13):
                t=j/12
                for edge in [-1,1]:
                    stripe=.0027*(1-.66*t)
                    xy=right*(side*(t-.5)*.042)+up*((stroke-.5)*.0085+.014*(abs(t-.32)-.20)+edge*stripe)
                    ok,co,n,_=glove.ray_cast(mark_centre+xy+forward*.12,-forward)
                    if not ok:break
                    verts.append(co+forward*.0015)
                if len(verts)!=2*(j+1):break
                if j:faces.append((2*j-2,2*j-1,2*j+1,2*j))
            if faces:mesh('Dorsal screen print',verts,faces,thread,hand)
        # A broad gusset connects the thumb saddle to the index metacarpal.
        # The thumb emerges from a web of fabric, with a gap at the fingertip.
        web=interp([[-.082,.201,-.043,.017,.019],[-.068,.192,-.030,.022,.029],
                    [-.053,.187,-.017,.024,.032],[-.041,.186,-.010,.018,.028],
                    [-.030,.187,-.004,.012,.019]],3)
        rings=[[(side*(x+rx*math.cos(a)),y+ry*math.sin(a),z-.007*math.sin(a))
                for a in [k*math.tau/24 for k in range(24)]] for z,x,y,rx,ry in web]
        shells.append(mesh('Thumb saddle gusset',*closed_rings(rings),fabric,hand))
        # Visible lockstitch uses short lengths with tiny gaps along the inset.
        for j in range(4,20,2):
            t=(j-4)/17
            angle=.94+.83*math.sin(t*math.pi)
            seam('Inset lockstitch',[backhand_point(stations[j],angle,.0010),
                 backhand_point(stations[j+1],angle,.0010)],.00040,thread,hand)
        for digit in range(5):
            finger=group('FingerTrim'+suffix+str(digit))
            finger.parent=hand
            if digit<4:
                y=[.030,.009,-.012,-.031][digit]
                # A pre-curved phalanx profile follows the actual outer grip.
                # Shorter ring and little fingers curl less far around the back.
                h=[1,1,.92,.79][digit];end=[1,.98,.84,.63][digit]
                points=[[.207,y,-.055,.015*h,.012*h],[.221,y+.002,-.038,.014*h,.012*h],
                        [.230,y+.002,-.022,.013*h,.011*h],[.237,y+.001,-.005,.012*h,.011*h],
                        [.232,y,.015,.011*h,.010*h],[.215,y-.001,.027,.011*h,.010*h],
                        [.205-.010*end,y-.002,.026,.010*h,.009*h],
                        [.202-.015*end,y-.003,.018,.009*h,.008*h],
                        [.201-.017*end,y-.003,.009,.006*h,.006*h]]
            else:
                points=[[.200,-.046,-.070,.020,.017],[.189,-.031,-.058,.018,.016],
                        [.177,-.017,-.049,.016,.014],[.167,-.004,-.043,.014,.012],
                        [.159,.006,-.037,.013,.011],[.154,.011,-.029,.011,.009],
                        [.153,.012,-.024,.006,.005]]
            points=interp(points,3)
            paths.append([Vector((side*x,y,z)) for x,y,z,_,_ in points])
            root=paths[-1][0]
            finger.location=root
            rings=[]
            for i,(x,y,z,rx,ry) in enumerate(points):
                before,after=points[max(0,i-1)],points[min(len(points)-1,i+1)]
                along=Vector((side*(after[0]-before[0]),after[1]-before[1],after[2]-before[2])).normalized()
                across=along.cross(Vector((0,1,0))).normalized()
                up=along.cross(across).normalized()
                centre=Vector((side*x,y,z))-root
                ring=[centre+across*(rx*rounded(math.cos(k*math.tau/16),.82))+
                      up*(ry*rounded(math.sin(k*math.tau/16),.82)) for k in range(16)]
                rings.append(ring)
            part=mesh('Curled digit',*closed_rings(rings),fabric,finger)
            shells.append(part)
            edge=3 if side>0 else 11
            seam('External finger seam',[ring[edge] for ring in rings[1:-1:2]],.0006,thread,finger)

        rig=fit_glove_skin(hand,suffix,shells,paths,fabric,leather,mesh)
        cuff=group('Cuff'+suffix);cuff.parent=rig
        cuff.parent_type='BONE';cuff.parent_bone='Wrist'+suffix
        bpy.context.view_layer.update()
        cuff.matrix_world=hand.matrix_world@Matrix.Translation((side*.215,-.062,-.104))

        # Rigid anatomical segments, authored at final physical length. Only the
        # elbow joint moves as the wheel turns. No longitudinal sleeve scaling.
        shoulder=Vector((side*.168,.501,-.366))
        wrist=Vector((side*(.208-.205*(1-.85)),-.033,-.059))+steer.location
        upper_length,fore_length=.291,.290
        along=(wrist-shoulder).normalized()
        reach=(wrist-shoulder).length
        pole=Vector((side*.218,.180,-.20))-shoulder
        natural=(pole-along*pole.dot(along)).normalized()
        dorsal=Vector((-side*.007,.029,.045)).normalized()
        aligned=(-dorsal+along*dorsal.dot(along)).normalized()
        bend=(natural*.30+aligned*.70).normalized()
        advance=(upper_length**2+reach**2-fore_length**2)/(2*reach)
        elbow=shoulder+along*advance+bend*math.sqrt(max(0,upper_length**2-advance**2))
        sections=[
            ('UpperArm',shoulder,elbow,upper_length,[[0,.051,.050],[.12,.061,.057],[.46,.054,.054],[.82,.051,.047],[.98,.047,.045],[1.04,.033,.032]]),
            ('Forearm',elbow,wrist,fore_length,[[-.06,.033,.032],[.03,.046,.044],[.15,.052,.050],[.39,.048,.046],[.61,.041,.040],[.78,.034,.033],[.87,.027,.026],[1,.016,.015]])]
        for name,start,end,length,profile in sections:
            arm=group(name+suffix);arm.parent=body
            rings=[]
            for t,rx,rz in interp(profile,7):
                ring=[]
                for k in range(32):
                    a=k*math.tau/32
                    wrinkle=.0032*math.sin(t*44+2.3*math.sin(a)+side*.9)*(.35+.65*math.cos(t*math.pi)**2)
                    ring.append(((rx+wrinkle)*math.cos(a),t*length,(rz+wrinkle)*math.sin(a)))
                rings.append(ring)
            outer=mesh('Tailored '+name,*closed_rings(rings),suit,arm)
            outer.data.materials.append(insert)
            for face in outer.data.polygons:
                row,col=divmod(face.index,32)
                if col in [2,3,4] and row<len(rings)-1:face.material_index=1
            # Outside seam and a wide flat suit panel, following each sleeve
            # ring so neither the piping nor a printed stripe floats at lock.
            for col in [1,6]:
                seam('Sleeve flatlock',[ring[col] for ring in rings[::2]],.0008,thread,arm)
            arm.location=start
            arm.rotation_euler=(end-start).to_track_quat('Y','Z').to_euler()
