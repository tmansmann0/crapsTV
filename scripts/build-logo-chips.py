"""Build logo-engraved high/LOD variants; original chip assets stay untouched.
Run bake-chip-logo.py first, then Blender --background --python this file.
"""
from pathlib import Path
import bpy,math,json,hashlib,sys
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets';SOURCE=ROOT/'assets/source'
sys.dont_write_bytecode=True;sys.path.insert(0,str(ROOT/'scripts'))
from glb_shared_images import externalize_images
from chip_medallion_uv import compact_medallion_uv
protected=[OUT/'chip.glb',OUT/'chip-lod.glb',SOURCE/'chip.blend',SOURCE/'chip-lod.blend']
hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
HIGH=[(.31,.049),(.33,.049),(.342,.056),(.37,.056),(.39,.057),(.422,.062),(.476,.065),(.490,.061),(.498,.051),(.50,.044),(.50,-.044),(.498,-.051),(.490,-.061),(.476,-.065),(.422,-.062),(.39,-.057),(.37,-.056),(.342,-.056),(.33,-.049),(.31,-.049)]
LOW=[(.31,.049),(.342,.056),(.39,.057),(.422,.062),(.476,.065),(.50,.045),(.50,-.045),(.476,-.065),(.422,-.062),(.39,-.057),(.342,-.056),(.31,-.049)]

def make_object(name,verts,faces,mat):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(mat)
    return obj

def atlas_uv(co,normal):
    x,y,z=co
    if abs(normal.z)>.45:
        # Reflect the back's local Y: both faces read normally after an X flip.
        return ((.25 if normal.z>0 else .75)+x*.45,.37+(y if normal.z>0 else -y)*.45)
    return ((math.atan2(y,x)/(2*math.pi))%1,.80+(z+.065)/.13*.18)

def uv_mesh(obj):
    for layer in list(obj.data.uv_layers):obj.data.uv_layers.remove(layer)
    uv=obj.data.uv_layers.new(name='Chip atlas UV')
    for p in obj.data.polygons:
        for li in p.loop_indices:uv.data[li].uv=atlas_uv(obj.data.vertices[obj.data.loops[li].vertex_index].co,p.normal)
        xs=[uv.data[li].uv.x for li in p.loop_indices]
        if max(xs)-min(xs)>.5 and abs(p.normal.z)<.45:
            for li in p.loop_indices:
                if uv.data[li].uv.x<.5:uv.data[li].uv.x+=1
    # UV0 stays byte-for-byte in the original clay/patina coordinates. UV1
    # gives the entire 2K map to each medallion face, reusing the same pixels.
    detail=obj.data.uv_layers.new(name='Medallion detail UV')
    for p in obj.data.polygons:
        for li in p.loop_indices:
            co=obj.data.vertices[obj.data.loops[li].vertex_index].co
            detail.data[li].uv=(.5+co.x/.626,.5+(co.y if p.normal.z>0 else -co.y)/.626) if obj.data.materials[0].name=='ChipEngraving' else uv.data[li].uv

def logo_material():
    old=bpy.data.materials.get('ChipEngraving')
    if old:bpy.data.materials.remove(old)
    m=bpy.data.materials.new('ChipEngraving');m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;b=n.get('Principled BSDF')
    b.inputs['Metallic'].default_value=0;b.inputs['Roughness'].default_value=1
    for kind,socket in [('albedo','Base Color'),('normal','Normal'),('roughness','Roughness')]:
        im=bpy.data.images.load(str(OUT/f'chip-logo-{kind}.png'),check_existing=True);im.colorspace_settings.name='sRGB' if kind=='albedo' else 'Non-Color';im.pack()
        t=n.new('ShaderNodeTexImage');t.image=im
        if kind=='normal':
            norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=1
            l.new(t.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],b.inputs[socket])
        else:l.new(t.outputs['Color'],b.inputs[socket])
    uvnode=n.new('ShaderNodeUVMap');uvnode.uv_map='Medallion detail UV'
    for node in n:
        if node.type=='TEX_IMAGE':l.new(uvnode.outputs['UV'],node.inputs['Vector'])
    return m

def build(low=False):
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'chip.blend'))
    for image in bpy.data.images:
        if image.name.startswith(('chip-color','chip-normal-','chip-roughness-')) and (OUT/(image.name+'.png')).exists():
            if image.packed_file:image.unpack(method='REMOVE')
            image.filepath=str(OUT/(image.name+'.png'));image.reload();image.pack()
    mats={m.name:m for m in bpy.data.materials}
    for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
    base=mats['ChipBase'];inlay=mats['ChipInlay'];metal=mats['ChipMetal'];engrave=logo_material()
    profile=LOW if low else HIGH;N=32 if low else 96
    verts=[];faces=[]
    for r,z in profile:
        for i in range(N):
            a=i/N*2*math.pi;verts.append((r*math.cos(a),r*math.sin(a),z))
    # Keep the detailed body closed around its inner edge. The LOD need not
    # repeat the internal wall hidden behind the two medallions.
    joins=len(profile)-1 if low else len(profile)
    for j in range(joins):
        nj=(j+1)%len(profile)
        for i in range(N):faces.append((j*N+i,nj*N+i,nj*N+(i+1)%N,j*N+(i+1)%N))
    body=make_object('Logo chip lathed body',verts,faces,base);body.data.materials.append(inlay)
    for p in body.data.polygons:
        i=p.index%N;j=p.index//N
        cream=(i%4==0) if low else (i%12 in [0,1,11])
        if cream and max(profile[j][0],profile[(j+1)%len(profile)][0])>.421:p.material_index=1
        p.use_smooth=True
    for z in (.046,-.046):
        if low:
            verts=[(0,0,z)]+[(.313*math.cos(i/N*2*math.pi),.313*math.sin(i/N*2*math.pi),z) for i in range(N)]
            faces=[(0,i+1,(i+1)%N+1) if z>0 else (0,(i+1)%N+1,i+1) for i in range(N)]
            make_object('Baked original-logo medallion',verts,faces,engrave)
        else:
            bpy.ops.mesh.primitive_cylinder_add(vertices=N,radius=.313,depth=.014,location=(0,0,z-.007 if z>0 else z+.007))
            obj=bpy.context.object;obj.name='Recessed original-logo medallion';obj.data.materials.append(engrave)
            bevel=obj.modifiers.new('Medallion micro bevel','BEVEL');bevel.width=.002;bevel.segments=2
            bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=bevel.name)
            for p in obj.data.polygons:p.use_smooth=abs(p.normal.z)<.65
    for z in (-.055,.055):
        M=4 if low else 6;verts=[];faces=[]
        for i in range(N):
            a=i/N*2*math.pi
            for j in range(M):
                b=j/M*2*math.pi;r=.356+.0025*math.cos(b);verts.append((r*math.cos(a),r*math.sin(a),z+.0025*math.sin(b)))
        for i in range(N):
            for j in range(M):faces.append((i*M+j,((i+1)%N)*M+j,((i+1)%N)*M+(j+1)%M,i*M+(j+1)%M))
        ring=make_object('Fine brass medallion ring',verts,faces,metal)
        for p in ring.data.polygons:p.use_smooth=True
    for obj in bpy.data.objects:
        if obj.type!='MESH':continue
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);uv_mesh(obj)
    bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=body;bpy.ops.object.join()
    body.name='Logo casino chip LOD' if low else 'Logo casino chip'
    old=list(body.data.materials);ordered=[base,inlay,engrave,metal];indices=[ordered.index(old[p.material_index]) for p in body.data.polygons]
    body.data.materials.clear()
    for mat in ordered:body.data.materials.append(mat)
    for p,i in zip(body.data.polygons,indices):p.material_index=i
    body.data.calc_loop_triangles();triangles=len(body.data.loop_triangles)
    assert triangles<=(2500 if low else 10100),(low,triangles)
    name='chip-logo-lod' if low else 'chip-logo'
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.pending.glb')),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_texcoords=True,export_normals=True)
    (OUT/(name+'.pending.glb')).replace(OUT/(name+'.glb'))
    externalize_images(OUT/(name+'.glb'),OUT)
    compact_medallion_uv(OUT/(name+'.glb'))
    bpy.ops.file.pack_all();bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'.pending.blend')),compress=True)
    (SOURCE/(name+'.pending.blend')).replace(SOURCE/(name+'.blend'))
    return {'file':name+'.glb','triangles':triangles,'meshCount':1,'materialPrimitives':4,'radialSegments':N,'bounds':{'diameter':1,'height':.13},'bytes':(OUT/(name+'.glb')).stat().st_size}

high=build();low=build(True)
for path,h in hashes.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==h,path
stat={'version':2,'high':high,'low':low,'materials':['ChipBase','ChipInlay','ChipEngraving','ChipMetal'],'engraving':'Direct original brand-logo.png luminance/alpha mask; recessed .0032 scene-unit normal relief; no letter/pip boolean geometry','atlas':'chip-logo-atlas.json','medallionUV':{'channel':1,'fullFace':True,'originalWearUV0Preserved':True},'preservedSha256':hashes,'brandLogoSha256':hashlib.sha256((OUT/'brand-logo.png').read_bytes()).hexdigest()}
(OUT/'chip-logo-stats.json').write_text(json.dumps(stat,indent=2)+'\n');print(json.dumps(stat,indent=2))
