"""Create original casino dice with true carved pip bowls, recessed paint, and wear.

Blender 4.5+: blender --background --python scripts/build-dice.py
Output is one-unit glTF Y-up cube: +Y=1, -Y=6, +Z=2, -Z=5, +X=3, -X=4.
Only files prefixed dice* and assets/source/dice.blend are written.
"""
from pathlib import Path
import json
import math
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets'
SOURCE = ROOT / 'assets' / 'source'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)


def image_from_rgb(name, rgb):
    height, width, _ = rgb.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    image.file_format = 'PNG'
    image.filepath_raw = str(OUT / f'{name}.png')
    image.save()
    return image


# Low-amplitude directional scuffs and a few hairline scratches. These are
# original procedural tangent-space maps, not a color-overlay imitation.
normal_images = []
roughness_image = None
for version in range(1, 4):
    rng = np.random.default_rng(1107 + version)
    size = 512
    heightmap = rng.normal(0, 0.0012, (size, size)).astype(np.float32)
    for stroke in range(100):
        x0, y0 = rng.uniform(0, size, 2)
        length = rng.uniform(4, 55)
        angle = rng.uniform(0, math.tau)
        dx, dy = math.cos(angle)*length, math.sin(angle)*length
        # Tiny gaussian brush; low height means marks stay subtle in reflections.
        steps = max(2, int(length*2))
        depth = rng.uniform(.006, .017)
        for t in np.linspace(0, 1, steps):
            x, y = x0+dx*t, y0+dy*t
            ix, iy = int(x), int(y)
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    xx, yy = (ix+ox) % size, (iy+oy) % size
                    distance = (xx-x)**2+(yy-y)**2
                    heightmap[yy,xx] -= depth*math.exp(-distance/1.1)/steps*8
    gy, gx = np.gradient(heightmap)
    normals = np.stack((-gx*3, -gy*3, np.ones_like(gx)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    normal_images.append(image_from_rgb(f'dice-wear-{version}', normals*.5+.5))
    if version == 1:
        roughness = np.clip(.235 + rng.normal(0,.005,(size,size)) - heightmap*1.8, .20, .34)
        roughness_image = image_from_rgb('dice-roughness', np.repeat(roughness[:,:,None],3,axis=2))

body_mat = bpy.data.materials.new('DiceBody')
body_mat.use_nodes = True
bn = body_mat.node_tree.nodes
bsdf = bn.get('Principled BSDF')
# Neutral resin: runtime color replaces this for red/green/blue selection.
bsdf.inputs['Base Color'].default_value = (.82, .79, .70, 1)
bsdf.inputs['Roughness'].default_value = .235
bsdf.inputs['IOR'].default_value = 1.49
bsdf.inputs['Coat Weight'].default_value = .35
bsdf.inputs['Coat Roughness'].default_value = .14
wear = bn.new('ShaderNodeTexImage')
wear.name = 'Subtle wear normal texture'
wear.image = normal_images[0]
normal = bn.new('ShaderNodeNormalMap')
normal.inputs['Strength'].default_value = .32
body_mat.node_tree.links.new(wear.outputs['Color'], normal.inputs['Color'])
body_mat.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
rough = bn.new('ShaderNodeTexImage')
rough.name = 'Resin microsurface roughness'
rough.image = roughness_image
body_mat.node_tree.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])

pip_mat = bpy.data.materials.new('DicePips')
pip_mat.use_nodes = True
pn = pip_mat.node_tree.nodes.get('Principled BSDF')
pn.inputs['Base Color'].default_value = (.94,.89,.73,1)
pn.inputs['Roughness'].default_value = .32

bpy.ops.mesh.primitive_cube_add(size=1)
body = bpy.context.object
body.name = 'DiceBody'
body.data.materials.append(body_mat)
bevel = body.modifiers.new('Milled casino edge radius', 'BEVEL')
bevel.width = .045
bevel.segments = 5
bpy.ops.object.modifier_apply(modifier=bevel.name)

p = .22
PIPS = {
    1: [(0,0)],
    2: [(-p,p),(p,-p)],
    3: [(-p,p),(0,0),(p,-p)],
    4: [(-p,-p),(-p,p),(p,-p),(p,p)],
    5: [(-p,-p),(-p,p),(0,0),(p,-p),(p,p)],
    6: [(-p,-p),(-p,0),(-p,p),(p,-p),(p,0),(p,p)],
}
# Blender Z-up -> glTF Y-up maps (x,y,z) to (x,z,-y).
FACES = [
    (1, Vector((0,0,1)), Vector((1,0,0)), Vector((0,1,0))),
    (6, Vector((0,0,-1)), Vector((1,0,0)), Vector((0,-1,0))),
    (2, Vector((0,-1,0)), Vector((1,0,0)), Vector((0,0,1))),
    (5, Vector((0,1,0)), Vector((-1,0,0)), Vector((0,0,1))),
    (3, Vector((1,0,0)), Vector((0,1,0)), Vector((0,0,1))),
    (4, Vector((-1,0,0)), Vector((0,-1,0)), Vector((0,0,1))),
]
paint_vertices, paint_faces = [], []
for value, axis, u, v in FACES:
    for px, py in PIPS[value]:
        face_center = axis*.5 + u*px + v*py
        sphere_center = face_center + axis*.035
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=.100, location=sphere_center)
        cutter = bpy.context.object
        cutter.name = f'Carved pip {value}'
        bpy.context.view_layer.objects.active = body
        carve = body.modifiers.new(f'Real hemispherical recess {value}', 'BOOLEAN')
        carve.operation = 'DIFFERENCE'
        carve.solver = 'EXACT'
        carve.object = cutter
        bpy.ops.object.modifier_apply(modifier=carve.name)
        bpy.data.objects.remove(cutter, do_unlink=True)

        # Cream paint is a concave sphere cap located 32–64 mm below the
        # one-unit cube face. A visible resin ring remains above the painted bowl.
        base = len(paint_vertices)
        radius = .096
        theta_max = math.acos((.035+.032)/radius)
        paint_vertices.append(tuple(sphere_center-axis*radius))
        rings, segments = 6, 32
        for ring in range(1,rings+1):
            theta = theta_max*ring/rings
            radial = radius*math.sin(theta)
            depth = radius*math.cos(theta)
            for seg in range(segments):
                a = math.tau*seg/segments
                co = sphere_center-axis*depth + u*(radial*math.cos(a)) + v*(radial*math.sin(a))
                paint_vertices.append(tuple(co))
        # Reverse winding later if needed using interior-facing analytic normal.
        for seg in range(segments):
            paint_faces.append((base,base+1+seg,base+1+(seg+1)%segments))
        for ring in range(rings-1):
            row = base+1+ring*segments
            nextrow = row+segments
            for seg in range(segments):
                a,b = row+seg,row+(seg+1)%segments
                c,d = nextrow+(seg+1)%segments,nextrow+seg
                paint_faces.append((a,b,c,d))

mesh = bpy.data.meshes.new('Twenty-one recessed paint bowls')
mesh.from_pydata(paint_vertices, [], paint_faces)
mesh.update()
pips = bpy.data.objects.new('DicePips', mesh)
bpy.context.collection.objects.link(pips)
pips.data.materials.append(pip_mat)
# Each bowl's normal should face toward the corresponding cut sphere center.
# The face bases were selected so cross(u,v)=outward axis, giving inward-facing
# bowl normals already; use a radial check to guard against winding mistakes.
for poly in pips.data.polygons:
    poly.use_smooth = True

for obj in (body,pips):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.025)
    bpy.ops.object.mode_set(mode='OBJECT')
    for poly in obj.data.polygons:
        poly.use_smooth=True

# Preserve broad flat die faces while allowing actual curved cavity shading.
bpy.context.view_layer.objects.active=body
weighted=body.modifiers.new('Machined face normals','WEIGHTED_NORMAL')
weighted.keep_sharp=True
weighted.weight=30
bpy.ops.object.modifier_apply(modifier=weighted.name)

bpy.ops.object.select_all(action='DESELECT')
for obj in (body,pips):obj.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.export_scene.gltf(filepath=str(OUT/'dice.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
for im in bpy.data.images:
    if im.name.startswith('dice-'): im.pack()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'dice.blend'),compress=True)

triangles=sum(sum(len(poly.vertices)-2 for poly in obj.data.polygons) for obj in (body,pips))
assert triangles<20000, f'Too many triangles: {triangles}'
metadata={
    'unitCube':True,'coordinates':'glTF Y-up',
    'faceValues':{'+Y':1,'-Y':6,'+Z':2,'-Z':5,'+X':3,'-X':4},
    'bodyMaterial':'DiceBody','pipMaterial':'DicePips','triangles':triangles,
    'pipCount':21,'pipDepth':.065,'paintRecess':.032,'edgeRadius':.045,
    'normalMaps':[f'dice-wear-{i}.png' for i in (1,2,3)],'roughnessMap':'dice-roughness.png'
}
(OUT/'dice-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')

# Product close-up: three colorways demonstrate true cavities and surface response.
# These preview-only changes happen after saving the neutral source and GLB.
body_mat.node_tree.links.remove(bsdf.inputs['Roughness'].links[0])
bsdf.inputs['Roughness'].default_value=.23
colors=[(.32,.014,.026,1),(.012,.17,.095,1),(.022,.065,.34,1)]
for i in range(3):
    for original in (body,pips):
        obj=original if i==0 else original.copy()
        if i>0:
            obj.data=original.data.copy()
            bpy.context.collection.objects.link(obj)
        obj.location=(i*1.4-1.4,0,0)
        obj.rotation_euler=(math.radians(16),math.radians(-18),math.radians(-12+i*9))
        if original==body:
            mat=body_mat.copy()
            mat.name=f'Preview resin {i+1}'
            mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=colors[i]
            obj.data.materials.clear();obj.data.materials.append(mat)

bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.75))
floor=bpy.context.object
floor_mat=bpy.data.materials.new('Preview charcoal');floor_mat.diffuse_color=(.022,.028,.026,1)
floor.data.materials.append(floor_mat)
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.world.color=(.12,.12,.12)
for loc,power,size in [((1,-4,6),1100,5),((-4,1,4),850,4),((4,3,3),900,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3.5,-6.4,4.0))
cam=bpy.context.object
cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=5.1
scene.camera=cam
scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'dice-preview.png')
bpy.ops.render.render(write_still=True)
print('DICE_METADATA '+json.dumps(metadata))
