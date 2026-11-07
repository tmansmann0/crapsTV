"""Build crapsTV's original sculpted casino table. Existing dice and HDR are preserved.

Run: blender --background --python scripts/build-models.py
Blender 4.5 LTS. No network, add-ons, external fonts, or assets required.
"""
import math
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
SOURCE = ROOT / 'assets/source'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)

def clean():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

def material(name, color, roughness=.5, metal=0):
    mat=bpy.data.materials.new(name)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Roughness'].default_value=roughness
    bsdf.inputs['Metallic'].default_value=metal
    return mat

def finish(obj,name,mat,bevel=0):
    obj.name=name
    obj.data.materials.append(mat)
    if not obj.data.uv_layers:
        uv=obj.data.uv_layers.new(name='Material UV')
        for poly in obj.data.polygons:
            for index in poly.loop_indices:
                co=obj.data.vertices[obj.data.loops[index].vertex_index].co
                if abs(poly.normal.z)>.5:
                    xy=((co.x+6)/12,(co.y+3.35)/6.7)
                elif abs(poly.normal.y)>.5:
                    xy=((co.x+6)/4,(co.z+1)*.8)
                else:
                    xy=((co.y+3.35)/3,(co.z+1)*.8)
                uv.data[index].uv=xy
    if bevel:
        mod=obj.modifiers.new('Soft crafted edges','BEVEL')
        mod.width=bevel
        mod.segments=3
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth=True
    if bevel:
        weighted=obj.modifiers.new('Face-weighted normals','WEIGHTED_NORMAL')
        weighted.keep_sharp=True
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=weighted.name)
    return obj

def cube(name,scale,loc,mat,bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    obj=bpy.context.object
    obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,mat,bevel)

def rounded(w,d,r,n=28):
    result=[]
    for cx,cy,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for k in range(n+1):
            a=math.radians(start+k*90/n)
            result.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return result

def ring(name,layers,mat,bevel=.025):
    verts=[]
    for w,d,r,z in layers:
        verts.extend((x,y,z) for x,y in rounded(w,d,r))
    count=len(verts)//len(layers)
    faces=[]
    for j in range(len(layers)):
        nextj=(j+1)%len(layers)
        for i in range(count):
            ni=(i+1)%count
            faces.append((j*count+i,j*count+ni,nextj*count+ni,nextj*count+i))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    finish(obj,name,mat,bevel)
    obj.select_set(False)
    return obj

def slab(name,w,d,r,bottom,top,mat):
    path=rounded(w,d,r)
    n=len(path)
    verts=[(x,y,z) for z in (bottom,top) for x,y in path]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj,name,mat,.015)

def export(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT/name),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)

def image_texture(name, rgb):
    h,w,_=rgb.shape
    rgba=np.ones((h,w,4),dtype=np.float32)
    rgba[:,:,:3]=rgb
    image=bpy.data.images.new(name,width=w,height=h)
    image.pixels.foreach_set(rgba.ravel())
    image.file_format='PNG'
    image.filepath_raw=str(OUT/(name+'.png'))
    image.save()
    return image


def textured(mat, image):
    nodes=mat.node_tree.nodes
    tex=nodes.new('ShaderNodeTexImage')
    tex.image=image
    mat.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])


def cylinder(name,radius,depth,loc,mat,rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=radius,depth=depth,location=loc)
    obj=bpy.context.object
    if rotation: obj.rotation_euler=rotation
    return finish(obj,name,mat,.007)


clean()
wood=material('Hand-polished dark walnut',(.075,.027,.016),.26)
wood.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.32
leather=material('Deep oxblood leather',(.031,.0035,.007),.42)
leather.node_tree.nodes.get('Principled BSDF').inputs['Coat Weight'].default_value=.08
brass=material('Aged champagne brass',(.54,.36,.13),.27,.9)
felt=material('Deep pine baize',(.009,.075,.055),.97)
black=material('Dark recessed cup wells',(.004,.005,.004),.36,.3)
# Real embedded base-color texture makes the grain portable to glTF viewers.
rng=np.random.default_rng(28)
yy,xx=np.mgrid[0:512,0:512]
u,v=xx/512,yy/512
swirl=np.sin(u*12+np.sin(v*8)*.7)+np.sin(u*31+v*4)*.25
grain=np.sin(v*185+swirl*2.3)+.36*np.sin(v*680+swirl*4)
noise=rng.normal(0,.025,(512,512))
woodrgb=np.clip(np.array([.31,.185,.095])[None,None,:]*(1+.22*grain[:,:,None]+noise[:,:,None]),0,1)
textured(wood,image_texture('table-walnut-grain',woodrgb))
leatherrgb=np.clip(np.array([.25,.047,.074])[None,None,:]*(1+rng.normal(0,.1,(512,512,1))),0,1)
textured(leather,image_texture('table-oxblood-leather',leatherrgb))
normalrgb=np.ones((256,256,3),dtype=np.float32)
normalrgb[:,:,:2]=.5+rng.normal(0,.035,(256,256,2))
normalimage=image_texture('table-leather-normal',normalrgb)
normalimage.colorspace_settings.name='Non-Color'
normaltex=leather.node_tree.nodes.new('ShaderNodeTexImage');normaltex.image=normalimage
normalnode=leather.node_tree.nodes.new('ShaderNodeNormalMap');normalnode.inputs['Strength'].default_value=.22
leather.node_tree.links.new(normaltex.outputs['Color'],normalnode.inputs['Color'])
leather.node_tree.links.new(normalnode.outputs['Normal'],leather.node_tree.nodes.get('Principled BSDF').inputs['Normal'])

# Felt is recessed beneath a sculpted, padded rail. The crown stays near Y=.3.
slab('Recessed pine playing bed',10.9,5.6,.94,-.32,0,felt)
ring('Substantial walnut apron',[(11.96,6.66,1.24,-.94),(12,6.7,1.25,-.18),(11.05,5.75,1.02,-.18),(10.98,5.68,.98,-.94)],wood,.045)
ring('Walnut lower plinth',[(11.89,6.59,1.20,-1.02),(11.98,6.68,1.245,-.94),(11.13,5.83,1.06,-.94),(11.13,5.83,1.06,-1.02)],wood,.025)
for z in (-.84,-.26):
    ring('Fine brass apron inlay',[(12.005,6.705,1.255,z),(12.005,6.705,1.255,z+.012),(11.98,6.68,1.245,z+.012),(11.98,6.68,1.245,z)],brass,.003)
# Eight cross-sectional rings form a real upholstered crown instead of a slab.
rail=ring('Sculpted upholstered oxblood rail',[
    (11.93,6.63,1.22,-.16),(12,6.7,1.25,.04),
    (11.97,6.67,1.235,.18),(11.83,6.53,1.165,.285),
    (11.62,6.32,1.06,.32),(11.31,6.01,1.02,.27),
    (11.02,5.72,.99,.13),(10.90,5.60,.94,-.05),
    (10.90,5.60,.94,-.18)],leather,0)
# A low interior wood wall and brass bead make the playing bed read as recessed.
ring('Interior walnut cushion support',[(10.94,5.64,.96,-.20),(10.94,5.64,.96,.04),(10.89,5.59,.935,.04),(10.89,5.59,.935,-.20)],wood,.009)
ring('Inner brass bead',[(10.955,5.655,.966,.048),(10.95,5.65,.964,.069),(10.918,5.618,.947,.069),(10.918,5.618,.947,.048)],brass,.006)
# A stitched seam follows the outer shoulder; tiny dashes retain softness.
seam=material('Oxblood seam thread',(.10,.036,.028),.8)
outerpath=rounded(11.88,6.58,1.19,n=100)
stitches=[]
for i in range(0,len(outerpath),3):
    x,y=outerpath[i]
    xn,yn=outerpath[(i+1)%len(outerpath)]
    dash=cube('Upholstery stitch',(.034,.006,.004),((x+xn)/2,(y+yn)/2,.232),seam,0)
    dash.rotation_euler.z=math.atan2(yn-y,xn-x)
    stitches.append(dash)
bpy.ops.object.select_all(action='DESELECT')
for stitch in stitches: stitch.select_set(True)
bpy.context.view_layer.objects.active=stitches[0];bpy.ops.object.join()
stitches[0].name='Continuous rail stitch detail'
# Real cut-through holes with dark recessed cups and polished brass rims.
for x in (-4.0,4.0):
    for y in (-3.055,3.055):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.18,depth=.8,location=(x,y,.10))
        cutter=bpy.context.object
        bpy.context.view_layer.objects.active=rail
        mod=rail.modifiers.new('Recessed cup holder cutout','BOOLEAN')
        mod.operation='DIFFERENCE';mod.object=cutter
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
        cylinder('Cup well floor',.176,.018,(x,y,-.15),black)
        # Open sides, with the floor visible down inside.
        path=[(math.cos(a*math.tau/48)*.176+x,math.sin(a*math.tau/48)*.176+y) for a in range(48)]
        verts=[(px,py,z) for z in (-.15,.26) for px,py in path]
        faces=[(i,(i+1)%48,(i+1)%48+48,i+48) for i in range(48)]
        mesh=bpy.data.meshes.new('Cup wall');mesh.from_pydata(verts,[],faces);mesh.update()
        well=bpy.data.objects.new('Recessed cup well',mesh);bpy.context.collection.objects.link(well);finish(well,well.name,black)
        bpy.ops.mesh.primitive_torus_add(major_radius=.18,minor_radius=.015,major_segments=48,minor_segments=8,location=(x,y,.265))
        finish(bpy.context.object,'Brass cup lip',brass)
# Broad end pedestals feel like furniture, with smaller inset feet.
for x in (-3.75,3.75):
    cube('Walnut trestle pedestal',(1.12,3.65,1.55),(x,0,-1.68),wood,.16)
    cube('Inset black pedestal foot',(1.19,3.82,.18),(x,0,-2.43),black,.06)
    cube('Brass pedestal reveal',(1.15,3.70,.045),(x,0,-2.31),brass,.015)
# Small dealer rack on the far rail, outside the playing/odds surface.
cube('Dealer walnut chip rack',(2.40,.49,.16),(0,3.04,.32),wood,.055)
cube('Rack dark inset',(2.25,.39,.07),(0,3.04,.42),black,.03)
chipcolors=[(.62,.55,.40),(.42,.015,.025),(.015,.12,.075),(.025,.07,.20),(.14,.045,.20),(.025,.027,.025)]
for j,col in enumerate(chipcolors):
    cm=material(f'Dealer chip color {j}',col,.4)
    parts=[]
    for k in range(8):
        parts.append(cylinder('Dealer rack chip',.139,.032,(-.94+j*.376,2.9+k*.038,.49),cm,(math.pi/2,0,0)))
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:part.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    parts[0].name=f'Dealer chip stack {j+1}'
export('table.glb')
for texture in bpy.data.images:
    if texture.name.startswith('table-'): texture.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'table.blend'),compress=True)

# Table QA render uses the same exported dimensions and provided felt artwork.
# The playable app changes this plane when the game mode changes.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'table.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.world.use_nodes=True
nodes=scene.world.node_tree.nodes
env=nodes.new('ShaderNodeTexEnvironment')
environment=OUT/'casino-room.exr'
if not environment.exists(): environment=OUT/'casino-studio.hdr'
env.image=bpy.data.images.load(str(environment))
scene.world.node_tree.links.new(env.outputs['Color'],nodes.get('Background').inputs['Color'])
nodes.get('Background').inputs['Strength'].default_value=.6
board=bpy.data.materials.new('Classic layout QA texture')
board.use_nodes=True
bn=board.node_tree.nodes
im=bn.new('ShaderNodeTexImage')
im.image=bpy.data.images.load(str(OUT/'board-classic.png'))
board.node_tree.links.new(im.outputs['Color'],bn.get('Principled BSDF').inputs['Base Color'])
board.node_tree.links.new(im.outputs['Alpha'],bn.get('Principled BSDF').inputs['Alpha'])
bn.get('Principled BSDF').inputs['Roughness'].default_value=.97
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,.012))
bpy.context.object.scale=(5.42,2.70,1)
bpy.context.object.data.materials.append(board)
bpy.ops.object.camera_add(location=(9.0,-13.7,12.4))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,-.1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=45
scene.camera=camera
scene.render.resolution_x=1600
scene.render.resolution_y=1080
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'table-preview.png')
scene.render.film_transparent=True
bpy.ops.render.render(write_still=True)
print('Created refined table.glb, table.blend, embedded material textures, and table-preview.png; dice and environments preserved')
