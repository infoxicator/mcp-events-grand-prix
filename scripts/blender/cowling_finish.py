"""Paint wrapped around the free edge of the removable engine fairing."""
import json
import struct
from pathlib import Path

# Longitudinal station and the two edges of the wrap as fractions of the cut height.
WRAP = [(-2.20, .73, 1.03), (-2.04, .61, 1.03), (-1.89, .51, 1.03),
        (-1.66, .43, 1.03), (-1.43, .34, .96), (-1.19, .25, .86),
        (-1.08, .29, .78), (-.86, .50, .71), (-.68, .55, .64)]


def coverage(x, y, z):
    if abs(x) > .404 or not WRAP[0][0] < z < WRAP[-1][0]:
        return 0.
    height = (y - .590) / (.138 + .045 * (z + 2.19))
    for a, b in zip(WRAP, WRAP[1:]):
        if z < b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            low = a[1] + t * (b[1] - a[1])
            high = a[2] + t * (b[2] - a[2])
            return max(0., min(1., (height-low)*40, (high-height)*40))
    return 0.


def apply_blender_finish(skin):
    # The object flag confines the exposed laminate to this body even when its
    # exterior material is shared with other parts of the car.
    skin['Removable cowl'] = 1.
    mask = skin.data.attributes.get('CowlLacquer')
    if mask is None:
        mask = skin.data.attributes.new('CowlLacquer', 'FLOAT', 'POINT')
    for vertex, value in zip(skin.data.vertices, mask.data):
        value.value = coverage(*vertex.co)
    for material in skin.data.materials:
        nodes, links = material.node_tree.nodes, material.node_tree.links
        if nodes.get('Cowling inward finish'):
            continue
        output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
        outside = output.inputs['Surface'].links[0].from_socket
        boundary = nodes.new('ShaderNodeAttribute')
        boundary.attribute_name = 'CowlLacquer'
        colour = nodes.new('ShaderNodeMixRGB')
        colour.inputs[1].default_value = (.022, .024, .028, 1)
        colour.inputs[2].default_value = (.66, .010, .018, 1)
        links.new(boundary.outputs['Fac'], colour.inputs[0])
        inside = nodes.new('ShaderNodeBsdfPrincipled')
        links.new(colour.outputs[0], inside.inputs['Base Color'])
        finish = nodes.new('ShaderNodeMapRange')
        finish.inputs['To Min'].default_value = .52
        finish.inputs['To Max'].default_value = .20
        links.new(boundary.outputs['Fac'], finish.inputs['Value'])
        links.new(finish.outputs['Result'], inside.inputs['Roughness'])
        inside.inputs['Coat Weight'].default_value = .25
        inside.inputs['Metallic'].default_value = .18
        flag = nodes.new('ShaderNodeAttribute')
        flag.attribute_type = 'OBJECT'
        flag.attribute_name = 'Removable cowl'
        inward = nodes.new('ShaderNodeMath')
        inward.operation = 'MULTIPLY'
        links.new(nodes.new('ShaderNodeNewGeometry').outputs['Backfacing'], inward.inputs[0])
        links.new(flag.outputs['Fac'], inward.inputs[1])
        sides = nodes.new('ShaderNodeMixShader')
        sides.name = 'Cowling inward finish'
        links.new(inward.outputs[0], sides.inputs[0])
        links.new(outside, sides.inputs[1])
        links.new(inside.outputs[0], sides.inputs[2])
        links.new(sides.outputs[0], output.inputs['Surface'])


def add_export_weights(path: Path):
    """Encode the same rest-space mask on both racing LODs before packing."""
    source = path.read_bytes()
    size = struct.unpack_from('<I', source, 12)[0]
    gltf = json.loads(source[20:20+size])
    binary = bytearray(source[28+size:])
    body = next(node['mesh'] for node in gltf['nodes'] if node['name'] == 'Chassis_TwoToneCover')
    masks = {}
    for prim in gltf['meshes'][body]['primitives']:
        attrs = prim['attributes']
        if '_COWLLACQUER' in attrs:
            continue
        index = attrs['POSITION']
        if index not in masks:
            acc = gltf['accessors'][index]
            if (acc['componentType'], acc['type']) != (5126, 'VEC3'):
                raise ValueError('Expected float body positions before GLB packing')
            view = gltf['bufferViews'][acc['bufferView']]
            start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
            stride = view.get('byteStride', 12)
            values = bytearray(4 * acc['count'])
            for i in range(acc['count']):
                values[4*i] = round(255 * coverage(*struct.unpack_from('<fff', binary, start+i*stride)))
            binary.extend(bytes(-len(binary) % 4))
            target = len(gltf['bufferViews'])
            gltf['bufferViews'].append(dict(buffer=0, byteOffset=len(binary), byteLength=len(values),
                                            byteStride=4, target=34962))
            binary.extend(values)
            masks[index] = len(gltf['accessors'])
            gltf['accessors'].append(dict(bufferView=target, componentType=5121, normalized=True,
                                          count=acc['count'], type='SCALAR'))
        attrs['_COWLLACQUER'] = masks[index]
    if not masks:
        return
    gltf['buffers'][0]['byteLength'] = len(binary)
    doc = json.dumps(gltf, separators=(',', ':')).encode()
    doc += b' ' * (-len(doc) % 4)
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28+len(doc)+len(binary), len(doc), 0x4e4f534a)
                     + doc + struct.pack('<II', len(binary), 0x004e4942) + binary)
