"""Read-only Cycles QA for the table-materials.js palette; saves PNGs only."""
from pathlib import Path
import math
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/source/table-player-rails-optimized.blend'))
image_cache={}
def image(name,color=False):
    if name not in image_cache:
        im=bpy.data.images.load(str(OUT/name));im.colorspace_settings.name='sRGB' if color else 'Non-Color';image_cache[name]=im
    return image_cache[name]
def tex(mat,key,uv,color=False):
    nodes=mat.node_tree.nodes;t=nodes.new('ShaderNodeTexImage');t.image=image(key.replace('walnut-albedo.png','walnut-albedo.jpg'),color);t.extension='REPEAT'
    u=nodes.new('ShaderNodeUVMap');u.uv_map=uv
    if 'walnut' in key:
        scale=nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs[3].default_value=.8/4;mat.node_tree.links.new(u.outputs['UV'],scale.inputs[0]);mat.node_tree.links.new(scale.outputs[0],t.inputs['Vector'])
    else:mat.node_tree.links.new(u.outputs['UV'],t.inputs['Vector'])
    return t
specs={
'Hand-polished dark walnut':('walnut',.55,0,.16),
'Deep oxblood leather':('leather',.75,0,.015),
'Dark pine pyramid bounce rubber':('rubber',1,0,0),
'Aged champagne brass':('brass',.3,.88,0),
'Dark recessed cup wells':('black',.4,0,0),
}
for name,(prefix,strength,metal,coat) in specs.items():
    mat=bpy.data.materials.get(name)
    if not mat:continue
    mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();out=nodes.new('ShaderNodeOutputMaterial');bsdf=nodes.new('ShaderNodeBsdfPrincipled');mat.node_tree.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value=(1,1,1,1);bsdf.inputs['Metallic'].default_value=metal
    bsdf.inputs['Coat Weight'].default_value=coat;bsdf.inputs['Coat Roughness'].default_value=.38 if prefix=='walnut' else .75
    color_uv='Material UV' if prefix=='leather' else 'Detail UV'
    t=tex(mat,f'material-table-{prefix}-albedo.png',color_uv,True);mat.node_tree.links.new(t.outputs['Color'],bsdf.inputs['Base Color'])
    t=tex(mat,f'material-table-{prefix}-roughness.png','Detail UV');mat.node_tree.links.new(t.outputs['Color'],bsdf.inputs['Roughness'])
    normalfile='table-rubber-normal.png' if prefix=='rubber' else f'material-table-{prefix}-normal.png'
    t=tex(mat,normalfile,'Detail UV');normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='Detail UV';normal.inputs['Strength'].default_value=strength
    mat.node_tree.links.new(t.outputs['Color'],normal.inputs['Color']);mat.node_tree.links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
# Existing printed felt stays unmodified: the same original board image.
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,.012));board=bpy.context.object;board.scale=(5.42,2.70,1)
m=bpy.data.materials.new('Existing printed felt');m.use_nodes=True;n=m.node_tree.nodes;t=n.new('ShaderNodeTexImage');t.image=image('board-classic.png',True)
m.node_tree.links.new(t.outputs['Color'],n.get('Principled BSDF').inputs['Base Color']);n.get('Principled BSDF').inputs['Roughness'].default_value=.98;board.data.materials.append(m)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.world.use_nodes=True;n=scene.world.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputWorld');bg=n.new('ShaderNodeBackground');env=n.new('ShaderNodeTexEnvironment');env.image=image('casino-room.exr');scene.world.node_tree.links.new(env.outputs['Color'],bg.inputs['Color']);scene.world.node_tree.links.new(bg.outputs['Background'],out.inputs['Surface']);bg.inputs['Strength'].default_value=.7
for loc,power,size in [((-4,-4,10),1000,6),((7,7,4),450,5)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.2))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam
scene.render.resolution_x=1400;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
for name,loc,target,lens in [
 ('material-table-walnut-closeup',(3.6,-5.9,3.0),(2.4,-3.0,.45),52),
 ('material-table-corner-closeup',(6.5,-5.1,2.7),(4.45,-2.25,.48),48),
]:
    cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=lens
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
