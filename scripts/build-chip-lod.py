"""A distant-chip LOD using the original four materials and atlas.
Does not modify chip.glb, chip.blend, or any original chip textures.
"""
from pathlib import Path
import bpy,math,json,hashlib
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets';SOURCE=ROOT/'assets/source'
protected=[OUT/'chip.glb',SOURCE/'chip.blend']
hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'chip.blend'))
original=next(o for o in bpy.data.objects if o.type=='MESH')
original.data.calc_loop_triangles();before=len(original.data.loop_triangles)
mats={m.name:m for m in original.data.materials}
base=next(m for m in mats.values() if m.name.startswith('ChipBase'))
inlay=next(m for m in mats.values() if m.name.startswith('ChipInlay'))
metal=next(m for m in mats.values() if m.name.startswith('ChipMetal'))
engrave=next(m for m in mats.values() if m.name.startswith('ChipEngraving'))
# Preserve the original face wordmark glyph shape as a flat printed LOD detail.
verts=[];faces=[];vmap={}
for poly in original.data.polygons:
 if original.data.materials[poly.material_index]!=engrave:continue
 face=[]
 for index in poly.vertices:
  if index not in vmap:
   p=original.matrix_world@original.data.vertices[index].co;p.z+=.0042
   vmap[index]=len(verts);verts.append(tuple(p))
  face.append(vmap[index])
 faces.append(face)
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
def mesh_object(name,verts,faces,mat):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(mat);return obj
wordmark=mesh_object('LOD face wordmark',verts,faces,engrave)
profile=[(.31,.049),(.342,.056),(.39,.057),(.422,.062),(.476,.065),(.50,.045),(.50,-.045),(.476,-.065),(.422,-.062),(.39,-.057),(.342,-.056),(.31,-.049)]
N=32;verts=[];faces=[]
for r,z in profile:
 for i in range(N):
  a=(i-1/3)/N*2*math.pi;verts.append((r*math.cos(a),r*math.sin(a),z))
for j in range(len(profile)-1):
 for i in range(N):faces.append((j*N+i,(j+1)*N+i,(j+1)*N+(i+1)%N,j*N+(i+1)%N))
body=mesh_object('LOD chip body',verts,faces,base);body.data.materials.append(inlay)
for p in body.data.polygons:
 i=p.index%N;j=p.index//N
 if i%4==0 and max(profile[j][0],profile[j+1][0])>.421:p.material_index=1
 p.use_smooth=True
for z in (.046,-.046):
 verts=[(0,0,z)]+[(.313*math.cos(i/N*2*math.pi),.313*math.sin(i/N*2*math.pi),z) for i in range(N)]
 faces=[(0,i+1,(i+1)%N+1) if z>0 else (0,(i+1)%N+1,i+1) for i in range(N)]
 mesh_object('LOD medallion',verts,faces,base)
for z in (-.055,.055):
 verts=[];faces=[]
 for i in range(N):
  a=i/N*2*math.pi
  for j in range(4):
   b=j/4*2*math.pi;r=.356+.0025*math.cos(b);verts.append((r*math.cos(a),r*math.sin(a),z+.0025*math.sin(b)))
 for i in range(N):
  for j in range(4):faces.append((i*4+j,((i+1)%N)*4+j,((i+1)%N)*4+(j+1)%4,i*4+(j+1)%4))
 obj=mesh_object('LOD brass ring',verts,faces,metal)
 for p in obj.data.polygons:p.use_smooth=True
for x,y in [(-.105,.145),(-.075,.115),(-.045,.085),(.055,.085),(.055,.145),(.115,.085),(.115,.145)]:
 verts=[(x,y,.04625)]+[(x+.013*math.cos(i/8*2*math.pi),y+.013*math.sin(i/8*2*math.pi),.04625) for i in range(8)]
 mesh_object('LOD printed pip',verts,[(0,i+1,(i+1)%8+1) for i in range(8)],engrave)
def atlas_uv(co,normal):
 x,y,z=co
 if abs(normal.z)>.45:return((.25 if normal.z>0 else .75)+x*.45,.37+y*.45)
 return((math.atan2(y,x)/(2*math.pi))%1,.80+(z+.065)/.13*.18)
for obj in bpy.data.objects:
 if obj.type!='MESH':continue
 uv=obj.data.uv_layers.new(name='Chip atlas UV')
 for p in obj.data.polygons:
  for li in p.loop_indices:uv.data[li].uv=atlas_uv(obj.data.vertices[obj.data.loops[li].vertex_index].co,p.normal)
  xs=[uv.data[li].uv.x for li in p.loop_indices]
  if max(xs)-min(xs)>.5 and abs(p.normal.z)<.45:
   for li in p.loop_indices:
    if uv.data[li].uv.x<.5:uv.data[li].uv.x+=1
bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=body;bpy.ops.object.join();body.name='Distant casino chip LOD'
# Consolidate repeated material slots while retaining the four exact names.
old=list(body.data.materials);ordered=[base,inlay,engrave,metal]
indices=[ordered.index(old[p.material_index]) for p in body.data.polygons]
body.data.materials.clear()
for m in ordered:body.data.materials.append(m)
for p,index in zip(body.data.polygons,indices):p.material_index=index
extent=max(max(abs(v.co.x),abs(v.co.y)) for v in body.data.vertices)
for vertex in body.data.vertices:vertex.co.x*=.5/extent;vertex.co.y*=.5/extent
body.data.calc_loop_triangles();after=len(body.data.loop_triangles)
# Keep a normalized one-unit diameter despite the rotated 32-gon sampling.
# Circular envelope is exactly radius .5 and Y-up thickness exactly .13.
bpy.ops.export_scene.gltf(filepath=str(OUT/'chip-lod.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
bpy.ops.file.pack_all();bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'chip-lod.blend'),compress=True)
stat={'beforeTriangles':before,'afterTriangles':after,'reductionPercent':100*(1-after/before),'materials':[m.name for m in ordered],'diameter':1,'height':.13,'atlas':'same front/back/edge atlas as chip.glb','sourceHashes':hashes,'file':'chip-lod.glb'}
(OUT/'chip-lod-stats.json').write_text(json.dumps(stat,indent=2)+'\n')
for path,digest in hashes.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==digest
print(json.dumps(stat,indent=2))

# Product-scale visual check. Preview objects are not included in the GLB.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.25
for loc,energy,size in [((1,-2,3),180,3),((-2,-1,2),100,2),((0,3,2),200,2)]:
 light=bpy.data.lights.new('LOD QA softbox','AREA');light.energy=energy;light.size=size
 obj=bpy.data.objects.new('LOD QA softbox',light);bpy.context.collection.objects.link(obj);obj.location=loc
 obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(1,-1.7,2.5));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=1.4;scene.camera=camera
scene.render.resolution_x=1000;scene.render.resolution_y=820;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'chip-lod-preview.png')
bpy.ops.render.render(write_still=True)
