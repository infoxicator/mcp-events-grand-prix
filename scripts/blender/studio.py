"""Native Blender inspection scene for the same high-detail racing mesh."""
import bpy
from mathutils import Matrix, Vector


def save_studio(path):
    scene = bpy.context.scene
    old_studio=bpy.data.collections.get('Inspection studio')
    if old_studio:
        for obj in list(old_studio.objects):
            bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.collections.remove(old_studio)
    studio = bpy.data.collections.new('Inspection studio')
    scene.collection.children.link(studio)
    up = Vector((0, 1, 0))

    def aim(obj, point):
        back = (obj.location - Vector(point)).normalized()
        right = up.cross(back).normalized()
        obj.rotation_euler = Matrix((right, back.cross(right), back)).transposed().to_euler()

    def light(name, position, size, power, color):
        data = bpy.data.lights.new(name, 'AREA')
        data.shape = 'RECTANGLE'
        data.size, data.size_y = size
        data.energy, data.color = power, color
        obj = bpy.data.objects.new(name, data)
        studio.objects.link(obj)
        obj.location = position
        aim(obj, (0,.42,0))

    for name in ('NumberB','HelmetNumberB'):
        for part in bpy.data.objects[name].children_recursive:
            part.hide_render = True
            part.hide_set(True)
    camera = bpy.data.objects.new('Studio camera', bpy.data.cameras.new('Studio camera'))
    studio.objects.link(camera)
    camera.location=(-4.9,2.82,5.18)
    target=(0,.44,.45)
    aim(camera,target)
    camera.data.lens=44
    scene.camera=camera
    light('Overhead silk',(-1.6,5.2,1.0),(3.7,6.6),600,(1,.96,.91))
    light('Cool edge',(3.3,2.2,-2.4),(5.4,1.15),430,(.80,.88,1.0))
    light('Front strip',(-3.7,1.8,3.8),(.60,3.4),225,(1,.98,.94))
    light('Rear softbox',(-1.2,2.4,-4.2),(2.6,3.4),320,(.89,.93,1))
    floor_mesh=bpy.data.meshes.new('Studio floor')
    floor_mesh.from_pydata([(-120,-.001,-120),(-120,-.001,120),(120,-.001,120),(120,-.001,-120)],[],[(0,1,2,3)])
    floor=bpy.data.objects.new('Graphite floor',floor_mesh)
    studio.objects.link(floor)
    mat=bpy.data.materials.new('Studio graphite')
    mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(.013,.018,.026,1)
    shader.inputs['Roughness'].default_value=.52
    shader.inputs['Specular IOR Level'].default_value=.13
    floor.data.materials.append(mat)
    for name,coat,rough in [('Livery',.53,.26),('Ivory',.37,.30),('HelmetPaint',.65,.22)]:
        shader=bpy.data.materials[name].node_tree.nodes.get('Principled BSDF')
        shader.inputs['Coat Weight'].default_value=coat
        shader.inputs['Coat Roughness'].default_value=rough
    # Give the offline source the same material distinctions as the realtime
    # shader: a soft rubber shoulder, satin laminate, woven racewear and coated paint.
    # Real-world surface scales avoid the oversized bumps of a display model.
    for name,scale,strength,distance,rough in [
        ('Rubber',1350,.18,.00015,.83),('Carbon',1600,.10,.00010,.36),
        ('AeroLaminate',1900,.08,.00008,.47),('GloveFabric',840,.19,.00021,.94),
        ('GloveSuede',1300,.16,.00014,.96),('Sleeve',800,.16,.00017,.92),
        ('Livery',2100,.045,.000025,.31),('Ivory',2100,.045,.000025,.34)]:
        material=bpy.data.materials[name]
        nodes=material.node_tree.nodes
        links=material.node_tree.links
        shader=nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value=rough
        coords=nodes.get('Physical coordinates') or nodes.new('ShaderNodeNewGeometry')
        coords.name='Physical coordinates'
        grain=nodes.get('Surface grain') or nodes.new('ShaderNodeTexNoise')
        grain.name='Surface grain'
        grain.inputs['Scale'].default_value=scale
        grain.inputs['Detail'].default_value=2
        links.new(coords.outputs['Position'],grain.inputs['Vector'])
        bump=nodes.get('Microsurface') or nodes.new('ShaderNodeBump')
        bump.name='Microsurface'
        bump.inputs['Strength'].default_value=strength
        bump.inputs['Distance'].default_value=distance
        links.new(grain.outputs['Fac'],bump.inputs['Height'])
        links.new(bump.outputs['Normal'],shader.inputs['Normal'])
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.world.use_nodes=True
    world=scene.world.node_tree.nodes.get('Background')
    world.inputs['Color'].default_value=(.25,.28,.34,1)
    world.inputs['Strength'].default_value=.28
    scene.render.engine='CYCLES'
    scene.cycles.samples=48
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1440
    scene.render.resolution_y=900
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    bpy.ops.object.select_all(action='DESELECT')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                space=area.spaces.active
                space.overlay.show_overlays=False
                space.shading.color_type='MATERIAL'
                space.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
                space.region_3d.view_location=target
                space.region_3d.view_distance=(camera.location-Vector(target)).length
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


if __name__=='__main__':
    save_studio(bpy.data.filepath)
