"""Refine only the optimized table crown, starting from its versioned snapshot.

blender --background --python scripts/refine-padded-crown.py
All non-leather mesh payloads and all protected source models must stay identical.
"""
import bpy,json,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets';SOURCE=ROOT/'assets/source'
sys.dont_write_bytecode=True;sys.path.insert(0,str(ROOT/'scripts'))
from table_padded_crown import rebuild_padded_crown
snapshot=SOURCE/'legacy/0.11.0'
manifest=json.loads((snapshot/'manifest.json').read_text())
for name,digest in manifest['sha256'].items():
    assert hashlib.sha256((snapshot/name).read_bytes()).hexdigest()==digest,name
helpers=(ROOT/'scripts/build-models.py').read_text().split('\nclean()\nwood=')[0]
exec(compile(helpers,str(ROOT/'scripts/build-models.py'),'exec'),globals())
bpy.ops.wm.open_mainfile(filepath=str(snapshot/'table-player-rails-optimized.blend'))

def payload(obj):
    mesh=obj.data
    return json.dumps({'matrix':list(map(list,obj.matrix_world)),'vertices':[list(v.co) for v in mesh.vertices],
      'faces':[[*p.vertices] for p in mesh.polygons],'smooth':[p.use_smooth for p in mesh.polygons],
      'uvs':{uv.name:[list(d.uv) for d in uv.data] for uv in mesh.uv_layers},
      'normals':[list(n.vector) for n in mesh.corner_normals]},separators=(',',':'))

def signatures():
    return {o.name:hashlib.sha256(payload(o).encode()).hexdigest() for o in bpy.data.objects
      if o.type=='MESH' and o.data.materials[0].name!='Deep oxblood leather'}
untouched=signatures()
old=bpy.data.objects['Optimized Deep oxblood leather'];old.data.calc_loop_triangles();previous=len(old.data.loop_triangles)
rail,checks=rebuild_padded_crown(bpy.data.materials['Deep oxblood leather'],ring)
bpy.data.objects.remove(old,do_unlink=True);rail.name='Optimized Deep oxblood leather'
assert untouched==signatures(),'Non-crown geometry, UVs or normals changed'
for o in bpy.data.objects:
    if o.type=='MESH':o.data.calc_loop_triangles()
triangles=sum(len(o.data.loop_triangles) for o in bpy.data.objects if o.type=='MESH')
assert triangles<=42000,triangles
stats=json.loads((snapshot/'table-player-rails-optimized-stats.json').read_text())
for field in ['afterRetopology','after']:stats[field]['triangles']+=checks['triangles']-previous
stats['triangleReductionPercent']=100*(1-triangles/stats['before']['triangles'])
stats['paddedCrown']={**checks,'previousTriangles':previous,'triangleDelta':checks['triangles']-previous,
  'triangleBudget':42000,'rollback':'assets/source/legacy/0.11.0',
  'unchangedNonCrownBlenderSha256':untouched}
export('table-player-rails-optimized.pending.glb')
(OUT/'table-player-rails-optimized.pending.glb').replace(OUT/'table-player-rails-optimized.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'table-player-rails-optimized.pending.blend'),compress=True)
(SOURCE/'table-player-rails-optimized.pending.blend').replace(SOURCE/'table-player-rails-optimized.blend')
(OUT/'table-player-rails-optimized-stats.json').write_text(json.dumps(stats,indent=2)+'\n')
print('PADDED_CROWN_RESULT',json.dumps(stats['paddedCrown']))
