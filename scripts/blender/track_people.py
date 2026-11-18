"""Shared trackside figures. Local +Y is up and +Z faces the circuit.
UV.x identifies the head, signalling arm and flag. UV.y measures cloth span.
"""
import bpy
import math
from mathutils import Vector

def staff_mesh(role, material, kit):
    positions, faces, colours, controls = [], [], [], []
    navy=(.023,.039,.06); boot=(.021,.024,.029); silver=(.69,.73,.67)
    skin=(.43,.25,.15); visor=(.031,.054,.066)
    signaller=role in ('marshal','finish')
    suit=(.94,.125,.012) if signaller else kit
    arm=2/3 if role!='observer' else 0

    def vertex(p,colour,group,span=0):
        x,y,z=p
        positions.append((x,-z,y));colours.append((*colour,1));controls.append((group,1-span))
        return len(positions)-1

    def loft(rows,colour,group=0):
        rings=[]
        for x,y,z,rx,rz in rows:
            rings.append([vertex((x+rx*math.cos(k*math.tau/12),y,z+rz*math.sin(k*math.tau/12)),colour,group) for k in range(12)])
        for a,b in zip(rings,rings[1:]):
            for k in range(12):faces.append((a[k],b[k],b[(k+1)%12],a[(k+1)%12]))
        faces.extend([tuple(rings[0]),tuple(reversed(rings[-1]))])

    def limb(a,b,r1,r2,colour,group=0):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized()
        u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u)
        rings=[]
        for t,r in [(0,r1*.82),(.13,r1),(.73,r2*1.06),(1,r2)]:
            rings.append([vertex(a+(b-a)*t+r*(u*math.cos(k*math.tau/10)+v*math.sin(k*math.tau/10)),colour,group) for k in range(10)])
        for a,b in zip(rings,rings[1:]):
            for k in range(10):faces.append((a[k],a[(k+1)%10],b[(k+1)%10],b[k]))
        faces.extend([tuple(reversed(rings[0])),tuple(rings[-1])])

    def badge(cx,y,z,w,h,colour,group=0):
        faces.append(tuple(vertex((cx+dx,y+dy,z),colour,group) for dx,dy in [(-w/2,0),(w/2,0),(w/2,h),(-w/2,h)]))

    for side in [-1,1]:
        x=side*.133;z=.072 if side<0 else -.07
        loft([(x,.012,z+.05,.09,.162),(x,.05,z+.06,.102,.169),(x,.12,z+.03,.088,.135),(x,.17,z,.073,.079)],boot)
        limb((x,.14,z),(x,.53,z+.024),.074,.088,suit)
        limb((x,.51,z+.024),(side*.091,.96,0),.099,.111,suit)
        limb((x,.30,z+.01),(x,.35,z+.012),.079,.081,silver if signaller else navy)
    loft([(0,.83,0,.17,.12),(0,.97,0,.201,.134),(0,1.1,-.008,.176,.113),(0,1.31,0,.223,.154),(0,1.405,0,.224,.129),(0,1.475,0,.075,.072)],suit)
    loft([(0,1.10,-.006,.18,.117),(0,1.149,-.006,.187,.123)],silver if signaller else navy)
    loft([(0,1.463,0,.073,.071),(0,1.531,.01,.067,.061)],skin,1/3)
    loft([(0,1.50,.028,.056,.068),(0,1.55,.03,.088,.088),(0,1.63,.021,.096,.101),(0,1.705,.002,.091,.094),(0,1.73,0,.068,.067)],skin,1/3)
    loft([(0,1.618,.116,.018,.018),(0,1.652,.108,.023,.021)],skin,1/3)
    loft([(0,1.668,.007,.109,.113),(0,1.709,.013,.116,.123),(0,1.765,0,.105,.106),(0,1.793,0,.048,.060)],silver if signaller else navy,1/3)
    for sign in [-1,1]:
        loft([(sign*.097,1.604,0,.025,.038),(sign*.106,1.648,0,.027,.049),(sign*.095,1.685,0,.022,.033)],visor,1/3)
    # Dark orbital band and small features give the gaze a direction from a garage camera.
    for sign in [-1,1]:
        loft([(sign*.042,1.64,.106,.019,.008),(sign*.042,1.65,.109,.021,.009),(sign*.042,1.654,.106,.017,.007)],(.062,.044,.036),1/3)
        limb((sign*.026,1.663,.106),(sign*.063,1.660,.099),.006,.005,navy,1/3)
        limb((sign*.092,1.652,.034),(sign*.086,1.584,.104),.006,.005,navy,1/3)
    limb((.086,1.584,.104),(.040,1.581,.122),.006,.009,boot,1/3)
    # Zipper, chest patches, collar, separate knee reinforcements and shoe soles.
    limb((0,1.13,.126),(0,1.425,.117),.006,.006,navy)
    badge(-.091,1.325,.144,.090,.028,silver);badge(.10,1.305,.143,.061,.045,navy)
    loft([(0,1.437,0,.107,.094),(0,1.484,0,.079,.073)],navy)
    for sign in [-1,1]:
        z=.072 if sign<0 else -.07
        loft([(sign*.13,.443,z+.091,.056,.016),(sign*.13,.52,z+.098,.070,.024),(sign*.13,.587,z+.085,.057,.018)],navy)
        loft([(sign*.133,.005,z+.052,.095,.164),(sign*.133,.032,z+.052,.105,.172)],navy)
    for side in [-1,1]:
        start=(side*.183,1.39,0)
        elbow=(side*.32,1.28,.07) if side==1 and signaller else (side*.239,1.14,.075)
        hand=(.48,1.50,.14) if side==1 and signaller else ((side*.13,1.17,.242) if side==1 else (side*.166,1.305,.25))
        group=arm if side==1 else 0
        limb(start,elbow,.086,.065,suit,group);limb(elbow,hand,.067,.044,suit,group)
        x,y,z=hand;loft([(x,y-.032,z,.043,.042),(x,y+.026,z+.005,.056,.046),(x,y+.070,z,.038,.035)],boot,group)
    if role=='crew':
        # One hand supports the socket gun, the other rests on its grip.
        limb((.142,1.146,.242),(.142,1.276,.265),.025,.031,boot,arm)
        limb((.142,1.267,.207),(.135,1.276,.38),.047,.042,navy,arm)
        limb((.135,1.276,.38),(.130,1.279,.46),.031,.022,silver,arm)
    if role=='observer':
        loft([(-.115,1.25,.115,.04,.03),(-.115,1.34,.12,.038,.03)],boot)
        limb((-.13,1.336,.122),(-.14,1.45,.133),.006,.003,boot)
    if signaller:
        limb((.425,1.44,.14),(1.27,2.30,.14),.015,.014,navy,arm)
        # Subdivided fly with a stitched hoist. Both hoist corners lie on the pole.
        grid=[]
        for j in range(9):
            v=j/8;row=[]
            for k in range(16):
                u=k/15
                p=(1.26-.45*v+.77*u,2.29-.459*v-.27*u+.085*math.sin(7*u+v)*u,.14+.27*u+.096*math.sin(9*u+v)*u)
                row.append(vertex(p,(.013,.45,.065) if k else (.57,.7,.48),1,u))
            grid.append(row)
        for j,(a,b) in enumerate(zip(grid,grid[1:])):
            for k in range(15):
                quad=(a[k],b[k],b[k+1],a[k+1])
                if role=='finish':
                    ink=(.75,.76,.73) if (j//2+k//3)%2 else (.016,.018,.021)
                    copy=[]
                    for i in quad:
                        copy.append(len(positions));positions.append(positions[i]);controls.append(controls[i]);colours.append((*ink,1))
                    quad=tuple(copy)
                faces.append(quad)
    mesh=bpy.data.meshes.new(role.title()+' in coveralls');mesh.from_pydata(positions,[],faces);mesh.materials.append(material);mesh.update()
    colour=mesh.color_attributes.new(name='Uniform and equipment',type='BYTE_COLOR',domain='POINT')
    for i,c in enumerate(colours):colour.data[i].color=c
    uv=mesh.uv_layers.new(name='Articulation')
    for poly in mesh.polygons:
        poly.use_smooth=True
        for li in poly.loop_indices:uv.data[li].uv=controls[mesh.loops[li].vertex_index]
    return mesh
