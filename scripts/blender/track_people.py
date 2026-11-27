"""Shared trackside figures. Local +Y is up and +Z faces the circuit.
UV.x identifies the head, signalling arm and flag. UV.y measures cloth span.
"""
import bpy
import math
from mathutils import Vector

def staff_material(mat, image, layer_name='Uniform and equipment'):
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    image_node=nodes.new('ShaderNodeTexImage');image_node.image=image
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='Artwork';links.new(uv.outputs['UV'],image_node.inputs['Vector'])
    colour=nodes.new('ShaderNodeVertexColor');colour.layer_name=layer_name
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    links.new(colour.outputs['Color'],mix.inputs[1]);links.new(image_node.outputs['Color'],mix.inputs[2])
    links.new(mix.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])

def staff_mesh(role, material, kit, alternate=False):
    positions, faces, colours, controls = [], [], [], []
    artwork=[]
    navy=(.023,.039,.06); boot=(.021,.024,.029); silver=(.69,.73,.67)
    skin=(.43,.25,.15); visor=(.031,.054,.066)
    signaller=role in ('marshal','finish')
    suit=(.94,.125,.012) if signaller else kit
    arm=2/3 if role!='observer' else 0

    def vertex(p,colour,group,span=0,art=(.96,.327)):
        x,y,z=p
        positions.append((x,-z,y));colours.append((*colour,1))
        # The garage shirt uses this spare articulation channel for its team tint.
        uniform_panel=material.name=='GarageUniform' and art[1]<.32 and art[0]>=.613
        controls.append((group,0 if uniform_panel else 1-span))
        artwork.append(((art[0]+int(alternate))*.5,art[1]))
        return len(positions)-1

    def loft(rows,colour,group=0):
        rings=[]
        for x,y,z,rx,rz in rows:
            rings.append([vertex((x+rx*math.cos(k*math.tau/8),y,z+rz*math.sin(k*math.tau/8)),colour,group) for k in range(8)])
        for a,b in zip(rings,rings[1:]):
            for k in range(8):faces.append((a[k],b[k],b[(k+1)%8],a[(k+1)%8]))
        faces.extend([tuple(rings[0]),tuple(reversed(rings[-1]))])

    def limb(a,b,r1,r2,colour,group=0):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized()
        u=axis.cross(Vector((0,0,1))).normalized();v=axis.cross(u)
        rings=[]
        for t,r in ([(0,r1),(.55,(r1+r2)*.52),(1,r2)] if colour==suit else [(0,r1),(1,r2)]):
            rings.append([vertex(a+(b-a)*t+r*(u*math.cos(k*math.tau/6)+v*math.sin(k*math.tau/6)),colour,group,art=(.613+.352*k/6,1-(533+209*t)/768) if colour==suit else (.96,.327)) for k in range(6)])
        for a,b in zip(rings,rings[1:]):
            for k in range(6):faces.append((a[k],a[(k+1)%6],b[(k+1)%6],b[k]))
        faces.extend([tuple(reversed(rings[0])),tuple(rings[-1])])

    def panel(cx,y,width,height,row):
        # The embroidery follows the domed chest instead of bridging the zipper.
        base=526+79*row
        rings=[]
        for j in range(2):
            strip=[]
            for k in range(7):
                x=cx+width*(k/6-.5)
                z=.006+.154*math.sqrt(max(0,1-(x/.223)**2))
                strip.append(vertex((x,y+j*height,z),(.95,.95,.95),0,art=((10+282*k/6)/512,1-(base+64-j*61)/768)))
            rings.append(strip)
        for k in range(6):faces.append((rings[0][k],rings[0][k+1],rings[1][k+1],rings[1][k]))

    def coverall():
        # Uneven bias creases gather at the waistband. Padding smooths out at the shoulders.
        profile=[(.83,.17,.12),(.97,.20,.135),(1.10,.18,.12),(1.25,.209,.147),(1.32,.224,.153),(1.405,.218,.13),(1.475,.075,.072)]
        prev=None
        for j in range(10):
            y=.83+j*(1.475-.83)/9
            k=next((k for k in range(len(profile)-1) if y<=profile[k+1][0]),len(profile)-2)
            ay,ax,az=profile[k];by,bx,bz=profile[k+1];f=(y-ay)/(by-ay)
            rx=ax+(bx-ax)*f;rz=az+(bz-az)*f;ring=[]
            for n in range(12):
                a=n*math.tau/12
                fold=.0075*math.exp(-((y-1.13)/.115)**2)*math.sin(y*105+2.2*math.sin(2*a))+.0034*math.sin(a*9+y*18)
                tint=1+.11*fold/.01;cloth=navy if y>=1.425 else suit
                ring.append(vertex(((rx+fold)*math.cos(a),y,(rz+fold)*math.sin(a)),tuple(v*tint for v in cloth),0,art=(.613+.352*n/12,1-(533+209*j/9)/768)))
            if prev:
                for n in range(12):faces.append((prev[n],ring[n],ring[(n+1)%12],prev[(n+1)%12]))
            prev=ring
    def face_projection():
        # Jaw, zygomatic arches, brow ridge, eye sockets, nasal bridge, lips and chin.
        profile=[(1.501,.044,.057),(1.518,.064,.079),(1.547,.081,.090),(1.586,.091,.098),(1.624,.099,.103),(1.672,.097,.105),(1.721,.088,.101),(1.754,.072,.084)]
        prev=None
        for j in range(10):
            y=1.501+.253*j/9
            k=next((k for k in range(len(profile)-1) if y<=profile[k+1][0]),len(profile)-2)
            ay,ax,az=profile[k];by,bx,bz=profile[k+1];f=(y-ay)/(by-ay)
            rx=ax+(bx-ax)*f;rz=az+(bz-az)*f;ring=[]
            for n in range(14):
                a=math.tau*n/14;c=math.cos(a);x=rx*math.sin(a)
                def bump(cx,cy,w,h):return math.exp(-((abs(x)-cx)/w)**2-((y-cy)/h)**2)
                shape=.032*bump(0,1.597,.017,.031)+.016*bump(0,1.632,.011,.042)+.009*bump(.021,1.594,.010,.009)-.009*bump(.042,1.649,.022,.012)+.008*bump(.050,1.671,.033,.010)+.01*bump(.057,1.612,.032,.015)+.007*bump(0,1.557,.040,.013)+.008*bump(0,1.522,.026,.014)
                z=.014+rz*c+max(c,0)**1.3*shape
                u=.5+x/.099*.33
                v=.977-(y-1.501)*3.5
                if c<0:u=.78 if x>0 else .22;v=.14
                ring.append(vertex((x,y,z),(.97,.94,.94),1/3,art=(u,1-v*512/768)))
            if prev:
                for n in range(14):faces.append((prev[n],prev[(n+1)%14],ring[(n+1)%14],ring[n]))
            prev=ring
    for side in [-1,1]:
        x=side*.133;z=.072 if side<0 else -.07
        loft([(x,.012,z+.05,.09,.162),(x,.05,z+.06,.102,.169),(x,.12,z+.03,.088,.135),(x,.17,z,.073,.079)],boot)
        limb((x,.14,z),(x,.53,z+.024),.074,.088,suit)
        limb((x,.51,z+.024),(side*.092,.91,0),.099,.091,suit)
        limb((x,.30,z+.01),(x,.35,z+.012),.079,.081,silver if signaller else navy)
    coverall()
    loft([(0,1.10,-.006,.18,.117),(0,1.149,-.006,.187,.123)],silver if signaller else navy)
    loft([(0,1.463,0,.073,.071),(0,1.531,.01,.067,.061)],skin,1/3)
    face_projection()
    # A stitched peak projects forward of the curved crown.
    rows=[]
    for j in range(4):
        row=[]
        for k in range(13):
            xx=(k-6)/6;zz=.074+.091*(j/3)*(1-.42*xx*xx)
            row.append(vertex((xx*(.090+.014*j/3),1.699+.012*(1-xx*xx)-.014*j/3,zz),navy,1/3))
        rows.append(row)
    for a,b in zip(rows,rows[1:]):
        for k in range(12):faces.append((a[k],a[k+1],b[k+1],b[k]))
    loft([(0,1.697,.007,.109,.113),(0,1.72,.013,.116,.123),(0,1.765,0,.105,.106),(0,1.793,0,.048,.060)],silver if signaller else navy,1/3)
    for sign in [-1,1]:
        loft([(sign*.097,1.604,0,.025,.038),(sign*.106,1.648,0,.027,.049),(sign*.095,1.685,0,.022,.033)],visor,1/3)
    # Dark orbital band and small features give the gaze a direction from a garage camera.
    for sign in [-1,1]:
        limb((sign*.092,1.652,.034),(sign*.086,1.584,.104),.006,.005,navy,1/3)
    limb((.086,1.584,.104),(.040,1.581,.122),.006,.009,boot,1/3)
    # Zipper, chest patches, collar, separate knee reinforcements and shoe soles.
    zip_curve=[(0,1.143,.131),(0,1.204,.143),(0,1.27,.154),(0,1.32,.158),(0,1.363,.150),(0,1.403,.136),(0,1.444,.10)]
    for a,b in zip(zip_curve,zip_curve[1:]):limb(a,b,.004,.004,navy)
    panel(-.093,1.319,.113,.033,2 if signaller else 0);panel(.095,1.312,.110,.034,2 if signaller else 1)
    for side in [-1,1]:
        # Bound pocket welt, seam piping and the stitched shoulder yoke.
        limb((side*.035,1.365,.151),(side*.149,1.370,.116),.0038,.003,silver)
        limb((side*.149,1.370,.116),(side*.203,1.394,.058),.003,.003,navy)
        limb((side*.153,1.20,.099),(side*.107,1.155,.111),.005,.0035,navy)
    limb((.007,1.409,.131),(.012,1.386,.139),.007,.005,silver)
    loft([(0,1.473,0,.076,.072),(0,1.490,0,.077,.074)],navy)
    for sign in [-1,1]:
        z=.072 if sign<0 else -.07
        loft([(sign*.13,.443,z+.091,.056,.016),(sign*.13,.52,z+.098,.070,.024),(sign*.13,.587,z+.085,.057,.018)],navy)
        loft([(sign*.133,.005,z+.052,.095,.164),(sign*.133,.032,z+.052,.105,.172)],navy)
    for side in [-1,1]:
        start=(side*.183,1.39,0)
        elbow=(side*.32,1.28,.07) if side==1 and signaller else (side*.239,1.14,.075)
        hand=(.48,1.50,.14) if side==1 and signaller else ((side*.13,1.17,.242) if side==1 else (side*.166,1.305,.25))
        if role=='crew' and side<0:hand=(-.027,1.241,.328);elbow=(-.242,1.151,.088)
        if alternate:
            elbow=(side*.258,1.17,.018) if side<0 else (.28,1.40,.13)
            hand=(-.155,1.05,.106) if side<0 else (.115,1.616,.068)
        group=arm if side==1 else 0
        limb(start,elbow,.086,.065,suit,group);limb(elbow,hand,.067,.044,suit,group)
        x,y,z=hand;loft([(x,y-.032,z,.043,.042),(x,y+.026,z+.005,.056,.046),(x,y+.070,z,.038,.035)],boot,group)
        # Thumb gusset and four bent fingers gripping the handle.
        limb((x-side*.023,y+.008,z+.015),(x-side*.046,y+.038,z+.048),.017,.012,boot,group)
        for digit in range(4):
            fx=x+side*(digit-1.5)*.018
            limb((fx,y+.041,z+.024),(fx,y+.032,z+.052),.012,.009,boot,group)
            limb((fx,y+.032,z+.052),(fx,y+.014,z+.052),.009,.008,navy,group)
    if role=='crew' and not alternate:
        # One hand supports the socket gun, the other rests on its grip.
        limb((.130,1.145,.238),(.117,1.262,.258),.025,.033,boot,arm)
        a=Vector((.170,1.262,.236));b=Vector((-.078,1.268,.361));axis=(b-a).normalized()
        limb(a,b,.047,.039,navy,arm)
        tip=b+.060*axis
        # Through-bore and hex flats on the socket are visible in the close camera.
        u=axis.cross(Vector((0,1,0))).normalized();v=axis.cross(u);rr=[]
        for centre,rad,col in [(b,.031,silver),(tip,.031,silver),(tip,.020,boot),(tip-.039*axis,.020,boot)]:
            rr.append([vertex(centre+rad*(u*math.cos(k*math.tau/6)+v*math.sin(k*math.tau/6)),col,arm) for k in range(6)])
        for x1,x2 in zip(rr,rr[1:]):
            for k in range(6):faces.append((x1[k],x1[(k+1)%6],x2[(k+1)%6],x2[k]))
        faces.append(tuple(rr[-1]))
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
                        copy.append(len(positions));positions.append(positions[i]);controls.append(controls[i]);artwork.append(artwork[i]);colours.append((*ink,1))
                    quad=tuple(copy)
                faces.append(quad)
    mesh=bpy.data.meshes.new(role.title()+' in coveralls');mesh.from_pydata(positions,[],faces);mesh.materials.append(material);mesh.update()
    colour=mesh.color_attributes.new(name='Uniform and equipment',type='BYTE_COLOR',domain='POINT')
    for i,c in enumerate(colours):colour.data[i].color=c
    uv=mesh.uv_layers.new(name='Articulation')
    for poly in mesh.polygons:
        poly.use_smooth=True
        for li in poly.loop_indices:uv.data[li].uv=controls[mesh.loops[li].vertex_index]
    art=mesh.uv_layers.new(name='Artwork')
    for loop in mesh.loops:art.data[loop.index].uv=artwork[loop.vertex_index]
    mesh.uv_layers.active_index=0
    return mesh
