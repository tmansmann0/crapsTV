"""Optimize the optional player table without overwriting previous assets.
Run: blender --background --python scripts/build-optimized-table.py
"""
import bpy,bmesh,math,json,hashlib,re
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets';SOURCE=ROOT/'assets/source'
preserve=[OUT/'table.glb',SOURCE/'table.blend',OUT/'table-player-rails.glb',SOURCE/'table-player-rails.blend']
before_hash={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in preserve}
helpers=(ROOT/'scripts/build-models.py').read_text().split('\nclean()\nwood=')[0]
exec(compile(helpers,str(ROOT/'scripts/build-models.py'),'exec'),globals())
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'table-player-rails.blend'))
def metrics():
    objects=[o for o in bpy.data.objects if o.type=='MESH'];triangles=0;primitives=0
    for o in objects:
        o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
        primitives+=len(set(p.material_index for p in o.data.polygons))
    return {'triangles':triangles,'meshes':len(objects),'materialPrimitives':primitives}
baseline=metrics()
wood=bpy.data.materials['Hand-polished dark walnut'];brass=bpy.data.materials['Aged champagne brass'];black=bpy.data.materials['Dark recessed cup wells'];suede=bpy.data.materials['Player tray suede']
rubber=bpy.data.materials['Dark pine pyramid bounce rubber']
# These dealer placeholders are already hidden by the game, which installs its
# own modeled chip inventory. Stitch submillimeter geometry is replaced by the
# existing leather material detail. The molded rubber is now entirely mapped.
removed=[]
for o in list(bpy.data.objects):
    if o.name.startswith('Seat ') or o.name in ['Molded rubber pyramids','Continuous player table stitching'] or re.match(r'Dealer chip stack \d+$',o.name):
        removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
# Bring the flat rubber face to the former pyramid-tip contact envelope so
# unchanged physics bounds still meet the visible surface after baking.
wall=bpy.data.objects.get('Vertical rubber bounce wall')
if wall:
    count=len(wall.data.vertices)//4
    for vertex in wall.data.vertices:
        if vertex.index<count*2:continue
        x,y=vertex.co.x,vertex.co.y
        cx,cy=4.56,1.85
        if abs(x)>cx and abs(y)>cy:
            nx,ny=abs(x)-cx,abs(y)-cy;length=math.hypot(nx,ny);nx/=length;ny/=length
            nx*=1 if x>=0 else -1;ny*=1 if y>=0 else -1
        elif abs(x)>cx:nx,ny=(1 if x>=0 else -1),0
        else:nx,ny=0,(1 if y>=0 else -1)
        vertex.co.x-=nx*.03;vertex.co.y-=ny*.03
    wall.data.update()
# Simplify remaining curved static geometry without flattening cup or crown
# silhouettes. Planar dissolve preserves UV and material boundaries.
for o in list(bpy.data.objects):
    if o.type!='MESH' or o.name=='Continuous sealed padded crown':continue
    bpy.context.view_layer.objects.active=o
    dec=o.modifiers.new('Coplanar retopology','DECIMATE');dec.decimate_type='DISSOLVE';dec.angle_limit=math.radians(4)
    dec.delimit={'UV','MATERIAL','SHARP'};dec.use_dissolve_boundaries=False
    bpy.ops.object.modifier_apply(modifier=dec.name)
    o.data.calc_loop_triangles()
    if len(o.data.loop_triangles)>1800 and o.name not in ['Continuous sealed padded crown']:
        dec=o.modifiers.new('Curved surface LOD','DECIMATE');dec.decimate_type='COLLAPSE';dec.ratio=.52;dec.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=dec.name)
    if o.name not in ['Vertical rubber bounce wall','Rubber wall lower bead']:
        weighted=o.modifiers.new('Retopo face-weighted normals','WEIGHTED_NORMAL');weighted.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=weighted.name)
# Low-poly tray sections include the bevel in their profile. They retain exact
# maximum bounds and the original suede floor/slot coordinates.
original_rounded=rounded
original_finish=finish
def rounded(w,d,r,n=None):return original_rounded(w,d,r,n if n else (4 if max(w,d)<2 else 16))
def finish(obj,name,mat,bevel=0):
    obj=original_finish(obj,name,mat,bevel=0)
    for p in obj.data.polygons:p.use_smooth=abs(p.normal.z)<.95
    return obj
layout=json.loads((OUT/'table-player-rails-layout.json').read_text())
for s in layout['seats']:
    i=s['seat'];center=s['bankBase'];t=s['tangent'];parts=[]
    parts.append(slab(f'LOD seat {i+1} base',1.62,.78,.10,.609,.658,wood))
    parts.append(ring(f'LOD seat {i+1} contoured rim',[(1.600,.760,.090,.638),(1.620,.780,.100,.650),(1.620,.780,.100,.722),(1.596,.756,.088,.735),(1.502,.642,.080,.735),(1.480,.620,.070,.723),(1.480,.620,.070,.638)],wood,0))
    parts.append(slab(f'LOD seat {i+1} suede bed',1.479,.619,.069,.654,.675,suede))
    parts.append(ring(f'LOD seat {i+1} brass lip',[(1.505,.645,.080,.732),(1.505,.645,.080,.738),(1.480,.620,.069,.738),(1.480,.620,.069,.732)],brass,0))
    angle=math.atan2(-t[2],t[0])
    for p in parts:p.rotation_euler.z=angle;p.location=(center[0],-center[2],0)
    label=s['labelPosition'];p=cube(f'LOD seat {i+1} label plaque',(.96,.135,.014),(label[0],-label[2],.626),black,0);p.rotation_euler.z=angle
# Tangent-space normal/roughness map replaces all pyramid geometry. Its three
# rows and alternating column offset match the old molded rubber pattern.
W,H=256,1024
u=(np.arange(W)+.5)/W*.20;v=.02+(np.arange(H)+.5)/H*.72
xx,yy=np.meshgrid(u,v);height=np.zeros((H,W),dtype=np.float32)
for row,y in enumerate((.18,.38,.58)):
    cx=.10 if row%2==0 else 0.0
    dx=np.abs((xx-cx+.10)%.20-.10)
    shape=np.maximum(0,1-(dx+np.abs(yy-y))/.078)
    height=np.maximum(height,shape*.03)
# A tiny circular blur gives anti-aliased edges but retains flat pyramid faces.
height=(height*4+np.roll(height,1,0)+np.roll(height,-1,0)+np.roll(height,1,1)+np.roll(height,-1,1))/8
hx=(np.roll(height,-1,1)-np.roll(height,1,1))/(.40/W)
hy=(np.roll(height,-1,0)-np.roll(height,1,0))/(1.44/H)
normal=np.stack((-hx,-hy,np.ones_like(hx)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
im=image_texture('table-rubber-normal',normal*.5+.5);im.colorspace_settings.name='Non-Color'
rough=image_texture('table-rubber-roughness',np.repeat((.84-.045*(height/.03))[:,:,None],3,axis=2));rough.colorspace_settings.name='Non-Color'
for o in bpy.data.objects:
    if o.type!='MESH' or not o.data.materials or o.data.materials[0]!=rubber:continue
    uv=o.data.uv_layers.get('Detail UV') or o.data.uv_layers.new(name='Detail UV')
    # Project to a consistently parameterized rounded inner wall, selecting its
    # closest line/arc point. Side normals retain smooth corner continuity.
    path=original_rounded(10.90,5.48,.89,n=100)
    segments=[];arc=0
    for i,p in enumerate(path):
        q=path[(i+1)%len(path)];dx=q[0]-p[0];dy=q[1]-p[1];length=math.hypot(dx,dy)
        segments.append((p,dx,dy,length,arc));arc+=length
    cache={}
    for vertex in o.data.vertices:
        x,y,z=vertex.co;closest=(1e9,0)
        for p,dx,dy,length,start in segments:
            t=max(0,min(1,((x-p[0])*dx+(y-p[1])*dy)/(length*length)))
            error=(x-p[0]-dx*t)**2+(y-p[1]-dy*t)**2
            if error<closest[0]:closest=(error,start+length*t)
        cache[vertex.index]=(closest[1]/.2,(z-.02)/.72)
    for polygon in o.data.polygons:
        coords=[cache[o.data.loops[n].vertex_index] for n in polygon.loop_indices]
        # Unwrap the single perimeter seam, avoiding a large UV jump across it.
        us=[p[0] for p in coords]
        for n,(uu,vv) in zip(polygon.loop_indices,coords):
            if max(us)-min(us)>arc/.4 and uu<arc/.4:uu+=arc/.2
            uv.data[n].uv=(uu,vv)
tex=texture_node(rubber,im,'Detail UV');node=rubber.node_tree.nodes.new('ShaderNodeNormalMap');node.uv_map='Detail UV';node.inputs['Strength'].default_value=1
rubber.node_tree.links.new(tex.outputs['Color'],node.inputs['Color']);rubber.node_tree.links.new(node.outputs['Normal'],rubber.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
tex=texture_node(rubber,rough,'Detail UV');rubber.node_tree.links.new(tex.outputs['Color'],rubber.node_tree.nodes.get('Principled BSDF').inputs['Roughness'])
premerge=metrics()
# Static table parts share transforms thereafter. Join by actual material, so
# the result needs one draw per material rather than one draw per object.
groups={}
for o in list(bpy.data.objects):
    if o.type=='MESH':
        assert len(o.data.materials)==1,(o.name,len(o.data.materials))
        groups.setdefault(o.data.materials[0],[]).append(o)
for mat,objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name='Optimized '+mat.name
    # Blender join may retain identical material slots; consolidate them.
    objects[0].data.materials.clear();objects[0].data.materials.append(mat)
    for p in objects[0].data.polygons:p.material_index=0
optimized=metrics()
export('table-player-rails-optimized.glb')
for im in bpy.data.images:
    if im.name.startswith('table-'):im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'table-player-rails-optimized.blend'),compress=True)
stats={'before':baseline,'afterRetopology':premerge,'after':optimized,'triangleReductionPercent':100*(1-optimized['triangles']/baseline['triangles']),'meshReductionPercent':100*(1-optimized['meshes']/baseline['meshes']),'materialDrawCalls':optimized['materialPrimitives'],'removedHiddenObjects':removed,'model':'table-player-rails-optimized.glb','layout':'table-player-rails-layout.json','preservedSha256':before_hash}
(OUT/'table-player-rails-optimized-stats.json').write_text(json.dumps(stats,indent=2)+'\n')
# Matched overview and grazing-angle proof renders. Neither lights nor board
# plane are part of the exported optimized asset.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.world.use_nodes=True
nodes=scene.world.node_tree.nodes;tex=nodes.new('ShaderNodeTexEnvironment');tex.image=bpy.data.images.load(str(OUT/'casino-room.exr'));scene.world.node_tree.links.new(tex.outputs['Color'],nodes.get('Background').inputs['Color']);nodes.get('Background').inputs['Strength'].default_value=.65
for loc,energy,size,color in [((0,-1,9),2100,8,(1,.88,.74)),((-6,3,6),1300,5,(.76,.86,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.data.color=color;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
board=material('Board QA',(.1,.2,.1),.97);tex=board.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/'board-classic.png'));board.node_tree.links.new(tex.outputs['Color'],board.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,.012));bpy.context.object.scale=(5.42,2.70,1);bpy.context.object.data.materials.append(board)
bpy.ops.object.camera_add(location=(10,-15,14));camera=bpy.context.object;scene.camera=camera;camera.rotation_euler=(Vector((0,-.4,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=46
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.render.filepath=str(OUT/'table-player-rails-optimized-preview.png');bpy.ops.render.render(write_still=True)
camera.location=(3.3,-1.7,1.18);camera.rotation_euler=(Vector((-3,2.3,.67))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=37
scene.render.filepath=str(OUT/'table-player-rails-optimized-rubber.png');bpy.ops.render.render(write_still=True)
after_hash={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in preserve}
assert before_hash==after_hash,'A preserved asset changed'
print(json.dumps(stats,indent=2))
