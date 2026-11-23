"""Retopologize the showroom body shell and store its faces in chassis space."""
import bpy
import bmesh
import math
from bisect import bisect_left
from functools import lru_cache
from mathutils import Vector
import sys
import gzip
import json
from pathlib import Path
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[2]
obj = bpy.data.objects['Chassis_TwoToneCover']
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
# Solve connectivity on the common rest shape, then form the cockpit rim
# on the fitted cage. This keeps the body and measured nose rows continuous.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from cockpit_coaming import formed_coaming
basis=obj.data.attributes.get('Unformed cockpit rim')
if basis is not None:
    for vertex,rest in zip(obj.data.vertices,basis.data):
        if rest.vector.length_squared:vertex.co=rest.vector
    obj.data.update()
surface = BVHTree.FromPolygons([v.co.copy() for v in obj.data.vertices],
                               [list(p.vertices) for p in obj.data.polygons])
# Seal the manufacturing seams for the field-aligned remesher. Project its
# vertices back onto the painted shell to retain the original panel profile.
obj.data.remesh_voxel_size = .012
bpy.ops.object.voxel_remesh()
# The cowl undercut can enclose tiny voxel islands. Retain the connected
# exterior before tracing the field, whose normals must all face outwards.
voxel=bmesh.new()
voxel.from_mesh(obj.data)
remaining=set(voxel.verts)
components=[]
while remaining:
    island={remaining.pop()}
    frontier=list(island)
    while frontier:
        vertex=frontier.pop()
        for edge in vertex.link_edges:
            other=edge.other_vert(vertex)
            if other in remaining:
                remaining.remove(other)
                island.add(other)
                frontier.append(other)
    components.append(island)
exterior=max(components,key=len)
bmesh.ops.delete(voxel,geom=[v for island in components if island is not exterior for v in island],context='VERTS')
# Relax sub-voxel corners before triangulation. Extremely thin triangles
# otherwise collapse when the field solver converts positions to floats.
for _ in range(3):
    bmesh.ops.smooth_vert(voxel,verts=list(voxel.verts),factor=.45,use_axis_x=True,use_axis_y=True,use_axis_z=True)
bmesh.ops.triangulate(voxel,faces=list(voxel.faces),quad_method='BEAUTY')
bmesh.ops.recalc_face_normals(voxel,faces=list(voxel.faces))
voxel.to_mesh(obj.data)
voxel.free()
bpy.ops.object.quadriflow_remesh(target_faces=23000, use_preserve_sharp=False,
                                 use_preserve_boundary=False, seed=44)
# On the long flat nose QuadriFlow spends most of its resolution on the
# tip. Build rows around measured cross-sections from the nose joint forward.
# The first row shares the cut edges of the body cage.
seam=.62
bm=bmesh.new();bm.from_mesh(obj.data)
bmesh.ops.bisect_plane(bm,geom=[*bm.verts,*bm.edges,*bm.faces],dist=.000001,
                       plane_co=(0,0,seam),plane_no=(0,0,1),clear_outer=True)
boundary=[e for e in bm.edges if e.is_boundary and all(abs(v.co.z-seam)<.00001 for v in e.verts)]
if not boundary:raise RuntimeError('Missing nose joint')
# Follow the mesh boundary itself. At the left shoulder two vertices
# overhang one another in polar projection; angular sorting crosses the seam.
neighbors={}
for edge in boundary:
    a,b=edge.verts
    neighbors.setdefault(a,[]).append(b)
    neighbors.setdefault(b,[]).append(a)
if any(len(adjacent)!=2 for adjacent in neighbors.values()):
    raise RuntimeError('Branched nose joint')
cy=(min(v.co.y for v in neighbors)+max(v.co.y for v in neighbors))*.5
start=min(neighbors,key=lambda v:math.atan2(v.co.y-cy,v.co.x))
ring=[start]
previous,current=start,neighbors[start][0]
while current!=start:
    ring.append(current)
    a,b=neighbors[current]
    previous,current=current,b if a==previous else a
if len(ring)!=len(boundary):raise RuntimeError('Disconnected nose joint')
if sum(a.co.x*b.co.y-b.co.x*a.co.y for a,b in zip(ring,ring[1:]+ring[:1]))<0:
    ring=[start,*reversed(ring[1:])]
n=len(ring)
arc_lengths=[0.]
for a,b in zip(ring,ring[1:]+ring[:1]):
    arc_lengths.append(arc_lengths[-1]+(a.co-b.co).length)
# Keep the same radial spacing on the forward nose when a small body change
# makes QuadriFlow choose a different number of vertices on the bulkhead.
perimeter=max(n,min(58,2*n))
row_indices=[round(i*perimeter/n) for i in range(n+1)]
seam_fractions=[]
for i,(a,b) in enumerate(zip(arc_lengths,arc_lengths[1:])):
    seam_fractions.append(a/arc_lengths[-1])
    if row_indices[i+1]-row_indices[i]==2:
        seam_fractions.append((a+b)/(2*arc_lengths[-1]))
first=math.atan2(ring[0].co.y-cy,ring[0].co.x)
# Split selected bulkhead edges into two intervals as the shoulder narrows.
previous=ring
# The source has tighter stations as the nose rolls over into its tip.
stations=48
for row in range(1,stations+1):
    t=row/stations
    z=seam+(2.892-seam)*(1.23*t-.23*t*t)
    top=surface.ray_cast(Vector((0,1.5,z)),Vector((0,-1,0)))[0]
    bottom=surface.ray_cast(Vector((0,-.1,z)),Vector((0,1,0)))[0]
    if top is None or bottom is None:raise RuntimeError(f'Open section at {z}')
    centre=Vector((0,(top.y+bottom.y)*.5,z))
    samples=[]
    for i in range(321):
        angle=first+math.tau*(i%320)/320
        point=surface.ray_cast(centre,Vector((math.cos(angle),math.sin(angle),0)))[0]
        if point is None:raise RuntimeError(f'Nose cage ray missed at {z}')
        samples.append(point)
    lengths=[0.]
    for a,b in zip(samples,samples[1:]):lengths.append(lengths[-1]+(a-b).length)
    current=[]
    for k,fraction in enumerate(seam_fractions):
        blend=min(row/9,1)
        d=lengths[-1]*(fraction*(1-blend)+k/perimeter*blend)
        # Transport the longitudinal rows around the rolled shoulder.
        phase=.38*math.sin(math.tau*t)*math.sin(math.pi*t)
        d=(d+phase*lengths[-1]/perimeter)%lengths[-1]
        j=max(1,bisect_left(lengths,d))
        pt=samples[j-1].lerp(samples[j],(d-lengths[j-1])/max(1e-9,lengths[j]-lengths[j-1]))
        current.append(bm.verts.new(pt))
    if row==1:
        for i in range(n):
            k=row_indices[i];end=row_indices[i+1]%perimeter;j=(i+1)%n
            follow=(k+1)%perimeter
            bm.faces.new((previous[i],previous[j],current[follow],current[k]))
            if follow!=end:
                bm.faces.new((previous[j],current[end],current[follow]))
    else:
        for i in range(perimeter):
            j=(i+1)%perimeter
            corners=(previous[i],previous[j],current[j],current[i])
            # Both diagonals are visible between the transverse uprights.
            # Place their common vertex on the fairing to keep the closed
            # inspection cage suitable for the detached nose as well.
            centre_point=sum((v.co for v in corners),Vector())*.25
            middle=bm.verts.new(surface.find_nearest(centre_point)[0])
            for va,vb in zip(corners,corners[1:]+corners[:1]):
                bm.faces.new((va,vb,middle))
    previous=current
# Reuse the measured height of the last section so the tip stays on the
# foremost surface as the nose taper changes.
tip,_,_,_=surface.ray_cast(Vector((0,centre.y,3.1)),Vector((0,0,-1)))
if tip is None or tip.z<z:raise RuntimeError('Nose tip falls behind the last ring')
cap=bm.verts.new(tip)
for i,v in enumerate(previous):bm.faces.new((v,previous[(i+1)%len(previous)],cap))
bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
if any(not edge.is_manifold for edge in bm.edges):
    raise RuntimeError('Open inspection-shell seam')
bm.to_mesh(obj.data);bm.free()
faces = [list(p.vertices) for p in obj.data.polygons]
if not 13000 < len(faces) < 46000 or any(len(face) not in (3,4) for face in faces):
    raise RuntimeError('Invalid inspection shell topology')
# The transverse rows sweep back across the upper shoulders. Transport each
# sample to the corresponding radial point of a new longitudinal section.
# The sweep tapers to zero at the bulkhead seam and at the closed tip.
@lru_cache(maxsize=16384)
def nose_section(z):
    top=surface.ray_cast(Vector((0,1.4,z)),Vector((0,-1,0)))[0]
    bottom=surface.ray_cast(Vector((0,-.14,z)),Vector((0,1,0)))[0]
    if top is None or bottom is None:return None
    centre=Vector((0,(top.y+bottom.y)*.5,z))
    shoulder=surface.ray_cast(centre,Vector((1,0,0)))[0]
    return (centre,shoulder.x) if shoulder else None

def smooth_fraction(t):
    t=max(0.,min(1.,t))
    return t*t*(3-2*t)

def shoulder_point(co):
    x,y,z=co
    if not .625<z<2.88:return co
    section=nose_section(z)
    if not section:return co
    centre,width=section
    fade=smooth_fraction((z-.62)/.33)*smooth_fraction((2.89-z)/.26)
    station=z-.90*(width-abs(x))*fade
    if abs(station-z)<.0002:return co
    next_section=nose_section(station)
    if not next_section:return co
    radial=Vector((x,y-centre.y,0)).normalized()
    point=surface.ray_cast(next_section[0],radial)[0]
    return point if point is not None else co

# Tangential offsets of the visible row crossings in frame 007, in metres.
# Mirror around the centreline and project each moved crossing onto the skin.
station_offsets=(0, 0.00225, -0.00375, -0.006, 0.009, 0.02175, 0.01575, 0.01125, 0)
shoulder_offsets=(0, -0.0195, -0.01875, 0.00075, 0.01425, 0.00225, 0.0, -0.00075, 0)
def fitted_crossing(co):
    x,y,z=co
    if not seam<z<2.892:return co
    section=nose_section(z)
    if not section:return co
    centre,width=section
    unit=(z-seam)/(2.892-seam)*(len(station_offsets)-1)
    i=min(int(unit),len(station_offsets)-2);t=unit-i
    def offset(values):return values[i]*(1-t)+values[i+1]*t
    point,normal,_,_=surface.find_nearest(co)
    along=Vector((0,0,1));along-=normal*along.dot(normal)
    angle=math.atan2(y-centre.y,abs(x))
    across=Vector((-math.sin(angle)*math.copysign(1.,x),math.cos(angle),0))
    across-=normal*across.dot(normal)
    delta=along*offset(station_offsets)+across*offset(shoulder_offsets)*min(1.,4*abs(x)/max(.01,width))
    return surface.find_nearest(point+delta)[0]

points = []
for vertex in obj.data.vertices:
    point, _, _, distance = surface.find_nearest(vertex.co)
    co = point if distance is not None and distance < .025 else vertex.co
    sample=shoulder_point(Vector(tuple(round(x,4) for x in co)))
    points.append([round(x*10000) for x in formed_coaming(fitted_crossing(sample))])
# The four diagonals share a vertex at each measured crossing. The key is its
# fitted rest coordinate, so a subsequent topology change cannot move an
# unrelated vertex. Keep each adjusted crossing on the painted surface.
trace=json.loads(Path(__file__).with_name('nose-crossings.json').read_text())
scale=trace['unitsPerMetre']
offsets={tuple(row[:3]):row[3:] for row in trace['restXYZAndOffsetXYZ']}
for i,point in enumerate(points):
    delta=offsets.get(tuple(point))
    if delta is None:continue
    candidate=Vector([(v+d)/scale for v,d in zip(point,delta)])
    nearest=surface.find_nearest(candidate)[0]
    points[i]=[round(v*scale) for v in nearest]
asset = root/'src/race/assets/jgp26-wire-shell.json.gz'
asset.write_bytes(gzip.compress(json.dumps(dict(points=points,faces=faces),separators=(',',':')).encode(),mtime=0))
print('INSPECTION_FACES',len(faces),'QUADS',sum(len(f)==4 for f in faces),'NOSE_PERIMETER',perimeter)
