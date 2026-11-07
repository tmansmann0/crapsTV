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

# The bed remains Y=0. Raised casino walls have a Y=.92 padded crown.
slab('Recessed pine playing bed',10.9,5.6,.94,-.32,0,felt)
ring('Substantial walnut apron',[(11.96,6.66,1.24,-.94),(12,6.7,1.25,-.18),(11.05,5.75,1.02,-.18),(10.98,5.68,.98,-.94)],wood,.045)
ring('Walnut lower plinth',[(11.89,6.59,1.20,-1.02),(11.98,6.68,1.245,-.94),(11.13,5.83,1.06,-.94),(11.13,5.83,1.06,-1.02)],wood,.025)
for z in (-.84,-.26):
    ring('Fine brass apron inlay',[(12.005,6.705,1.255,z),(12.005,6.705,1.255,z+.012),(11.98,6.68,1.245,z+.012),(11.98,6.68,1.245,z)],brass,.003)
# Raised walnut chassis supports the rubber wall and upholstered crown.
ring('Raised walnut wall chassis',[(11.96,6.66,1.24,-.20),(11.96,6.66,1.24,.64),(10.94,5.52,.93,.64),(10.94,5.52,.93,-.20)],wood,.025)
# Eight cross-sectional rings form a real upholstered crown instead of a slab.
rail=ring('Sculpted upholstered oxblood rail',[
    (11.93,6.63,1.22,.54),(12,6.7,1.25,.69),
    (11.97,6.67,1.235,.81),(11.83,6.53,1.165,.885),
    (11.62,6.32,1.06,.92),(11.31,6.01,1.02,.87),
    (11.02,5.72,.99,.73),(10.90,5.48,.89,.65),
    (10.90,5.48,.89,.60)],leather,0)
# Proper vertical rubber bounce wall: the flat inner face is X +/-5.45,
# Z +/-2.74, Y=.02..74. Pyramids project .03 into the playing volume.
rubber=material('Dark pine pyramid bounce rubber',(.008,.025,.019),.83)
ring('Vertical rubber bounce wall',[(11.10,5.68,.99,.02),(11.10,5.68,.99,.74),(10.90,5.48,.89,.74),(10.90,5.48,.89,.02)],rubber,0)
ring('Rubber wall lower bead',[(10.915,5.495,.897,.018),(10.915,5.495,.897,.043),(10.895,5.475,.887,.043),(10.895,5.475,.887,.018)],rubber,.004)
ring('Brass cushion support detail',[(11.965,6.665,1.243,.582),(11.965,6.665,1.243,.594),(11.940,6.640,1.230,.594),(11.940,6.640,1.230,.582)],brass,.003)
# Low-poly molded pyramid rubber on all four straight sides and rounded corners.
# One joined mesh retains the physical texture without hundreds of draw calls.
perimeter=rounded(10.90,5.48,.89,n=36)
segments=[];total=0
for i,point in enumerate(perimeter):
    nextpoint=perimeter[(i+1)%len(perimeter)]
    dx,dy=nextpoint[0]-point[0],nextpoint[1]-point[1]
    length=math.hypot(dx,dy)
    segments.append((total,length,point,(dx/length,dy/length)))
    total+=length
vertices=[];polys=[]
for row,height in enumerate((.18,.38,.58)):
    distance=.1+(row%2)*.10
    while distance<total:
        for start,length,point,tangent in segments:
            if start<=distance<start+length:
                t=(distance-start)
                x,y=point[0]+t*tangent[0],point[1]+t*tangent[1]
                tx,ty=tangent;nx,ny=-ty,tx
                offset=len(vertices)
                vertices.extend([(x,y,height+.078),(x+tx*.078,y+ty*.078,height),(x,y,height-.078),(x-tx*.078,y-ty*.078,height),(x+nx*.030,y+ny*.030,height)])
                polys.extend((offset+a,offset+b,offset+4) for a,b in ((0,1),(1,2),(2,3),(3,0)))
                break
        distance+=.20
mesh=bpy.data.meshes.new('Molded rubber pyramid mesh');mesh.from_pydata(vertices,[],polys);mesh.update()
studs=bpy.data.objects.new('Molded rubber pyramids',mesh);bpy.context.collection.objects.link(studs)
finish(studs,studs.name,rubber)
for face in mesh.polygons:face.use_smooth=False
# A stitched seam follows the outer shoulder; tiny dashes retain softness.
seam=material('Oxblood seam thread',(.10,.036,.028),.8)
outerpath=rounded(11.88,6.58,1.19,n=100)
stitches=[]
for i in range(0,len(outerpath),3):
    x,y=outerpath[i]
    xn,yn=outerpath[(i+1)%len(outerpath)]
    dash=cube('Upholstery stitch',(.034,.006,.004),((x+xn)/2,(y+yn)/2,.832),seam,0)
    dash.rotation_euler.z=math.atan2(yn-y,xn-x)
    stitches.append(dash)
bpy.ops.object.select_all(action='DESELECT')
for stitch in stitches: stitch.select_set(True)
bpy.context.view_layer.objects.active=stitches[0];bpy.ops.object.join()
stitches[0].name='Continuous rail stitch detail'
# Real cut-through holes with dark recessed cups and polished brass rims.
for x in (-4.0,4.0):
    for y in (-3.055,3.055):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.18,depth=1.0,location=(x,y,.75))
        cutter=bpy.context.object
        bpy.context.view_layer.objects.active=rail
        mod=rail.modifiers.new('Recessed cup holder cutout','BOOLEAN')
        mod.operation='DIFFERENCE';mod.object=cutter
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
        cylinder('Cup well floor',.176,.018,(x,y,.648),black)
        # Open sides, with the floor visible down inside.
        path=[(math.cos(a*math.tau/48)*.176+x,math.sin(a*math.tau/48)*.176+y) for a in range(48)]
        verts=[(px,py,z) for z in (.648,.865) for px,py in path]
        faces=[(i,(i+1)%48,(i+1)%48+48,i+48) for i in range(48)]
        mesh=bpy.data.meshes.new('Cup wall');mesh.from_pydata(verts,[],faces);mesh.update()
        well=bpy.data.objects.new('Recessed cup well',mesh);bpy.context.collection.objects.link(well);finish(well,well.name,black)
        bpy.ops.mesh.primitive_torus_add(major_radius=.18,minor_radius=.015,major_segments=48,minor_segments=8,location=(x,y,.865))
        finish(bpy.context.object,'Brass cup lip',brass)
# Broad end pedestals feel like furniture, with smaller inset feet.
for x in (-3.75,3.75):
    cube('Walnut trestle pedestal',(1.12,3.65,1.55),(x,0,-1.68),wood,.16)
    cube('Inset black pedestal foot',(1.19,3.82,.18),(x,0,-2.43),black,.06)
    cube('Brass pedestal reveal',(1.15,3.70,.045),(x,0,-2.31),brass,.015)
# Small dealer rack on the far rail, outside the playing/odds surface.
cube('Dealer walnut chip rack',(2.40,.49,.16),(0,3.04,.92),wood,.055)
cube('Rack dark inset',(2.25,.39,.07),(0,3.04,1.02),black,.03)
chipcolors=[(.62,.55,.40),(.42,.015,.025),(.015,.12,.075),(.025,.07,.20),(.14,.045,.20),(.025,.027,.025)]
for j,col in enumerate(chipcolors):
    cm=material(f'Dealer chip color {j}',col,.4)
    parts=[]
    for k in range(8):
        parts.append(cylinder('Dealer rack chip',.139,.032,(-.94+j*.376,2.9+k*.038,1.09),cm,(math.pi/2,0,0)))
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
# Inspection lighting belongs only to the preview, not the exported asset.
for loc,energy,size,color in [((0,-2,8),1500,7,(1,.88,.72)),((-5,3,6),950,5,(.76,.86,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    lamp=bpy.context.object;lamp.data.energy=energy;lamp.data.shape='DISK';lamp.data.size=size;lamp.data.color=color
    lamp.rotation_euler=(Vector((0,0,0))-lamp.location).to_track_quat('-Z','Y').to_euler()
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
