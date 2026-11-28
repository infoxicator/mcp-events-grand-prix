"""Single-material prototypes for instanced apron equipment and trackside props."""
import bpy
import math
from mathutils import Vector


def prototype(name, material):
    verts, faces, colors, uvs = [], [], [], []
    steel=(.34,.39,.40); carbon=(.031,.039,.044); rubber=(.055,.052,.049)
    orange=(.98,.28,.025); ivory=(.86,.84,.75)

    def face(points, color, uv=None):
        start=len(verts)
        for x,y,z in points:verts.append((x,-z,y))
        faces.append(tuple(range(start,len(verts))))
        colors.extend([(*color,1)]*len(points))
        uvs.extend(uv or [(0,0)]*len(points))

    def box(center, size, color):
        x,y,z=center;w,h,d=[v/2 for v in size]
        v=[(x+i*w,y+j*h,z+k*d) for k in (-1,1) for j in (-1,1) for i in (-1,1)]
        for q in [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)]:
            face([v[i] for i in q],color)

    def tube(start,end,r1,r2,color,n=8):
        a,b=Vector(start),Vector(end);axis=(b-a).normalized()
        u=axis.orthogonal().normalized();v=axis.cross(u)
        rows=[[p+r*(u*math.cos(t*math.tau/n)+v*math.sin(t*math.tau/n)) for t in range(n)] for p,r in [(a,r1),(b,r2)]]
        face(rows[0][::-1],color);face(rows[1],color)
        for i in range(n):face([rows[0][i],rows[0][(i+1)%n],rows[1][(i+1)%n],rows[1][i]],color)

    if name.endswith('Rack'):
        box((0,.19,0),(2.28,.12,1.03),steel)
        for x in (-.92,.92):
            for z in (-.35,.35):
                tube((x-.054,.09,z),(x+.054,.09,z),.09,.09,rubber)
        if name=='TyreBlanketRack':
            for x in (-.71,0,.71):
                tube((x-.29,.62,0),(x+.29,.62,0),.36,.36,rubber,16)
                for dx in (-.18,.18):tube((x+dx-.028,.62,0),(x+dx+.028,.62,0),.366,.366,carbon,16)
        else:
            for x in (-.81,.81):box((x,.49,0),(.08,.52,.21),steel)
            for h,z in [(.49,.19),(.57,.04),(.65,-.12)]:
                box((0,h,z),(1.95,.045,.26),carbon)
            tube((0,.60,.42),(0,.78,-.62),.085,.16,ivory,10)
    elif name=='Photographer':
        for side in (-1,1):
            x=side*.14
            box((x,.065,.04),(.16,.13,.30),carbon)
            tube((x,.12,0),(x,.53,.04),.075,.093,carbon)
            tube((x,.53,.04),(side*.10,.93,0),.093,.11,carbon)
            tube((side*.17,1.35,0),(side*.26,1.13,.15),.087,.069,orange)
            tube((side*.26,1.13,.15),(side*.085,1.47,.30),.067,.046,(.46,.26,.15))
        tube((0,.85,0),(0,1.37,0),.18,.215,orange,12)
        tube((0,1.06,0),(0,1.12,0),.202,.205,ivory,12)
        tube((0,1.39,0),(0,1.64,.02),.082,.11,(.40,.235,.14),10)
        tube((0,1.60,.02),(0,1.70,.02),.115,.09,carbon)
        box((0,1.50,.15),(.20,.14,.13),carbon)
        tube((0,1.51,.2),(0,1.51,.58),.063,.088,ivory,10)
        tube((0,1.51,.50),(0,1.51,.55),.089,.091,carbon,10)
        tube((0,1.51,.58),(0,1.51,.60),.071,.071,(.04,.09,.12),10)
    elif name=='GrandstandFlag':
        box((.21,1.01,.16),(.018,.77,.018),steel)
        for i in range(14):
            x=.21+i*.0315
            points=[(x+t*.0315,1.38-j*.27,.16+.032*math.sin((i+t)*.4)) for t,j in [(0,1),(1,1),(1,0),(0,0)]]
            face(points,(1,1,1),[(i/14,0),((i+1)/14,0),((i+1)/14,1),(i/14,1)])
    elif name=='SafetyBoard':
        face([(-.28,1.11,.29),(.28,1.11,.29),(.28,1.46,.29),(-.28,1.46,.29)],ivory,[(0,0),(1,0),(1,1),(0,1)])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();mesh.materials.append(material)
    attr=mesh.color_attributes.new(name='Equipment colour',type='BYTE_COLOR',domain='POINT')
    for i,c in enumerate(colors):attr.data[i].color=c
    uv=mesh.uv_layers.new(name='Artwork')
    for loop in mesh.loops:uv.data[loop.index].uv=uvs[loop.vertex_index]
    return mesh
