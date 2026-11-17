"""Cockpit components in metres, X across the car, Y up, Z forward."""
import math
from mathutils import Vector


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
    mesh('Halo', *closed_rings(rings), carbon)

    # The front leg flares beneath the junction and sits on a teardrop foot.
    stations = interp([[.601,.679,.042,.080],[.622,.671,.040,.070],
                       [.657,.667,.020,.046],[.748,.631,.014,.045],
                       [.838,.586,.017,.042],[.870,.562,.032,.038],
                       [.887,.552,.059,.029]], 5)
    rings = [[(width*math.cos(a)*(1+.22*math.sin(a)), h, z+depth*math.sin(a))
              for a in [k*math.tau/32 for k in range(32)]] for h,z,width,depth in stations]
    mesh('Faired centre leg', *closed_rings(rings), carbon)
    for side in [-1,1]:
        for z in [-.570,-.498]:
            x = side*.322
            rod('Rear halo mounting washer',(x,.647,z),(x,.651,z),.007,titanium,vertices=16)
            rod('Socket recess',(x,.651,z),(x,.652,z),.003,cavity,vertices=6)


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
            [-.128,.219,-.078,.032,.033],[-.121,.218,-.075,.032,.034],
            [-.090,.212,-.054,.027,.029],[-.073,.207,-.040,.028,.036],
            [-.057,.205,-.026,.029,.043],[-.042,.207,-.015,.025,.044],
            [-.029,.210,-.009,.021,.042],[-.019,.210,-.007,.018,.039],
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
        glove.data.materials.append(leather)
        glove.data.materials.append(insert)
        for face in glove.data.polygons:
            row,col = divmod(face.index,32)
            if row >= len(stations)-1: continue
            z = stations[row][0]
            # Suede palm, stretch gusset at wrist and a woven cuff binding.
            if math.cos((col+.5)*math.tau/32)<-.40: face.material_index=1
            if -.095<z<-.091 or z<-.123: face.material_index=2
        def seam(name,points,radius,material,parent):
            detail=curve(name,points,radius,material,parent)
            detail.data.resolution_u=3
            detail.data.bevel_resolution=1
        for angle in [.70, 2.05, 5.22]:
            seam('Gauntlet piping',[backhand_point(row,angle,.0006) for row in stations[1:-3:3]],.0007,thread,hand)

        # Contrasting, curved backhand insert and two printed chevrons. Sample
        # the shell parametrically to keep every applique on the textile.
        def applique(label,rows,angle_limits,material):
            points=[];faces=[]
            for i,row in enumerate(rows):
                lo,hi=angle_limits(i/(len(rows)-1))
                for j in range(11):
                    points.append(backhand_point(row,lo+(hi-lo)*j/10,.00055))
                if i:
                    for j in range(10):
                        k=(i-1)*11+j
                        faces.append((k,k+1,k+12,k+11))
            return mesh(label,points,faces,material,hand)
        applique('Dorsal suede inset',stations[4:22],
                 lambda t:(.30+.35*t,.94+.83*math.sin(t*math.pi)),leather)
        for start in [10,14]:
            applique('Printed cuff chevron',stations[start:start+3],
                     lambda t:(1.72+t*.20,2.9+t*.20),insert)
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
        for stroke in range(3):
            verts=[];faces=[]
            for j in range(7):
                t=j/6
                for edge in [-1,1]:
                    xy=right*((t-.5)*.018 + .0014*edge)+up*((stroke-1)*.0033+(t-.5)*.006)
                    ok,co,n,_=glove.ray_cast(mark_centre+xy+forward*.10,-forward)
                    if not ok:break
                    verts.append(co+forward*.0010)
                if len(verts)!=2*(j+1):break
                if j:faces.append((2*j-2,2*j-1,2*j+1,2*j))
            if faces:mesh('Cuff racing print',verts,faces,thread,hand)
        # Visible lockstitch uses short lengths with tiny gaps along the inset.
        for j in range(4,20,2):
            t=(j-4)/17
            angle=.94+.83*math.sin(t*math.pi)
            seam('Inset lockstitch',[backhand_point(stations[j],angle,.0010),
                 backhand_point(stations[j+1],angle,.0010)],.00040,thread,hand)
        for digit in range(5):
            finger=group('Finger'+suffix+str(digit))
            finger.parent=hand
            if digit<4:
                y=.027-digit*.0215
                length=[1,1.04,.98,.84][digit]
                start=.215-.0015*digit
                points=[[start,y,-.062+digit*.001,.014,.012],
                        [start+.016,y+.002,-.050,.0125,.011],
                        [start+.026,y+.003,-.026,.0115,.010],
                        [start+.027,y-.001,.003,.012,.010],
                        [start+.012,y-.004,.021,.011,.0095],
                        [start-.008*length,y-.007,.032,.010,.009],
                        [start-.029*length,y-.009,.025,.009,.008],
                        [start-.034*length,y-.009,.022,.004,.005]]
            else:
                points=[[.202,-.048,-.071,.019,.016],[.187,-.033,-.061,.016,.014],
                        [.177,-.014,-.044,.015,.012],[.171,.003,-.039,.013,.011],
                        [.164,.013,-.035,.012,.010],[.158,.015,-.029,.010,.008],
                        [.155,.015,-.023,.004,.004]]
            points=interp(points,3)
            root=Vector((side*points[0][0],*points[0][1:3]))
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
            part.data.materials.append(leather)
            part.data.materials.append(insert)
            for face in part.data.polygons:
                row,col=divmod(face.index,16)
                if row>=len(rings)-1:continue
                if math.cos((col+.5)*math.tau/16)*side<-.30 and row>4:face.material_index=1
                if row in (6,12) and face.material_index==0:face.material_index=2
            edge=3 if side>0 else 11
            seam('External finger seam',[ring[edge] for ring in rings[1:-1:2]],.0006,thread,finger)

        arm=group('Forearm'+suffix)
        arm.parent=body
        # The posed sleeve ends inside the cuff. Wrinkles are formed in the
        # same surface, so they remain attached when the arm follows the wheel.
        profile=interp([[0,.049,.048],[.15,.052,.049],[.40,.048,.045],
                        [.68,.039,.039],[.86,.034,.034],[1,.030,.031]],8)
        rings=[]
        for t,rx,rz in profile:
            ring=[]
            for k in range(32):
                a=k*math.tau/32
                wrinkle=.0030*math.sin(t*59+2.5*math.sin(a)+side*.9)*(.3+.7*t)
                ring.append(((rx+wrinkle)*math.cos(a),t,(rz+wrinkle)*math.sin(a)))
            rings.append(ring)
        outer=mesh('Woven suit sleeve',*closed_rings(rings),suit,arm)
        outer.data.materials.append(insert)
        for face in outer.data.polygons:
            row,col=divmod(face.index,32)
            if col in [2,3] and row<len(profile)-1:face.material_index=1
        elbow=Vector((side*.25,.31,-.23))
        wrist=Vector((side*(.216-.205*(1-.85)),-.071,-.117))+steer.location
        delta=wrist-elbow
        arm.location=elbow
        arm.rotation_euler=delta.to_track_quat('Y','Z').to_euler()
        arm.scale.y=delta.length
