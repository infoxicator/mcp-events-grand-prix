"""Read exported GLB bounds, not hand-entered manifest dimensions. No model editing."""
import json,struct,math
from pathlib import Path
b=Path('src/race/assets/jgp26-high.glb').read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);start=28+n
# Every exported accessor's extrema transformed through its full animation hierarchy.
def mul(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def transform(n):
 if 'matrix' in n:return [[n['matrix'][j*4+i] for j in range(4)] for i in range(4)]
 x,y,z,w=n.get('rotation',[0,0,0,1]);s=n.get('scale',[1,1,1]);t=n.get('translation',[0,0,0])
 r=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
 return [[r[i][j]*s[j] for j in range(3)]+[t[i]] for i in range(3)]+[[0,0,0,1]]
points=[];nodes={}
def visit(index,parent):
 node=g['nodes'][index]
 if node.get('name','').startswith('Forearm'):return # Unit sleeves are posed at runtime, not static car bounds.
 m=mul(parent,transform(node));nodes[node.get('name','')]=[m[i][3] for i in range(3)]
 if 'mesh' in node:
  for p in g['meshes'][node['mesh']]['primitives']:
   a=g['accessors'][p['attributes']['POSITION']];v=g['bufferViews'][a['bufferView']];base=start+v.get('byteOffset',0)+a.get('byteOffset',0)
   for i in range(a['count']):
    q=list(struct.unpack_from('<3f',b,base+i*v.get('byteStride',12)))+[1];points.append([sum(m[j][k]*q[k] for k in range(4)) for j in range(3)])
 for c in node.get('children',[]):visit(c,m)
identity=[[1 if i==j else 0 for j in range(4)] for i in range(4)]
for node in g['scenes'][g.get('scene',0)]['nodes']:visit(node,identity)
low=[min(p[i] for p in points) for i in range(3)];high=[max(p[i] for p in points) for i in range(3)]
print(json.dumps({'boundsMetres':{'min':low,'max':high},'dimensionsMetres':{'width':high[0]-low[0],'height':high[1]-low[1],'length':high[2]-low[2],'wheelbase':nodes['FrontL'][2]-nodes['RearL'][2]},'authoredLandmarks':{'noseTipHeight':.18,'noseFrontAxleHeight':.46,'rearWingTop':.964,'airboxTop':1.125,'airboxOpeningHeight':.318,'sidepodMouthWidth':.464,'sidepodMouthHeight':.098}},indent=2))
