"""Closed lathed cup inserts, independent of the table's general decimator."""
import math
import bpy
import bmesh

CUP_CENTERS = [(x,y) for x in (-4.,4.) for y in (-3.055,3.055)]
RADIAL_SEGMENTS = 96
# The new padded crown peaks at .920. A continuous collar covers the entire
# boolean edge and embeds its hidden skirt below the lowest adjacent leather.
BRASS_PROFILE = [(.205,.835),(.205,.924),(.201,.935),(.185,.942),(.169,.935),(.166,.835)]
BOWL_PROFILE = [(.145,.656),(.163,.664),(.165,.925),(.176,.925),(.176,.642)]


def _surface(name, center, profile, material, capped=False, skirt_material=None):
    n=RADIAL_SEGMENTS
    vertices=[(center[0]+r*math.cos(i*math.tau/n),center[1]+r*math.sin(i*math.tau/n),z) for r,z in profile for i in range(n)]
    faces=[]
    for j in range(len(profile) if not capped else len(profile)-1):
        nj=(j+1)%len(profile)
        for i in range(n):
            ni=(i+1)%n
            faces.append((j*n+i,j*n+ni,nj*n+ni,nj*n+i))
    if capped:
        # A single axis vertex per floor avoids zero-area fan triangles and
        # gives the bowl a real flat interior floor plus a closed underside.
        for ring,z in [(0,profile[0][1]),(len(profile)-1,profile[-1][1])]:
            axis=len(vertices);vertices.append((center[0],center[1],z))
            for i in range(n):
                faces.append((axis,ring*n+i,ring*n+(i+1)%n))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    if skirt_material:
        mesh.materials.append(skirt_material)
        for face in mesh.polygons:
            face.material_index=1 if face.index//n in (0,4,5) else 0
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    # Volume and winding are explicit; the interior wall must face into the
    # cavity even when rendered FrontSide, rather than relying on DoubleSide.
    if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
    check={'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'volume':bm.calc_volume(signed=True),'degenerateFaces':sum(f.calc_area()<1e-12 for f in bm.faces)}
    assert check['boundaryEdges']==check['nonManifoldEdges']==check['degenerateFaces']==0,(name,check)
    assert check['volume']>0,(name,check)
    bm.to_mesh(mesh);bm.free();mesh.update()
    for polygon in mesh.polygons:polygon.use_smooth=len(polygon.vertices)==4
    uv=mesh.uv_layers.new(name='Material UV');detail=mesh.uv_layers.new(name='Detail UV')
    # All curved bands have a consistent physical arc/profile unwrap. Floors
    # use a planar projection, retaining normal-map depth without pole seams.
    distance=[0.]
    for one,two in zip(profile,profile[1:]):distance.append(distance[-1]+math.hypot(one[0]-two[0],one[1]-two[1]))
    for polygon in mesh.polygons:
        if len(polygon.vertices)==3:
            for li in polygon.loop_indices:
                co=mesh.vertices[mesh.loops[li].vertex_index].co
                uu,vv=co.x-center[0],co.y-center[1]
                uv.data[li].uv=(uu/35.3,vv/4);detail.data[li].uv=(uu/.8,vv/.8)
        else:
            indices=list(polygon.vertices)
            ang=[index%n for index in indices]
            if max(ang)-min(ang)>n/2:ang=[value+n if value<n/2 else value for value in ang]
            for li,index,a in zip(polygon.loop_indices,indices,ang):
                uu=a/n*math.tau*.205;vv=distance[index//n]
                uv.data[li].uv=(uu/35.3,vv/4);detail.data[li].uv=(uu/.8,vv/.8)
    mesh.calc_loop_triangles();check.update({'triangles':len(mesh.loop_triangles),'radialSegments':n})
    return obj,check


def rebuild_cupholders(brass,black):
    removed=[]
    for obj in list(bpy.data.objects):
        if obj.name.startswith(('Brass cup lip','Recessed cup well','Cup well floor')):
            removed.append(obj.name);bpy.data.objects.remove(obj,do_unlink=True)
    checks=[]
    for i,center in enumerate(CUP_CENTERS):
        collar,rim=_surface(f'Cupholder {i+1} sealed brass collar',center,BRASS_PROFILE,brass,skirt_material=black)
        rim.update({'goldBands':[1,2,3],'darkMountingBands':[0,4,5]})
        # Separate only for global batching; no duplicate or overlapping faces.
        # The dark mounting sleeve supports a thin, visible rolled brass lip.
        seam_normals={tuple(v.co):tuple(v.normal) for v in collar.data.vertices}
        bpy.ops.object.select_all(action='DESELECT');collar.select_set(True);bpy.context.view_layer.objects.active=collar
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
        for piece in list(bpy.context.selected_objects):
            used={p.material_index for p in piece.data.polygons};assert len(used)==1
            mat=piece.data.materials[next(iter(used))];piece.data.materials.clear();piece.data.materials.append(mat)
            for face in piece.data.polygons:face.material_index=0
            piece.data.normals_split_custom_set_from_vertices([seam_normals[tuple(v.co)] for v in piece.data.vertices])
        _,well=_surface(f'Cupholder {i+1} inward closed bowl',center,BOWL_PROFILE,black,True)
        checks.append({'cup':i,'blenderCenter':list(center),'worldCenter':[center[0],.920,-center[1]],'rim':rim,'bowl':well,'crownCrest':.920,'rimTop':.942,'skirtBottom':.835,'wellFloor':.656})
    return removed,checks
