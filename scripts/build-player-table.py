"""Create an optional 12-seat chip-tray table; never overwrite the base table.

Run: blender --background --python scripts/build-player-table.py
The shared modeling helpers are read without executing build-models.py's build.
"""
import hashlib
import json
import math
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets'
SOURCE=ROOT/'assets/source'
originals=[OUT/'table.glb',SOURCE/'table.blend']
before={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}
# Share deterministic modeling helpers, with no original asset-generation code.
helpers=(ROOT/'scripts/build-models.py').read_text().split('\nclean()\nwood=')[0]
exec(compile(helpers,str(ROOT/'scripts/build-models.py'),'exec'),globals())
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'table.blend'))
wood=bpy.data.materials['Hand-polished dark walnut']
leather=bpy.data.materials['Deep oxblood leather']
brass=bpy.data.materials['Aged champagne brass']
black=bpy.data.materials['Dark recessed cup wells']
trayfelt=material('Player tray suede',(.009,.030,.023),.94)

# Remove only the former crown and its old stitching. A consistent offset
# profile meets the rubber top at one shared edge, without coplanar faces or
# the intersecting corner radii that produced the former grazing-angle wedges.
for name in ['Sculpted upholstered oxblood rail','Continuous rail stitch detail']:
    obj=bpy.data.objects.get(name)
    if obj:bpy.data.objects.remove(obj,do_unlink=True)
base=(10.90,5.48,.89)
profile=[(.595,.64),(.60,.74),(.555,.85),(.44,.905),(.29,.92),(.16,.875),(.055,.815),(0,.780),(0,.740)]
rail=ring('Continuous sealed padded crown',[(base[0]+2*t,base[1]+2*t,base[2]+t,y) for t,y in profile],leather,0)
# Preserve the four recessed cup positions from the original scene.
for x in (-4.,4.):
    for y in (-3.055,3.055):
        bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.18,depth=1.10,location=(x,y,.77))
        cutter=bpy.context.object
        bpy.context.view_layer.objects.active=rail
        modifier=rail.modifiers.new('Closed cup opening','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
# Continuous outer seam on the new crown contour.
seam=bpy.data.materials.get('Oxblood seam thread') or material('Oxblood seam thread',(.10,.036,.028),.8)
path=rounded(base[0]+1.04,base[1]+1.04,base[2]+.52,n=100)
stitches=[]
for i in range(0,len(path),3):
    x,y=path[i];xn,yn=path[(i+1)%len(path)]
    dash=cube('Player table upholstery stitch',(.031,.005,.003),((x+xn)/2,(y+yn)/2,.879),seam,0)
    dash.rotation_euler.z=math.atan2(yn-y,xn-x);stitches.append(dash)
bpy.ops.object.select_all(action='DESELECT')
for stitch in stitches:stitch.select_set(True)
bpy.context.view_layer.objects.active=stitches[0];bpy.ops.object.join();stitches[0].name='Continuous player table stitching'

# One continuous, closed perimeter shelf. Its outer edge extends front and
# sides, leaving only a narrow trim at the back (there are no back seats).
def offset_ring(name,layers,mat,bevel=.025):
    # Each layer adds an offset in world Z; Blender's horizontal depth is -Y.
    obj=ring(name,[layer[:4] for layer in layers],mat,bevel=0)
    count=len(obj.data.vertices)//len(layers)
    for j,layer in enumerate(layers):
        for vertex in obj.data.vertices[j*count:(j+1)*count]:
            vertex.co.y-=layer[4]
    obj.data.update()
    if bevel:
        bpy.context.view_layer.objects.active=obj
        modifier=obj.modifiers.new('Rounded solid shelf edge','BEVEL');modifier.width=bevel;modifier.segments=3
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj

shelf=offset_ring('Continuous player chip shelf',[
    (14.30,7.90,1.50,.40,.50),(14.40,8.00,1.55,.61,.50),
    (11.98,6.55,1.42,.61,0),(11.98,6.55,1.42,.40,0)],wood,.025)
offset_ring('Player shelf brass rim',[
    (14.414,8.014,1.557,.589,.50),(14.414,8.014,1.557,.607,.50),
    (14.360,7.960,1.530,.607,.50),(14.360,7.960,1.530,.589,.50)],brass,.004)
# A deeper matching supporting apron keeps the extension from looking like a
# floating strip. It is inside the shelf envelope, never inside the dice wall.
offset_ring('Player shelf supporting apron',[
    (14.25,7.85,1.475,-.17,.50),(14.25,7.85,1.475,.43,.50),
    (13.90,7.50,1.30,.43,.50),(13.90,7.50,1.30,-.17,.50)],wood,.018)
offset_ring('Player shelf lower brass reveal',[
    (14.255,7.855,1.48,-.105,.50),(14.255,7.855,1.48,-.088,.50),
    (14.210,7.810,1.46,-.088,.50),(14.210,7.810,1.46,-.105,.50)],brass,.003)

layout={
 'version':1,'coordinateSystem':'glTF Y-up; front = +Z',
 'model':'table-player-rails.glb',
 'originalAssetsSha256':before,
 'board':{'width':10.84,'depth':5.4,'y':.012,'center':[0,.012,0]},
 'physics':{'floorY':0,'wallInnerX':5.42,'wallInnerZ':2.71,'rubberTopY':.74,'crownTopY':.92,'cornerCentersX':4.56,'cornerCentersZ':1.85,'cornerRadius':.86},
 'outerDeck':{'minX':-7.20,'maxX':7.20,'minZ':-3.50,'maxZ':4.50,'surfaceY':.61},
 'tray':{'outerWidth':1.62,'outerDepth':.78,'usableWidth':1.48,'usableDepth':.62,'floorY':.675,'rimTopY':.738,'maxChipDiameter':.23,'columnSpacing':.29,'rowSpacing':.27,'columnOffsets':[-.58,-.29,0,.29,.58],'rowOffsets':[-.135,.135]},
 'seats':[]}
seats=[]
for x in (-4.5,-2.7,-.9,.9,2.7,4.5):seats.append(('front',[x,.675,3.91],[1,0,0],[0,0,1]))
for z in (-1.85,0,1.85):seats.append(('left',[-6.59,.675,z],[0,0,1],[-1,0,0]))
for z in (-1.85,0,1.85):seats.append(('right',[6.59,.675,z],[0,0,-1],[1,0,0]))
for index,(side,center,tangent,outward) in enumerate(seats):
    # Build the tray at the origin, then rotate/translate all pieces together.
    # In Blender, local +X follows the seat tangent and local -Y is outward.
    parts=[]
    parts.append(slab(f'Seat {index+1:02} solid tray base',1.62,.78,.10,.609,.658,wood))
    parts.append(ring(f'Seat {index+1:02} raised tray rim',[(1.62,.78,.10,.638),(1.62,.78,.10,.735),(1.48,.62,.07,.735),(1.48,.62,.07,.638)],wood,.012))
    parts.append(slab(f'Seat {index+1:02} suede chip bed',1.479,.619,.069,.654,.675,trayfelt))
    parts.append(ring(f'Seat {index+1:02} tray brass lip',[(1.505,.645,.08,.732),(1.505,.645,.08,.738),(1.480,.620,.069,.738),(1.480,.620,.069,.732)],brass,.003))
    angle=math.atan2(-tangent[2],tangent[0])
    for part in parts:
        part.rotation_euler.z=angle
        part.location=(center[0],-center[2],0)
    label=[center[i]+outward[i]*.45 for i in range(3)];label[1]=.745
    plaque=cube(f'Seat {index+1:02} label plaque',(.96,.135,.014),(0,0,.626),black,.028)
    plaque.rotation_euler.z=angle;plaque.location.x=label[0];plaque.location.y=-label[2]
    slots=[]
    for row,offset in enumerate((-.135,.135)):
        for column,across in enumerate((-.58,-.29,0,.29,.58)):
            pos=[center[i]+tangent[i]*across+outward[i]*offset for i in range(3)]
            pos[1]=.675
            slots.append({'row':row,'column':column,'position':pos})
    layout['seats'].append({'seat':index,'id':f'{side}-{sum(1 for seat in layout["seats"] if seat["side"]==side)+1}',
      'side':side,'bankBase':center,'tangent':tangent,'outward':outward,'labelPosition':label,
      'trayUsableSize':[1.48,.62],'maxChipDiameter':.23,'stackSlots':slots,
      'primaryStackPositions':[slot['position'] for slot in slots if slot['row']==0]})

# Regularize the crown and closed shelf normals; no backface workaround hides
# holes. These two meshes must be manifold after the cup booleans.
mesh_checks={}
for obj in [rail,shelf]:
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    boundary=sum(1 for edge in bm.edges if edge.is_boundary)
    nonmanifold=sum(1 for edge in bm.edges if not edge.is_manifold)
    mesh_checks[obj.name]={'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold}
    if boundary or nonmanifold:raise RuntimeError(f'Open crown/shelf mesh: {obj.name}: {mesh_checks[obj.name]}')
    bm.to_mesh(obj.data);bm.free();obj.data.update()
layout['meshValidation']=mesh_checks
(OUT/'table-player-rails-layout.json').write_text(json.dumps(layout,indent=2)+'\n')
export('table-player-rails.glb')
for image in bpy.data.images:
    if image.name.startswith('table-'):image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'table-player-rails.blend'),compress=True)

# Independent seamless wool maps requested for the board plane. The field is
# spectrally filtered random fiber noise, not a regular woven or diagonal grid.
n=512;rng=np.random.default_rng(8675309)
freq=np.fft.fftfreq(n);fx,fy=np.meshgrid(freq,freq)
noise=np.fft.fft2(rng.normal(size=(n,n)))
band=np.exp(-((fx/.20)**2+(fy/.135)**2))-.82*np.exp(-((fx/.038)**2+(fy/.035)**2))
fibers=np.fft.ifft2(noise*band).real;fibers=(fibers-fibers.mean())/fibers.std()
broad=np.fft.ifft2(np.fft.fft2(rng.normal(size=(n,n)))*np.exp(-((fx/.025)**2+(fy/.025)**2))).real
broad=(broad-broad.mean())/broad.std()
height=fibers*.00006+broad*.000025
hx=(np.roll(height,-1,1)-np.roll(height,1,1))/.0018
hy=(np.roll(height,-1,0)-np.roll(height,1,0))/.0018
normal=np.stack((-hx,-hy,np.ones_like(hx)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
im=image_texture('felt-normal',normal*.5+.5);im.colorspace_settings.name='Non-Color'
rough=np.clip(.94+fibers*.009+broad*.007,.90,.985)
im=image_texture('felt-roughness',np.repeat(rough[:,:,None],3,axis=2));im.colorspace_settings.name='Non-Color'

# Inspection scene: the saved/exported asset itself has no camera or lights.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.world.use_nodes=True;nodes=scene.world.node_tree.nodes
tex=nodes.new('ShaderNodeTexEnvironment');tex.image=bpy.data.images.load(str(OUT/'casino-room.exr'))
scene.world.node_tree.links.new(tex.outputs['Color'],nodes.get('Background').inputs['Color'])
nodes.get('Background').inputs['Strength'].default_value=.65
for loc,energy,size,color in [((0,-1,9),2100,8,(1,.88,.74)),((-6,3,6),1300,5,(.76,.86,1))]:
    bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object
    lamp.data.energy=energy;lamp.data.shape='DISK';lamp.data.size=size;lamp.data.color=color
    lamp.rotation_euler=(Vector((0,0,0))-lamp.location).to_track_quat('-Z','Y').to_euler()
board=material('Board QA',(.1,.2,.1),.97);bn=board.node_tree.nodes
im=bn.new('ShaderNodeTexImage');im.image=bpy.data.images.load(str(OUT/'board-classic.png'))
board.node_tree.links.new(im.outputs['Color'],bn.get('Principled BSDF').inputs['Base Color'])
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,.012));bpy.context.object.scale=(5.42,2.70,1);bpy.context.object.data.materials.append(board)
bpy.ops.object.camera_add(location=(10,-15,14));camera=bpy.context.object;scene.camera=camera
camera.rotation_euler=(Vector((0,-.4,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=46
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.render.filepath=str(OUT/'table-player-rails-preview.png');bpy.ops.render.render(write_still=True)
# Low grazing interior view checks the joint called out in the screenshot.
camera.location=(3.3,-1.7,1.18);camera.rotation_euler=(Vector((-3.0,2.3,.67))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=37
scene.render.filepath=str(OUT/'table-player-rails-joint-closeup.png');bpy.ops.render.render(write_still=True)
after={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}
if before!=after:raise RuntimeError('Base table changed unexpectedly')
print(json.dumps({'originalAssetsUnchanged':True,'originalSha256':after,'meshChecks':mesh_checks,'seatCount':len(layout['seats'])},indent=2))
