"""Bind rigid inspection poses to the actual glTF triangles, preserving the seams."""
import zlib
import gzip
import json
import struct
from collections import defaultdict
from pathlib import Path

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon


def primitives(asset):
    data=asset.read_bytes()
    size=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+size])
    def accessor(index):
        acc=doc['accessors'][index]
        view=doc['bufferViews'][acc['bufferView']]
        dtype={5123:'<u2',5125:'<u4',5126:'<f4'}[acc['componentType']]
        n=3 if acc['type']=='VEC3' else 1
        stride=view.get('byteStride',n*np.dtype(dtype).itemsize)
        offset=28+size+view.get('byteOffset',0)+acc.get('byteOffset',0)
        return np.ndarray((acc['count'],n),dtype,buffer=data,offset=offset,
                          strides=(stride,np.dtype(dtype).itemsize))
    meshes=defaultdict(list)
    for node in doc['nodes']:
        if 'mesh' not in node:continue
        for i,p in enumerate(doc['meshes'][node['mesh']]['primitives']):
            verts=accessor(p['attributes']['POSITION'])
            idx=accessor(p['indices']).reshape((-1,3))
            meshes[node['name']].append((f"{node['mesh']}/{i}",verts,idx))
    return meshes


def clip_triangle(points,triangle):
    # Barycentric coordinates retain every original texture and normal attribute.
    a,b,c=triangle
    axes=np.stack((b-a,c-a),axis=1)
    coords=np.linalg.lstsq(axes,(np.asarray(points)-a).T,rcond=None)[0].T.tolist()
    for axis in range(3):
        if not coords:return []
        def distance(pt):
            return pt[axis] if axis<2 else 1-pt[0]-pt[1]
        out=[]
        for p,q in zip(coords,coords[1:]+coords[:1]):
            dp,dq=distance(p),distance(q)
            if dp>=0:out.append(p)
            if (dp>=0)!=(dq>=0):
                t=dp/(dp-dq)
                out.append([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t])
        coords=out
    result=[]
    for j in range(1,len(coords)-1):
        poly=[coords[0],coords[j],coords[j+1]]
        area=(poly[1][0]-poly[0][0])*(poly[2][1]-poly[0][1])-(poly[2][0]-poly[0][0])*(poly[1][1]-poly[0][1])
        if abs(area)<1e-7:continue
        if area<0:poly.reverse()
        result.extend(round(max(0,min(1,v))*65535) for pt in poly for v in pt)
    return result


def complete_partition(patches):
    """Partition the whole export triangle even where the Blender ngon twists.

    All cut lines are in barycentric space. Subdividing the original simplex
    gives both fragments exactly the same boundary vertices after quantization.
    """
    source=[]
    area=0
    for group,*weights in patches:
        for i in range(0,len(weights),6):
            a,b,c=[tuple(weights[k:k+2]) for k in range(i,i+6,2)]
            area+=abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
            source.append((group,(a,b,c)))
    if abs(area/65535**2-1)<.0001:return patches

    def side(p,a,b):
        return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
    cells=[[(0,0),(65535,0),(0,65535)]]
    edges={tuple(sorted((a,b))) for _,pts in source for a,b in zip(pts,pts[1:]+pts[:1]) if a!=b}
    for a,b in sorted(edges):
        next_cells=[]
        for cell in cells:
            ds=[side(p,a,b) for p in cell]
            if min(ds)>=-.01 or max(ds)<=.01:
                next_cells.append(cell)
                continue
            left=[];right=[]
            for j,p in enumerate(cell):
                q=cell[(j+1)%len(cell)]
                dp,dq=ds[j],ds[(j+1)%len(cell)]
                if dp>=0:left.append(p)
                if dp<=0:right.append(p)
                if dp*dq<0:
                    t=dp/(dp-dq)
                    cut=(p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t)
                    left.append(cut);right.append(cut)
            next_cells.extend(c for c in (left,right) if len(c)>=3)
        cells=next_cells
    result=defaultdict(list)
    for cell in cells:
        centre=tuple(sum(p[i] for p in cell)/len(cell) for i in (0,1))
        def proximity(fragment):
            _,points=fragment
            return min(side(centre,a,b)/max(1,(float(b[0]-a[0])**2+(b[1]-a[1])**2)**.5)
                       for a,b in zip(points,points[1:]+points[:1]))
        group=max(source,key=proximity)[0]
        vertices=[(round(b),min(65535-round(b),round(c))) for b,c in cell]
        for j in range(1,len(vertices)-1):
            tri=(vertices[0],vertices[j],vertices[j+1])
            if side(tri[2],tri[0],tri[1])>0:
                result[group].extend(value for pt in tri for value in pt)
    return [[group,*weights] for group,weights in result.items()]


class PoseBinding:
    def __init__(self,meshes):
        self.meshes=meshes
        self.base={}
        self.pose=None

    def begin(self):
        self.pose={'matrices':[],'meshes':{}}
        self.palette={}

    def original(self,obj,bm):
        layer=bm.faces.layers.int.new('Review source face')
        for face in bm.faces:face[layer]=face.index
        return layer

    def record(self,obj,bm,face_layer,rest,transforms):
        bindings=self.meshes.get(obj.name)
        if not bindings:return
        groups=defaultdict(list)
        for face in bm.faces:
            key=tuple(round(v,7) for row in transforms[face.verts[0]][:3] for v in row)
            index=self.palette.get(key)
            if index is None:
                index=len(self.palette);self.palette[key]=index;self.pose['matrices'].append(key)
            groups[face[face_layer]].append((index,face))
        original=obj.data
        tree=BVHTree.FromPolygons([v.co.copy() for v in original.vertices],[p.vertices[:] for p in original.polygons])
        for key,vertices,indices in bindings:
            triangles=vertices[indices]
            if key not in self.base:
                self.base[key]=(range(len(indices)) if key=='shell' else
                                [tree.find_nearest(Vector(pt))[2] for pt in triangles.mean(axis=1)])
            runs=[];splits={};last=None
            for i,source in enumerate(self.base[key]):
                parts=groups[source]
                chosen=parts[0][0]
                if any(group!=chosen for group,_ in parts):
                    clipped=[]
                    for group,face in parts:
                        poly=[rest[v] for v in face.verts]
                        pieces=[poly] if len(poly)<=4 else [[poly[k] for k in tri] for tri in tessellate_polygon([poly])]
                        for piece in pieces:
                            weights=clip_triangle(piece,triangles[i])
                            if weights:clipped.append([group,*weights])
                    if clipped:
                        if all(p[0]==clipped[0][0] for p in clipped):chosen=clipped[0][0]
                        else:splits[i]=complete_partition(clipped)
                if chosen!=last:runs.extend((i,chosen));last=chosen
            self.pose['meshes'][key]=[len(indices),runs,splits]


def compact(poses):
    """Most inspection poses cut the same triangles. Share cuts and per-mesh topology."""
    layouts=[]
    known={}
    for pose in poses.values():
        for name,(count,runs,splits) in list(pose['meshes'].items()):
            palette={}
            def local(i):
                return palette.setdefault(i,len(palette))
            for i in range(1,len(runs),2):
                runs[i]=local(runs[i])
            for pieces in splits.values():
                for patch in pieces:
                    patch[0]=local(patch[0])
            layout=[count,runs,splits]
            key=json.dumps(layout,separators=(',',':'))
            if key not in known:
                known[key]=len(layouts)
                layouts.append(layout)
            pose['meshes'][name]=[known[key],list(palette)]
    return {'layouts':layouts,'poses':poses}


def bake(root,skin,inspection_pose):
    bindings=PoseBinding(primitives(root/'src/race/assets/jgp26-high.glb'))
    cage=json.loads(gzip.decompress((root/'src/race/assets/jgp26-wire-shell.json.gz').read_bytes()))
    import bpy
    shell=bpy.data.meshes.new('Inspection rest cage')
    points=np.asarray(cage['points'])/10000
    indices=[]
    for face in cage['faces']:
        indices.append(face[:3])
        if len(face)==4:indices.append([face[0],face[2],face[3]])
    # Cut the same diagonal used by the browser. Projecting a twisted quad's
    # cut onto two different planes leaves small gaps in a handful of cells.
    shell.from_pydata(points.tolist(),[],indices)
    shell.update()
    result={}
    for name,angle,kwargs in [('quarter',28,{}),('service',-7,{'service':True}),
                              ('overhead',0,{'reassembly':True}),('exploded',28,{'wire_breakdown':True}),
                              ('lift',28,{'wire_breakdown':True,'intro':.10}),
                              ('breakdown',28,{'wire_breakdown':True,'intro':.63})]:
        bindings.begin()
        with inspection_pose(angle,binding=bindings,**kwargs):pass
        saved=skin.data
        original=bindings.meshes[skin.name]
        try:
            skin.data=shell
            bindings.meshes[skin.name]=[('shell',points,np.array(indices))]
            with inspection_pose(angle,binding=bindings,shell_only=True,**kwargs):pass
        finally:
            skin.data=saved
            bindings.meshes[skin.name]=original
        result[name]=bindings.pose
    bpy.data.meshes.remove(shell)
    path=root/'src/race/assets/inspection-poses.json.gz'
    payload=json.dumps(compact(result),separators=(',',':')).encode()
    # Filtered deflate favours repeated short numeric fields in the pose layouts.
    encoder=zlib.compressobj(level=9,wbits=31,memLevel=6,strategy=zlib.Z_FILTERED)
    path.write_bytes(encoder.compress(payload)+encoder.flush())
    print('Inspection pose bytes',path.stat().st_size)
