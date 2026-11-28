"""Lossless container packing + glTF KHR_mesh_quantization normals (8-bit).
Cars retain float positions; circuit chunks use 16-bit positions with uniform
node transforms. No decoder/WASM required by MCP hosts.
"""
import json,struct,gzip,zlib
from pathlib import Path

def compress_circuit(data):
 # Smaller deflate blocks fit the changes of entropy between spatial chunks.
 # The decoded buffer and its glTF accessors stay byte-identical.
 encoder=zlib.compressobj(level=9,wbits=31,memLevel=5)
 return encoder.compress(data)+encoder.flush()

def pack(source,dest,positions=False):
 b=Path(source).read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);binary=b[28+n:];views=g['bufferViews'];accessors=g.get('accessors',[]);normal_indices={p['attributes']['NORMAL'] for m in g['meshes'] for p in m['primitives'] if 'NORMAL' in p['attributes']};instanced={n['mesh'] for n in g['nodes'] if 'EXT_mesh_gpu_instancing' in n.get('extensions',{})}
 if Path(source).name=='jgp26-high.glb':
  for mi,mesh in enumerate(g['meshes']):
   for pi,primitive in enumerate(mesh['primitives']):
    primitive.setdefault('extras',{})['inspectionPart']=f'{mi}/{pi}'
 # Actors rotate about pivots in Blender metres. Preserve that coordinate
 # system even when the exporter emits a single official as an ordinary node.
 actor_materials={'MarshalUniform','FinishUniform','PitCrewUniform','GarageUniform'}
 instanced.update(mi for mi,m in enumerate(g['meshes']) if any(
  g['materials'][p['material']]['name'] in actor_materials for p in m['primitives'] if 'material' in p))
 position_mesh={p['attributes']['POSITION']:mi for mi,m in enumerate(g['meshes']) for p in m['primitives'] if mi not in instanced};transforms={};out=bytearray();quantized=False
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
 Path(dest).write_bytes(compress_circuit(result) if positions else gzip.compress(result,compresslevel=9,mtime=0))


UNDER_COWLING_NODES={
 'Chassis_Ground steel','Chassis_Transmission alloy','Chassis_Machined gear web',
 'Chassis_Machined intake bell','Chassis_Power unit casting','Chassis_Formed heat shield',
 'Chassis_PortRecess','Chassis_Turned shaft steel','Chassis_CowlingEdge',
 'Chassis_CowlingReturn','Chassis_Cowling spring steel','Chassis_Cowl inner laminate',
}
FAR_LOD_OMIT_NODES=UNDER_COWLING_NODES|{
 'Steering','Hands','HandL','HandR','Continuous glove L','Continuous glove R',
 'Chassis_SeatFoam','Chassis_Seat pan laminate','Chassis_Seat edge satin',
 'Chassis_Knee bolster','Chassis_Cockpit liner',
 'ForearmL_GloveStitch','ForearmR_GloveStitch','UpperArmL_GloveStitch','UpperArmR_GloveStitch',
 'SuitBody_ButtonRed','SuitBody_Cavity','SuitBody_GloveStitch','SuitBody_Titanium',
}

def _collect_textures(obj,out):
 if isinstance(obj,dict):
  for k,v in obj.items():
   if k.endswith('Texture') and isinstance(v,dict) and 'index' in v:out.add(v['index'])
   else:_collect_textures(v,out)
 elif isinstance(obj,list):
  for item in obj:_collect_textures(item,out)

def _remap_textures(obj,tmap):
 if isinstance(obj,dict):
  for k,v in obj.items():
   if k.endswith('Texture') and isinstance(v,dict) and 'index' in v:v['index']=tmap[v['index']]
   else:_remap_textures(v,tmap)
 elif isinstance(obj,list):
  for item in obj:_remap_textures(item,tmap)

def prune_glb_bytes(raw_bytes,omit_nodes,strip_attrs=()):
 """Drop hidden subtrees and unused glTF tables/binary views before packing."""
 n=struct.unpack_from('<I',raw_bytes,12)[0]
 g=json.loads(raw_bytes[20:20+n]);binary=raw_bytes[28+n:]
 nodes=g.get('nodes',[])
 keep_nodes=set()
 def visit(idx):
  if idx in keep_nodes:return
  node=nodes[idx]
  if node.get('name') in omit_nodes:return
  keep_nodes.add(idx)
  for c in node.get('children',()):visit(c)
 for scene in g.get('scenes',()):
  for root_idx in scene.get('nodes',()):visit(root_idx)
 # Retain joint nodes referenced by surviving skins.
 keep_skins=set()
 for idx in list(keep_nodes):
  if 'skin' in nodes[idx]:keep_skins.add(nodes[idx]['skin'])
 skins=g.get('skins',[])
 for si in keep_skins:
  sk=skins[si]
  for j in sk.get('joints',()):keep_nodes.add(j)
  if 'skeleton' in sk:keep_nodes.add(sk['skeleton'])
 node_order=sorted(keep_nodes)
 nmap={old:new for new,old in enumerate(node_order)}
 new_nodes=[]
 for old in node_order:
  nd=dict(nodes[old])
  if 'children' in nd:
   kids=[nmap[c] for c in nd['children'] if c in nmap]
   if kids:nd['children']=kids
   else:nd.pop('children',None)
  new_nodes.append(nd)
 g['nodes']=new_nodes
 for scene in g.get('scenes',()):
  scene['nodes']=[nmap[i] for i in scene.get('nodes',()) if i in nmap]
 # Meshes
 keep_meshes=sorted({nd['mesh'] for nd in new_nodes if 'mesh' in nd})
 mmap={old:new for new,old in enumerate(keep_meshes)}
 for nd in new_nodes:
  if 'mesh' in nd:nd['mesh']=mmap[nd['mesh']]
 new_meshes=[]
 for old in keep_meshes:
  m=json.loads(json.dumps(g['meshes'][old]))
  for p in m.get('primitives',()):
   for attr in strip_attrs:p.get('attributes',{}).pop(attr,None)
   if 'extras' in p:
    p['extras'].pop('inspectionPart',None)
    if not p['extras']:p.pop('extras',None)
  new_meshes.append(m)
 g['meshes']=new_meshes
 # Skins
 skin_order=sorted(keep_skins)
 smap={old:new for new,old in enumerate(skin_order)}
 for nd in new_nodes:
  if 'skin' in nd:nd['skin']=smap[nd['skin']]
 new_skins=[]
 for old in skin_order:
  sk=dict(skins[old])
  sk['joints']=[nmap[j] for j in sk.get('joints',())]
  if 'skeleton' in sk:sk['skeleton']=nmap[sk['skeleton']]
  new_skins.append(sk)
 if new_skins:g['skins']=new_skins
 else:g.pop('skins',None)
 # Materials
 keep_mats=sorted({p['material'] for m in new_meshes for p in m.get('primitives',()) if 'material' in p})
 mat_map={old:new for new,old in enumerate(keep_mats)}
 for m in new_meshes:
  for p in m.get('primitives',()):
   if 'material' in p:p['material']=mat_map[p['material']]
 new_mats=[json.loads(json.dumps(g['materials'][old])) for old in keep_mats]
 g['materials']=new_mats
 # Textures, samplers, images
 keep_tex=set()
 for mat in new_mats:_collect_textures(mat,keep_tex)
 tex_order=sorted(keep_tex)
 tmap={old:new for new,old in enumerate(tex_order)}
 for mat in new_mats:_remap_textures(mat,tmap)
 orig_tex=g.get('textures',[])
 new_tex=[dict(orig_tex[old]) for old in tex_order]
 keep_img=sorted({t['source'] for t in new_tex if 'source' in t})
 imap={old:new for new,old in enumerate(keep_img)}
 keep_samp=sorted({t['sampler'] for t in new_tex if 'sampler' in t})
 samp_map={old:new for new,old in enumerate(keep_samp)}
 for t in new_tex:
  if 'source' in t:t['source']=imap[t['source']]
  if 'sampler' in t:t['sampler']=samp_map[t['sampler']]
 if new_tex:g['textures']=new_tex
 else:g.pop('textures',None)
 if keep_img:g['images']=[dict(g['images'][old]) for old in keep_img]
 else:g.pop('images',None)
 if keep_samp:g['samplers']=[dict(g['samplers'][old]) for old in keep_samp]
 else:g.pop('samplers',None)
 # Accessors
 keep_acc=set()
 for m in new_meshes:
  for p in m.get('primitives',()):
   if 'indices' in p:keep_acc.add(p['indices'])
   keep_acc.update(p.get('attributes',{}).values())
   for tgt in p.get('targets',()):keep_acc.update(tgt.values())
 for sk in new_skins:
  if 'inverseBindMatrices' in sk:keep_acc.add(sk['inverseBindMatrices'])
 acc_order=sorted(keep_acc)
 amap={old:new for new,old in enumerate(acc_order)}
 for m in new_meshes:
  for p in m.get('primitives',()):
   if 'indices' in p:p['indices']=amap[p['indices']]
   p['attributes']={k:amap[v] for k,v in p.get('attributes',{}).items()}
   for tgt in p.get('targets',()):
    for k in list(tgt):tgt[k]=amap[tgt[k]]
 for sk in new_skins:
  if 'inverseBindMatrices' in sk:sk['inverseBindMatrices']=amap[sk['inverseBindMatrices']]
 new_acc=[dict(g['accessors'][old]) for old in acc_order]
 g['accessors']=new_acc
 # BufferViews & compact binary
 keep_bv=set()
 for a in new_acc:
  if 'bufferView' in a:keep_bv.add(a['bufferView'])
 for img in g.get('images',()):
  if 'bufferView' in img:keep_bv.add(img['bufferView'])
 bv_order=sorted(keep_bv)
 bv_map={old:new for new,old in enumerate(bv_order)}
 for a in new_acc:
  if 'bufferView' in a:a['bufferView']=bv_map[a['bufferView']]
 for img in g.get('images',()):
  if 'bufferView' in img:img['bufferView']=bv_map[img['bufferView']]
 orig_bvs=g.get('bufferViews',[])
 new_bvs=[];out=bytearray()
 for old in bv_order:
  bv=dict(orig_bvs[old])
  raw=binary[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]
  while len(out)%4:out.append(0)
  bv['byteOffset']=len(out);bv['byteLength']=len(raw);out.extend(raw)
  new_bvs.append(bv)
 while len(out)%4:out.append(0)
 g['bufferViews']=new_bvs
 g['buffers'][0]['byteLength']=len(out)
 js=json.dumps(g,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
 return struct.pack('<III',0x46546c67,2,28+len(js)+len(out))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(out),0x004e4942)+out

def pack_race(source,dest,far_lod=False):
 """Pack an exterior-only racing GLB by pruning hidden under-cowling internals
 (and sub-pixel cockpit/steering details on the >=32 m far LOD)."""
 from tempfile import TemporaryDirectory
 omit=FAR_LOD_OMIT_NODES if far_lod else UNDER_COWLING_NODES
 pruned=prune_glb_bytes(Path(source).read_bytes(),omit,strip_attrs=('_COWLLACQUER',))
 with TemporaryDirectory() as tmp:
  temp_glb=Path(tmp)/('race-low.glb' if far_lod else 'race-high.glb')
  temp_glb.write_bytes(pruned)
  pack(temp_glb,dest,positions=False)
