"""Original two-sided craps puck, built in Blender with a procedural text atlas.
Run: blender --background --python scripts/build-puck.py
Exports a centered glTF Y-up model: diameter .4, height .085, white ON at +Y.
No downloaded images/fonts. The geometric ON/OFF lettering is authored below.
"""
from pathlib import Path
import json, math
import bpy
import numpy as np
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets';SOURCE=ROOT/'assets/source'
OUT.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

# 2x coverage sampling makes the vector lettering clean even at close range.
S=2048
v,u=np.mgrid[0:S,0:S].astype(np.float32);u=(u+.5)/S;v=(v+.5)/S
white=np.array([244,239,225],np.float32)/255
black=np.array([17,23,21],np.float32)/255
rgb=np.empty((S,S,3),np.float32);rgb[:]=black
rgb[v>=.16]=white

def box(x,y,hx,hy,r=0):
    qx=np.abs(x)-(hx-r);qy=np.abs(y)-(hy-r)
    return np.hypot(np.maximum(qx,0),np.maximum(qy,0))+np.minimum(np.maximum(qx,qy),0)-r

def glyph(letter,x,y):
    if letter=='O':return np.maximum(box(x,y,.34,.5,.22),-box(x,y,.16,.31,.12))
    if letter=='F':return np.minimum.reduce([box(x+.245,y,.095,.5,.012),box(x-.015,y-.405,.285,.095,.012),box(x+.025,y-.04,.245,.085,.012)])
    # Capital N: two stems connected by a descending diagonal.
    ax,ay=-.245,.42;bx,by=.245,-.42;dx,dy=bx-ax,by-ay
    t=np.clip(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy),0,1)
    diagonal=np.hypot(x-ax-t*dx,y-ay-t*dy)-.10
    return np.minimum.reduce([box(x+.245,y,.095,.5,.012),box(x-.245,y,.095,.5,.012),diagonal])

def face(cx,word,scale,spacing):
    radius=np.hypot(u-cx,v-.66)
    disc=radius<.23
    rgb[disc]=white if word=='ON' else black
    ink=black if word=='ON' else white
    ring=np.clip((.0015-np.abs(radius-.206))*S+.5,0,1)*(radius<.225)
    rgb[:]=rgb*(1-ring[:,:,None])+ink*ring[:,:,None]
    for i,letter in enumerate(word):
        center=cx+(i-(len(word)-1)/2)*spacing
        distance=glyph(letter,(u-center)/scale,(v-.66)/scale)
        coverage=np.clip(.5-distance*scale*S,0,1)*disc
        rgb[:]=rgb*(1-coverage[:,:,None])+ink*coverage[:,:,None]
face(.25,'ON',.158,.133)
face(.75,'OFF',.142,.105)
# Downsample coverage, preserving the intended sRGB albedo samples.
rgb=rgb.reshape(1024,2,1024,2,3).mean(axis=(1,3))
rgba=np.ones((1024,1024,4),np.float32);rgba[:,:,:3]=rgb
atlas=bpy.data.images.new('Original ON OFF puck atlas',width=1024,height=1024,alpha=False)
atlas.pixels.foreach_set(rgba.ravel());atlas.file_format='PNG';atlas.filepath_raw=str(OUT/'puck-atlas.png');atlas.save();atlas.pack()

mat=bpy.data.materials.new('Puck satin polymer');mat.use_nodes=True
nodes=mat.node_tree.nodes;bsdf=nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value=.42;bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['IOR'].default_value=1.46
bsdf.inputs['Coat Weight'].default_value=.12;bsdf.inputs['Coat Roughness'].default_value=.35
tex=nodes.new('ShaderNodeTexImage');tex.image=atlas
mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])

N=96
profile=[(.187,-.0425),(.196,-.039),(.2,-.030),(.2,0),(.2,.030),(.196,.039),(.187,.0425)]
vertices=[(r*math.cos(i*2*math.pi/N),r*math.sin(i*2*math.pi/N),z) for r,z in profile for i in range(N)]
faces=[]
for ring in range(len(profile)-1):
    for i in range(N):faces.append((ring*N+i,ring*N+(i+1)%N,(ring+1)*N+(i+1)%N,(ring+1)*N+i))
faces.append(tuple(reversed(range(N))));faces.append(tuple((len(profile)-1)*N+i for i in range(N)))
mesh=bpy.data.meshes.new('Beveled puck mesh');mesh.from_pydata(vertices,[],faces);mesh.materials.append(mat);mesh.update()
puck=bpy.data.objects.new('Casino puck - white ON positive Y in glTF',mesh);bpy.context.collection.objects.link(puck)
uv=mesh.uv_layers.new(name='Puck UV')
for p in mesh.polygons:
    p.use_smooth=len(p.vertices)==4
    for loop in p.loop_indices:
        index=mesh.loops[loop].vertex_index;x,y,z=vertices[index]
        if len(p.vertices)>4:
            uv.data[loop].uv=((.25 if z>0 else .75)+x/.2*.23,.66+(y if z>0 else -y)/.2*.23)
        else:
            # Wrap the side strip once. The duplicated UV seam is per-loop.
            angle=(index%N)/N
            if p.vertices[0]%N==N-1 and index%N==0:angle=1
            uv.data[loop].uv=(angle,.08+(z+.0425)/.085*.16)

bpy.context.view_layer.objects.active=puck;puck.select_set(True)
mesh.calc_loop_triangles();triangles=len(mesh.loop_triangles)
assert triangles<=1500,triangles
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'puck.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'puck.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True)
# Render real geometry in both orientations; lighting does not become an asset.
floor_mat=bpy.data.materials.new('Preview felt');floor_mat.diffuse_color=(.015,.045,.035,1);floor_mat.use_nodes=True
floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.015,.045,.035,1)
floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85
bpy.ops.mesh.primitive_plane_add(size=20,location=(0,0,-.043));bpy.context.object.data.materials.append(floor_mat)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.15,.15,.15,1);scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.6
for loc,power,size in [((-.5,-.5,1.2),50,.8),((.8,.5,.5),30,.7)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.40,-.65,.47));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=60;scene.camera=camera
scene.render.resolution_x=1000;scene.render.resolution_y=760;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
for name,angle in [('on',0),('off',math.pi)]:
    puck.rotation_euler.x=angle;scene.render.filepath=str(OUT/f'puck-{name}-preview.png');bpy.ops.render.render(write_still=True)
stats={'triangles':triangles,'vertices':len(mesh.vertices),'materials':1,'expectedGLTFBounds':{'size':[.4,.085,.4],'min':[-.2,-.0425,-.2],'max':[.2,.0425,.2]},'orientation':{'positiveY':'white ON','negativeY':'black OFF','showOFF':'rotate around X by pi'},'atlas':[1024,1024],'glbBytes':(OUT/'puck.glb').stat().st_size,'provenance':'Original geometry, original geometric vector glyphs, original procedural atlas; no external assets'}
(OUT/'puck-stats.json').write_text(json.dumps(stats,indent=2)+'\n');print(json.dumps(stats))
