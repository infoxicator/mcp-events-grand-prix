"""Lossless container packing + glTF KHR_mesh_quantization normals (8-bit).
Cars retain float positions; circuit chunks use 16-bit positions with uniform
node transforms. No decoder/WASM required by MCP hosts.
"""
import json,struct,gzip
from pathlib import Path

def pack(source,dest,positions=False):
 b=Path(source).read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);binary=b[28+n:];views=g['bufferViews'];accessors=g.get('accessors',[]);normal_indices={p['attributes']['NORMAL'] for m in g['meshes'] for p in m['primitives'] if 'NORMAL' in p['attributes']};instanced={n['mesh'] for n in g['nodes'] if 'EXT_mesh_gpu_instancing' in n.get('extensions',{})};position_mesh={p['attributes']['POSITION']:mi for mi,m in enumerate(g['meshes']) for p in m['primitives'] if mi not in instanced};transforms={};out=bytearray();quantized=False
 # AO and decal UVs stay within a single tile. UNORM16 keeps their maximum
 # error below 0.008 texel on a 1K map, leaving room for venue artwork.
 unit_uvs={i for mesh in g['meshes'] for prim in mesh['primitives'] for key,i in prim['attributes'].items() if key.startswith('TEXCOORD_')}
 for vi,v in enumerate(views):
  attrs=[(i,a) for i,a in enumerate(accessors) if a.get('bufferView')==vi];raw=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
  if len(attrs)==1 and attrs[0][0] in normal_indices and attrs[0][1]['componentType']==5126 and not v.get('byteStride'):
   a=attrs[0][1];values=struct.unpack_from('<'+'f'*(a['count']*3),raw,a.get('byteOffset',0));raw=struct.pack('<'+'b'*len(values),*(max(-127,min(127,round(x*127))) for x in values));a['componentType']=5120;a['normalized']=True;a['byteOffset']=0;quantized=True
   # VEC3 byte data must use an aligned stride (glTF vertex attribute alignment).
   raw=b''.join(raw[i:i+3]+b'\0' for i in range(0,len(raw),3));v['byteStride']=4
  if not positions and len(attrs)==1 and attrs[0][0] in unit_uvs and attrs[0][1]['componentType']==5126 and not v.get('byteStride'):
   a=attrs[0][1]
   values=struct.unpack_from('<'+'f'*(a['count']*2),raw,a.get('byteOffset',0))
   if min(values)>=0 and max(values)<=1:
    encoded=[round(u*65535) for u in values]
    raw=struct.pack('<'+'H'*len(encoded),*encoded)
    a.update(componentType=5123,normalized=True,byteOffset=0)
    if 'min' in a:a['min']=[min(encoded[::2]),min(encoded[1::2])]
    if 'max' in a:a['max']=[max(encoded[::2]),max(encoded[1::2])]
  if not positions and len(attrs)==1 and attrs[0][0] in position_mesh and attrs[0][1]['componentType']==5126 and not v.get('byteStride'):
   # Keep standard float attributes and the original mesh transforms. A
   # binary grid limits packing error to 3.82 micrometres per coordinate.
   a=attrs[0][1];values=struct.unpack_from('<'+'f'*(a['count']*3),raw,a.get('byteOffset',0))
   rounded=[round(x*131072)/131072 for x in values]
   raw=struct.pack('<'+'f'*len(rounded),*rounded);a['byteOffset']=0
   a['min']=[min(rounded[k::3]) for k in range(3)];a['max']=[max(rounded[k::3]) for k in range(3)]
  if positions and len(attrs)==1 and attrs[0][0] in position_mesh and attrs[0][1]['componentType']==5126 and not v.get('byteStride'):
   a=attrs[0][1];values=struct.unpack_from('<'+'f'*(a['count']*3),raw,a.get('byteOffset',0));lo=[min(values[k::3]) for k in range(3)];hi=[max(values[k::3]) for k in range(3)];centre=[(lo[k]+hi[k])/2 for k in range(3)];extent=max(max(hi[k]-lo[k] for k in range(3))/2,1e-6)
   ints=[max(-32767,min(32767,round((x-centre[i%3])/extent*32767))) for i,x in enumerate(values)];raw=b''.join(struct.pack('<hhhh',*ints[i:i+3],0) for i in range(0,len(ints),3));a.update(componentType=5122,normalized=True,byteOffset=0,min=[min(ints[k::3]) for k in range(3)],max=[max(ints[k::3]) for k in range(3)]);v['byteStride']=8;transforms[position_mesh[attrs[0][0]]]=(centre,extent);quantized=True
  while len(out)%4:out.append(0)
  v['byteOffset']=len(out);v['byteLength']=len(raw);out.extend(raw)
 while len(out)%4:out.append(0)
 g['buffers'][0]['byteLength']=len(out)
 for node in list(g['nodes']):
  if node.get('mesh') in transforms:
   mi=node.pop('mesh');centre,extent=transforms[mi];name=node.get('name','Quantized mesh');node['name']=name+'_placement';node.setdefault('children',[]).append(len(g['nodes']));g['nodes'].append({'mesh':mi,'name':name,'translation':centre,'scale':[extent]*3})
 if quantized:
  for k in ['extensionsUsed','extensionsRequired']:
   g.setdefault(k,[])
   if 'KHR_mesh_quantization' not in g[k]:g[k].append('KHR_mesh_quantization')
 js=json.dumps(g,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
 result=struct.pack('<III',0x46546c67,2,28+len(js)+len(out))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(out),0x004e4942)+out
 Path(dest).write_bytes(gzip.compress(result,compresslevel=9,mtime=0))
