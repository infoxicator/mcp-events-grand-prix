"""Shared crowd silhouettes, in local metres above the seat surface."""
import bpy,math
from mathutils import Vector

def spectator_mesh(material,pose):
    verts=[];faces=[];colors=[];tags=[];art=[]
    up=pose in (6,7,10)
    hips=Vector((0,.65 if up else .16,0))
    lean=[.02,.14,.03,-.055,.12,.07,.02,.03,-.055,.08,.015,.05][pose]
    twist=[-.08,.02,.1,-.40,.14,.09,-.22,.12,.43,.0,.21,-.22][pose]
    def vert(p,tone,group,head=False,uv=(.95,.018)):
        x,y,z=p;verts.append((x,-z,y));colors.append((*tone,1));tags.append((group/5,1-float(head)));art.append((.33,1-.61*256/544) if group==1 and not head else uv);return len(verts)-1
    def link(rings):
        for a,b in zip(rings,rings[1:]):
            for k in range(len(a)):faces.append((a[k],a[(k+1)%len(a)],b[(k+1)%len(a)],b[k]))
        faces.append(tuple(reversed(rings[0])));faces.append(tuple(rings[-1]))
    def tube(a,b,ra,rb,group,col):
        a,b=Vector(a),Vector(b);axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
        if u.length<.01:u=axis.cross(Vector((1,0,0)))
        u.normalize();v=axis.cross(u)
        link([[vert(a+(b-a)*t+(u*math.cos(k*math.tau/7)+v*math.sin(k*math.tau/7))*r,col,group) for k in range(7)] for t,r in [(0,ra),(.55,(ra+rb)*.55),(1,rb)]])
    def shape(rows,group,col,upper=False,head=False):
        rings=[]
        for x,y,z,rx,rz in rows:
            ring=[]
            for k in range(10):
                a=-k*math.tau/10
                p=Vector((x+rx*math.cos(a),y,z+rz*math.sin(a)))
                uv=(.95,.018)
                if head and group==1:
                    uv=((.5+.32*p.x/.09)*.5,1-min(.96,max(.08,.965-(p.y-.453)*5.75))*256/544)
                    if math.sin(a)<-.3:uv=(.39,1-.16*256/544)
                if upper:p=torso(p)
                ring.append(vert(p,col,group,head,uv))
            rings.append(ring)
        link(rings)
    def torso(p):
        x,y,z=p;z+=lean*min(1,max(0,y/.46));a=twist*min(1,max(0,y/.42))
        return hips+Vector((x*math.cos(a)+z*math.sin(a),y,z*math.cos(a)-x*math.sin(a)))
    shirt=(.77,.75,.72);skin=(.98,.96,.95);denim=(.29,.31,.35);hair=(.18,.12,.080)
    shape([(0,0,0,.15,.105),(0,.13,0,.171,.12),(0,.31,.01,.197,.121),(0,.378,0,.175,.103),(0,.423,.005,.072,.068)],0,shirt,True)
    shape([(0,.40,.01,.063,.062),(0,.463,.020,.052,.069),(0,.482,.024,.073,.082),(0,.515,.027,.087,.089),(0,.55,.025,.091,.094),(0,.581,.017,.087,.096),(0,.603,.008,.088,.089),(0,.638,0,.061,.065)],1,skin,True,True)
    shape([(0,.513,.112,.018,.014),(0,.54,.111,.014,.016)],1,skin,True,True)
    shape([(0,.58,-.002,.09,.091),(0,.628,-.005,.081,.083),(0,.652,-.005,.045,.047)],2,hair,True,True)
    if pose in (0,4,7,9):
        shape([(0,.587,.057,.089,.113),(0,.598,.060,.088,.117)],3,(.43,.44,.47),True,True)
    elif pose in (2,5,8):
        shape([(0,.460,-.087,.043,.042),(0,.514,-.090,.067,.064),(0,.594,-.062,.074,.068)],2,hair,True,True)
    # Outer layers change the silhouette as well as the colour.
    if pose in (1,6,11):
        shape([(0,.298,-.077,.108,.062),(0,.354,-.085,.143,.087),(0,.414,-.061,.10,.061)],4,(.33,.32,.32),True)
        for sign in (-1,1):
            tube(torso((sign*.045,.394,.083)),torso((sign*.052,.289,.119)),.004,.003,3,(.68,.65,.59))
    if pose in (0,4,7):
        shape([(0,.235,.001,.188,.129),(0,.268,.003,.19,.128)],3,(.55,.54,.49),True)
    if pose in (3,10):
        for sign in (-1,1):
            shape([(sign*.102,.517,.001,.02,.032),(sign*.10,.563,.003,.022,.043),(sign*.093,.585,.006,.018,.029)],3,(.06,.066,.072),True,True)
    if pose in (1,8):
        for sign in (-1,1):
            shape([(sign*.039,.533,.098,.022,.009),(sign*.039,.551,.103,.031,.010),(sign*.039,.561,.098,.025,.008)],3,(.052,.068,.075),True,True)
    if pose in (2,5,8,10):
        shape([(0,.029,0,.16,.115),(0,.057,0,.164,.117)],3,(.65,.65,.60),True)
    if pose in (0,3,4,9):
        shape([(0,.397,.004,.098,.078),(0,.423,.008,.071,.067)],4,(.28,.26,.23),True)
    for side in (-1,1):
        knee=(side*.112,.22 if not up else .25,.26 if not up else .03)
        foot=(side*(.085 if pose==8 else .138),-.23,.17 if up else .24)
        if pose==3 and side==1:knee=(-.06,.30,.32);foot=(-.20,-.11,.26)
        if pose==7 and side==-1:foot=(-.19,-.23,-.14)
        tube(hips+Vector((side*.094,0,0)),knee,.089,.074,4,denim);tube(knee,foot,.072,.052,4,denim)
        x,y,z=foot
        shape([(x,y-.04,z+.043,.062,.102),(x,y+.009,z+.047,.068,.111),(x,y+.057,z,.051,.063)],3,(.34,.32,.29))
        e=(side*.21,.17,.075);hand=(side*.148,.065,.245)
        if pose==1:e=(side*.19,.12,.22);hand=(side*.07,.075,.27)
        if pose in (2,9):e=(side*.25,.22,.11);hand=(side*.044,.37 if pose==2 else .53,.23)
        if pose==3:e=(side*.18,.18,.08);hand=(-side*.07,.21,.14)
        if pose==4 and side==1:e=(.21,.39,.08);hand=(.025,.588,.155)
        if pose==5:e=(side*.155,.24,.09);hand=(side*.045,.26,.29)
        if pose==6 and side==1:e=(.29,.53,.05);hand=(.37,.78,.12)
        if pose==7:e=(side*.31,.47,.025);hand=(side*.29,.70,.11)
        if pose==8 and side==-1:e=(-.23,.22,0);hand=(-.36,.30,.03)
        if pose==10:e=(side*.22,.24,.035);hand=(side*.16,.04,.045)
        if pose==11 and side==1:e=(.24,.25,.065);hand=(.32,.34,.21)
        a,b,c=torso((side*.157,.35,0)),torso(e),torso(hand)
        tube(a,a.lerp(b,.67),.071,.055,0,shirt);tube(a.lerp(b,.62),b,.047,.043,1,skin);tube(b,c,.043,.032,1,skin)
        handEnd=c+(c-b).normalized()*.067;tube(c,handEnd,.035,.027,1,skin)
    if pose in (5,9):
        shape([(0,.265 if pose==5 else .535,.29,.038,.014),(0,.375 if pose==5 else .63,.285,.038,.014)],3,(.09,.097,.10),True)
    mesh=bpy.data.meshes.new('Grandstand pose %02d'%pose);mesh.from_pydata(verts,[],faces);mesh.materials.append(material);mesh.update()
    color=mesh.color_attributes.new(name='Wardrobe',type='BYTE_COLOR',domain='POINT')
    for i,c in enumerate(colors):color.data[i].color=c
    uv=mesh.uv_layers.new(name='Wardrobe groups')
    for poly in mesh.polygons:
        poly.use_smooth=True
        for li in poly.loop_indices:uv.data[li].uv=tags[mesh.loops[li].vertex_index]
    layer=mesh.uv_layers.new(name='Artwork')
    for loop in mesh.loops:layer.data[loop.index].uv=art[loop.vertex_index]
    mesh.uv_layers.active_index=0
    return mesh
