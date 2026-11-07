"""Build crapsTV's original table, dice, and scene-linear HDR illumination.

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

def rounded(w,d,r,n=16):
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

clean()
wood=material('Burgundy walnut',(.055,.014,.018),.3)
leather=material('Oxblood padded leather',(.085,.012,.018),.53)
brass=material('Brushed champagne brass',(.65,.43,.16),.28,.83)
felt=material('Jade felt',(.018,.145,.116),.96)
black=material('Black lacquer',(.012,.014,.013),.32,.25)

# Dimensions become X=12, Z=6.7, top Y=.02 when exported Y-up.
slab('Felt playing surface',10.9,5.6,.95,-.2,0,felt)
ring('Walnut apron',[(12,6.7,1.25,-.56),(12,6.7,1.25,-.05),(10.95,5.65,1,-.05),(10.95,5.65,1,-.56)],wood)
ring('Brass lower trim',[(12.025,6.725,1.26,-.50),(12.025,6.725,1.26,-.45),(11.94,6.64,1.22,-.45),(11.94,6.64,1.22,-.50)],brass,.005)
ring('Cushioned rail',[(12,6.7,1.25,-.07),(12,6.7,1.25,.20),(10.9,5.6,.95,.20),(10.9,5.6,.95,-.07)],leather,.07)
ring('Brass inner pinstripe',[(10.95,5.65,.975,.12),(10.95,5.65,.975,.16),(10.88,5.58,.94,.16),(10.88,5.58,.94,.12)],brass,.007)
for x in (-3.8,3.8):
    for y in (-1.7,1.7):
        cube('Walnut pedestal',(0.58,.58,1.45),(x,y,-1.22),wood,.13)
        cube('Brass pedestal shoe',(.61,.61,.14),(x,y,-1.89),brass,.035)
for x in (-4.6,-2.3,0,2.3,4.6):
    # Decorative rail seams; unobtrusive in the main overhead view.
    cube('Rail brass marker',(.026,.17,.009),(x,-3.06,.264),brass,.004)
export('table.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'table.blend'),compress=True)

# Dice use conventional opposite faces summing to seven. The export rotates
# Blender Z-up to glTF Y-up: +Y=1, -Y=6, +Z=2, -Z=5, +X=3, -X=4.
clean()
red=material('Ruby casino resin',(.48,.008,.02),.19)
bs=red.node_tree.nodes.get('Principled BSDF')
bs.inputs['Coat Weight'].default_value=.4
bs.inputs['Coat Roughness'].default_value=.12
ivory=material('Ivory recessed pips',(.96,.91,.78),.24)
body=cube('Casino die',(1,1,1),(0,0,0),red,.065)
patterns={1:[(0,0)],2:[(-1,-1),(1,1)],3:[(-1,-1),(0,0),(1,1)],4:[(-1,-1),(-1,1),(1,-1),(1,1)],5:[(-1,-1),(-1,1),(0,0),(1,-1),(1,1)],6:[(-1,-1),(-1,0),(-1,1),(1,-1),(1,0),(1,1)]}
faces=[(1,(0,0,1),(1,0,0),(0,1,0)),(6,(0,0,-1),(1,0,0),(0,1,0)),(2,(0,-1,0),(1,0,0),(0,0,1)),(5,(0,1,0),(1,0,0),(0,0,1)),(3,(1,0,0),(0,1,0),(0,0,1)),(4,(-1,0,0),(0,1,0),(0,0,1))]
for value,normal,tangent,up in faces:
    n,t,u=Vector(normal),Vector(tangent),Vector(up)
    for j,(a,b) in enumerate(patterns[value]):
        pos=n*.498+t*(a*.225)+u*(b*.225)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.070,location=pos)
        pip=bpy.context.object
        # A shallow ivory inlay, rather than a floating sphere.
        for v in pip.data.vertices:
            offset=v.co.dot(n)
            v.co-=n*(offset*.83)
        finish(pip,f'Face {value} pip {j+1}',ivory)
export('dice.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'dice.blend'),compress=True)

# A true floating-point equirectangular lighting map: values exceed display
# white, with broad overhead softboxes and warm casino wall lights. This is
# procedural illumination, not an image-generated photograph.
w,h=1024,512
yy,xx=np.mgrid[0:h,0:w]
theta=(xx+.5)/w*2*math.pi
phi=(1-(yy+.5)/h)*math.pi  # Blender pixel buffers start at the bottom row.
dx=np.sin(phi)*np.cos(theta)
dy=np.cos(phi)
dz=np.sin(phi)*np.sin(theta)
rgb=np.zeros((h,w,3),dtype=np.float32)
rgb[:]=[.055,.045,.040]
rgb+=np.maximum(dy,0)[...,None]*np.array([.055,.035,.020])
for angle in range(0,360,60):
    a=math.radians(angle)
    dot=dx*math.cos(a)*.96+dy*.28+dz*math.sin(a)*.96
    glow=np.exp((dot-1)/.014)*16
    rgb+=glow[...,None]*np.array([1.,.54,.22])
for direction,power,spread,col in [((.3,.92,.25),9,.10,(1.,.78,.5)),((-.6,.75,-.2),6,.08,(.68,.86,1.)),((.2,.4,-.9),12,.024,(1.,.5,.19))]:
    v=np.array(direction);v=v/np.linalg.norm(v)
    dot=dx*v[0]+dy*v[1]+dz*v[2]
    rgb+=np.exp((dot-1)/spread)[...,None]*power*np.array(col)
# Write linear RGBE directly to avoid applying an image display/view transform.
# Radiance scanlines are top-down; the working Blender pixel grid is bottom-up.
linear=rgb[::-1]
maximum=np.max(linear,axis=2)
mantissa,exponent=np.frexp(maximum)
multiplier=np.where(maximum>1e-32,mantissa*256/maximum,0)
rgbe=np.zeros((h,w,4),dtype=np.uint8)
rgbe[:,:,:3]=np.clip(linear*multiplier[:,:,None],0,255).astype(np.uint8)
rgbe[:,:,3]=np.where(maximum>1e-32,exponent+128,0).astype(np.uint8)
with (OUT/'casino-studio.hdr').open('wb') as file:
    file.write(f'#?RADIANCE\n# Original crapsTV linear casino lighting\nFORMAT=32-bit_rle_rgbe\n\n-Y {h} +X {w}\n'.encode())
    for row in rgbe:
        file.write(bytes([2,2,w>>8,w&255]))
        for channel in range(4):
            for start in range(0,w,127):
                chunk=row[start:start+127,channel].tobytes()
                file.write(bytes([len(chunk)]))
                file.write(chunk)
image=bpy.data.images.load(str(OUT/'casino-studio.hdr'))

# Lightweight portrait of the dice for visual QA.
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.world.use_nodes=True
worldnodes=scene.world.node_tree.nodes
tex=worldnodes.new('ShaderNodeTexEnvironment')
tex.image=image
scene.world.node_tree.links.new(tex.outputs['Color'],worldnodes.get('Background').inputs['Color'])
worldnodes.get('Background').inputs['Strength'].default_value=.5
bpy.ops.object.camera_add(location=(2.3,-3.5,2.5))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera=camera
camera.data.lens=58
scene.render.resolution_x=720
scene.render.resolution_y=720
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'dice-preview.png')
scene.render.film_transparent=True
bpy.ops.render.render(write_still=True)

# Table QA render uses the same exported dimensions and provided felt artwork.
# The playable app changes this plane when the game mode changes.
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'table.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.world.use_nodes=True
nodes=scene.world.node_tree.nodes
env=nodes.new('ShaderNodeTexEnvironment')
env.image=bpy.data.images.load(str(OUT/'casino-studio.hdr'))
scene.world.node_tree.links.new(env.outputs['Color'],nodes.get('Background').inputs['Color'])
nodes.get('Background').inputs['Strength'].default_value=.5
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
scene.render.resolution_x=1200
scene.render.resolution_y=820
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'table-preview.png')
scene.render.film_transparent=True
bpy.ops.render.render(write_still=True)
print('Created table.glb, dice.glb, casino-studio.hdr, source .blend files, and QA previews')
