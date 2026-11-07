"""Original, UV-mapped crapsTV chip with three distinct surface-wear sets.

Run with Blender 4.5 LTS: blender --background --python scripts/build-chips.py
No external assets or add-ons. Output is one-unit diameter, .13-unit thick,
with +Y as the top normal in exported glTF coordinates.
"""
from pathlib import Path
import math
import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets';SOURCE=ROOT/'assets/source'
OUT.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

N=512
yy,xx=np.mgrid[0:N,0:N].astype(np.float32)
u=(xx+.5)/N;v=(yy+.5)/N

def save_map(name,rgb,non_color=False):
    image=bpy.data.images.new(name,width=N,height=N,alpha=False)
    if non_color:image.colorspace_settings.name='Non-Color'
    rgba=np.ones((N,N,4),dtype=np.float32);rgba[:,:,:3]=rgb
    image.pixels.foreach_set(rgba.ravel())
    image.file_format='PNG';image.filepath_raw=str(OUT/(name+'.png'));image.save()
    return image

# Atlas: front disc centered at (.25,.37), back at (.75,.37), radius .225.
# Continuous side strip runs along U, V=.80..98. Top/bottom use Cartesian UVs.
rad1=np.sqrt((u-.25)**2+(v-.37)**2)/.225
rad2=np.sqrt((u-.75)**2+(v-.37)**2)/.225
surface=(rad1<1.015)|(rad2<1.015)|(v>.79)
rng=np.random.default_rng(801)
grain=rng.normal(0,.010,(N,N))
albedo=np.clip(.92+grain,.80,.97)
# Uniform guide circles are omitted: molded geometry supplies the real rings.
albedo=np.where(surface,albedo,.92)
color=save_map('chip-color',np.repeat(albedo[:,:,None],3,axis=2))

normals=[];roughs=[];bumps=[]
for variant,seed in enumerate([913,721,406],1):
    rng=np.random.default_rng(seed)
    # Fine clay grain, circular manufacturing traces, and unique shallow scuffs.
    h=rng.normal(0,.007,(N,N)).astype(np.float32)
    h+=.010*np.sin(2*np.pi*(u*41+v*7))
    for k in range(32+variant*8):
        cx=rng.uniform(.03,.97);cy=rng.uniform(.07,.75)
        theta=rng.uniform(0,2*math.pi);length=rng.uniform(.018,.09)
        along=(u-cx)*math.cos(theta)+(v-cy)*math.sin(theta)
        across=-(u-cx)*math.sin(theta)+(v-cy)*math.cos(theta)
        h-=np.exp(-(across/.0017)**2-(along/length)**6)*rng.uniform(.018,.055)
    # Sidewear is horizontally periodic, including at the atlas wrap seam.
    side=.010*np.sin(2*np.pi*(u*33+v*11))+.009*np.sin(2*np.pi*(u*57-v*17))
    for k in range(22):
        cx=rng.uniform(0,1);cy=rng.uniform(.80,.98)
        du=(u-cx+.5)%1-.5
        side-=np.exp(-(du/.0022)**2-((v-cy)/.028)**4)*.035
    h=np.where(v>.79,side,h)
    h=np.clip(h,-.14,.09)
    height=np.clip(.5+h,0,1)
    bumps.append(save_map(f'chip-wear-{variant}',np.repeat(height[:,:,None],3,axis=2),True))
    gy,gx=np.gradient(h)
    normal=np.stack((-gx*8,-gy*8,np.ones_like(h)),axis=2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    normals.append(save_map(f'chip-normal-{variant}',normal*.5+.5,True))
    rough=np.clip(.54+np.abs(h)*2.4+rng.normal(0,.018,(N,N)),.40,.86)
    roughs.append(save_map(f'chip-roughness-{variant}',np.repeat(rough[:,:,None],3,axis=2),True))

def material(name,col,metal=0,rough=.5,textured=True):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;l=m.node_tree.links;b=n.get('Principled BSDF')
    b.inputs['Base Color'].default_value=(*col,1);b.inputs['Metallic'].default_value=metal
    b.inputs['Roughness'].default_value=rough
    if textured:
        tex=n.new('ShaderNodeTexImage');tex.image=color;tex.label='Neutral clay base color'
        if col==(1,1,1):l.new(tex.outputs['Color'],b.inputs['Base Color'])
        else:
            mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
            mix.inputs[2].default_value=(*col,1)
            l.new(tex.outputs['Color'],mix.inputs[1]);l.new(mix.outputs[0],b.inputs['Base Color'])
        tex=n.new('ShaderNodeTexImage');tex.image=normals[0];tex.label='Wear variant 1 (swap at runtime)'
        norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.7
        l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],b.inputs['Normal'])
        tex=n.new('ShaderNodeTexImage');tex.image=roughs[0]
        split=n.new('ShaderNodeSeparateColor');l.new(tex.outputs['Color'],split.inputs['Color'])
        l.new(split.outputs['Red'],b.inputs['Roughness'])
    return m

base=material('ChipBase',(1,1,1))
inlay=material('ChipInlay',(.92,.85,.68),textured=False)
# Inlay still carries matching real normal and roughness textures.
for m in [inlay]:
    n=m.node_tree.nodes;l=m.node_tree.links;b=n.get('Principled BSDF')
    tex=n.new('ShaderNodeTexImage');tex.image=normals[0]
    norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.7
    l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],b.inputs['Normal'])
    tex=n.new('ShaderNodeTexImage');tex.image=roughs[0]
    split=n.new('ShaderNodeSeparateColor');l.new(tex.outputs['Color'],split.inputs['Color'])
    l.new(split.outputs['Red'],b.inputs['Roughness'])
metal=material('ChipMetal',(.47,.32,.12),.65,.38,False)
engrave=material('ChipEngraving',(.045,.035,.025),0,.72,False)

def atlas_uv(co,normal):
    x,y,z=co
    if abs(normal.z)>.45:
        return ((.25 if normal.z>0 else .75)+x*.45,.37+y*.45)
    return ((math.atan2(y,x)/(2*math.pi))%1,.80+(z+.065)/.13*.18)

def mesh_uv(obj):
    uv=obj.data.uv_layers.new(name='Chip atlas UV')
    for p in obj.data.polygons:
        for li in p.loop_indices:uv.data[li].uv=atlas_uv(obj.data.vertices[obj.data.loops[li].vertex_index].co,p.normal)

# Circular lathe profile. Real recessed front and back medallion wells.
profile=[(.31,.049),(.33,.049),(.342,.056),(.37,.056),(.39,.057),(.422,.062),(.476,.065),(.490,.061),(.498,.051),(.50,.044),(.50,-.044),(.498,-.051),(.490,-.061),(.476,-.065),(.422,-.062),(.39,-.057),(.37,-.056),(.342,-.056),(.33,-.049),(.31,-.049)]
segs=96;verts=[];faces=[]
for radius,z in profile:
    for i in range(segs):
        a=i/segs*2*math.pi;verts.append((radius*math.cos(a),radius*math.sin(a),z))
for ring in range(len(profile)):
    nr=(ring+1)%len(profile)
    for i in range(segs):faces.append((ring*segs+i,nr*segs+i,nr*segs+(i+1)%segs,ring*segs+(i+1)%segs))
mesh=bpy.data.meshes.new('Lathed clay chip mesh');mesh.from_pydata(verts,[],faces);mesh.update()
body=bpy.data.objects.new('Chip body with eight edge inserts',mesh);bpy.context.collection.objects.link(body)
for m in [base,inlay]:mesh.materials.append(m)
for p in mesh.polygons:
    # 3 of every 12 radial segments are a genuine separate cream inlay material.
    i=p.index%segs;ring=p.index//segs
    if (i%12 in [0,1,11]) and max(profile[ring][0],profile[(ring+1)%len(profile)][0])>.421:p.material_index=1
    p.use_smooth=True
mesh_uv(body)
# Avoid the 0↔1 discontinuity on the last side-strip face.
uv=mesh.uv_layers.active
for p in mesh.polygons:
    coords=[uv.data[li].uv.x for li in p.loop_indices]
    if max(coords)-min(coords)>.5 and abs(p.normal.z)<.45:
        for li in p.loop_indices:
            if uv.data[li].uv.x<.5:uv.data[li].uv.x+=1

def cylinder(name,radius,depth,z,mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=radius,depth=depth,location=(0,0,z))
    obj=bpy.context.object;obj.name=name;obj.data.materials.append(mat)
    bevel=obj.modifiers.new('Medallion micro bevel','BEVEL');bevel.width=.002;bevel.segments=2
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj

# The center plaque lies .019 below the raised outer rim, not a flat decal.
disc=cylinder('Recessed front medallion',.313,.014,.039,base)
back=cylinder('Recessed back medallion',.313,.014,-.039,base)

def text_mesh(text,size,z,extrude,name):
    curve=bpy.data.curves.new(name,'FONT');curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER'
    curve.size=size;curve.extrude=extrude;curve.resolution_u=3
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj);obj.location.z=z
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH');return bpy.context.object

# True engraved lettering cut into the front plaque; dark inset letter floors.
cutter=text_mesh('crapsTV',.102,.0435,.011,'crapsTV engraving cutter')
bpy.context.view_layer.objects.active=disc
boolean=disc.modifiers.new('Recessed crapsTV wordmark','BOOLEAN');boolean.operation='DIFFERENCE';boolean.object=cutter
bpy.ops.object.modifier_apply(modifier=boolean.name)
bpy.data.objects.remove(cutter,do_unlink=True)
letters=text_mesh('crapsTV',.102,.042,.0002,'Engraved wordmark floor');letters.data.materials.append(engrave)
# A small decorative double-die motif, engraved as circular pits above the wordmark.
for x,y in [(-.105,.145),(-.075,.115),(-.045,.085),(.055,.085),(.055,.145),(.115,.085),(.115,.145)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.013,depth=.007,location=(x,y,.045))
    cut=bpy.context.object;bpy.context.view_layer.objects.active=disc
    mod=disc.modifiers.new('Die pip recess','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)

# Two fine metal rings sit within the shallow medallion groove.
for z in [-.055,.055]:
    bpy.ops.mesh.primitive_torus_add(major_radius=.356,minor_radius=.0025,major_segments=96,minor_segments=6,location=(0,0,z))
    obj=bpy.context.object;obj.name='Fine brass medallion ring';obj.data.materials.append(metal)

for obj in bpy.context.scene.objects:
    if obj.type=='MESH' and obj!=body:
        if obj.data.uv_layers:
            for old in list(obj.data.uv_layers):obj.data.uv_layers.remove(old)
        # UV mapping uses world chip coordinates on transformed child objects.
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        mesh_uv(obj)
        # Flat medallion faces must stay flat around Boolean lettering/pip cuts;
        # smoothing a giant triangulated cap produces star-shaped shading dents.
        for p in obj.data.polygons:p.use_smooth=abs(p.normal.z)<.65

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active=body
bpy.ops.object.join()
body.name='Detailed casino chip'
print('CHIP_GEOMETRY',len(body.data.vertices),'vertices',sum(len(p.vertices)-2 for p in body.data.polygons),'triangles',tuple(body.dimensions))
bpy.ops.export_scene.gltf(filepath=str(OUT/'chip.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'chip.blend'),compress=True)

# A 3/4 product preview, with two duplicates showing the real model at different angles.
for index,(x,y,angle) in enumerate([(-.58,.25,.15),(.56,.32,-.17)]):
    for src in list(bpy.context.scene.objects):
        if src.type!='MESH' or src.name.startswith('Preview'):continue
        obj=src.copy();obj.data=src.data.copy();bpy.context.collection.objects.link(obj)
        obj.name='Preview duplicate';obj.location=(x,y,.12 if index else .20);obj.rotation_euler.z=angle
        for slot in obj.material_slots:
            if slot.material==base:
                m=base.copy();m.name='Preview colored clay'
                bs=m.node_tree.nodes.get('Principled BSDF')
                # Preview-only tint, using the same mapped color texture.
                tex=next(n for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==color)
                mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
                mix.inputs[2].default_value=(*((.55,.012,.035) if index else (.014,.19,.12)),1)
                m.node_tree.links.new(tex.outputs['Color'],mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
                slot.material=m
ground=material('Preview charcoal',(.026,.021,.019),0,.75,False)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.071));bpy.context.object.data.materials.append(ground)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
try:
    p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='METAL';p.get_devices()
    for d in p.devices:d.use=d.type=='METAL'
    scene.cycles.device='GPU'
except Exception:pass
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.25,.21,.17,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.3
for loc,energy,size in [((1,-2,3),180,3),((-2,-1,2),100,2),((0,3,2),200,2)]:
    light=bpy.data.lights.new('Preview softbox','AREA');light.energy=energy;light.shape='DISK';light.size=size
    obj=bpy.data.objects.new('Preview softbox',light);bpy.context.collection.objects.link(obj);obj.location=loc
    obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(1.05,-1.70,2.55));camera=bpy.context.object
camera.rotation_euler=(Vector((0,.15,.05))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.45
scene.camera=camera;scene.render.resolution_x=1100;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'chip-preview.png')
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
bpy.ops.render.render(write_still=True)
print('CHIP_CREATED',str(OUT/'chip.glb'))
