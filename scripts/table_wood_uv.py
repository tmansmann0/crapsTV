"""Board-local UV1 projection, in .8-scene-unit coordinates.

The scanned grain runs along texture U. A wooden ring is treated as four
mitered boards, never a single bent strip. The broad shelf adds shared miter
edges; all parts still join into the original seven material batches.
Coordinates are deliberately local to each part, before its seat transform.
"""
import hashlib

def prepare_miter_seams(objects, material):
    """Place actual shared edges on the four miter lines, before UV splitting.

    Dissolve coplanar old ring quads first: their artificial subdivisions serve
    no silhouette purpose and would otherwise make a staircase-shaped UV seam.
    """
    import bmesh
    from mathutils import Vector
    for obj in objects:
        if obj.type!='MESH' or not obj.data.materials or obj.data.materials[0]!=material:
            continue
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.dissolve_limit(bm,angle_limit=.00001,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False)
        # Remove only redundant coplanar subdivision on all wood. The broad
        # shelf top needs an exact visible miter; fine moldings need no cuts.
        if obj.name!='Continuous player chip shelf':
            bm.to_mesh(obj.data);bm.free();obj.data.update()
            continue
        lower=[min(v.co[i] for v in bm.verts) for i in range(3)]
        upper=[max(v.co[i] for v in bm.verts) for i in range(3)]
        cx,cy=[(lower[i]+upper[i])/2 for i in range(2)]
        hx,hy=[(upper[i]-lower[i])/2 for i in range(2)]
        for sx,sy in ((1,1),(1,-1),(-1,1),(-1,-1)):
            # sx*(x-cx)-sy*(y-cy)=hx-hy, the exact board boundary.
            # Only the corresponding corner participates. Extending an infinite
            # plane across the opposite board would add useless tessellation.
            faces=[f for f in bm.faces if abs(f.normal.z)>.9 and sx*(f.calc_center_median().x-cx)>0 and sy*(f.calc_center_median().y-cy)>0]
            edges={e for f in faces for e in f.edges};verts={v for f in faces for v in f.verts}
            bmesh.ops.bisect_plane(bm,geom=list(verts)+list(edges)+faces,dist=.000001,
                plane_co=Vector((cx+sx*(hx-hy),cy,0)),plane_no=Vector((sx,-sy,0)),
                clear_inner=False,clear_outer=False)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(obj.data);bm.free();obj.data.update()

def wood_uv(co, normal, bounds, name, face_center=None):
    lower, upper = bounds
    center = [(a+b)/2 for a,b in zip(lower,upper)]
    x,y,z = [a-b for a,b in zip(co,center)]
    hx,hy,_ = [(b-a)/2 for a,b in zip(lower,upper)]
    nx,ny,nz = normal
    fx,fy,_ = [a-b for a,b in zip(face_center if face_center is not None else co,center)]
    leg = 'pedestal' in name.lower() or 'leg' in name.lower()
    if leg and abs(nz) < .75:
        # Upright supports are cut along the grain, not wrapped horizontally.
        s,t,region = z, (x if abs(ny)>=abs(nx) else y), 'upright'
    else:
        # A 45-degree miter separates adjacent boards, including rounded ends.
        # Project straight through each corner instead of following arc length.
        end = hx-abs(fx) < hy-abs(fy)
        region = ('right' if fx>=0 else 'left') if end else ('back' if fy>=0 else 'front')
        s = y if end else x
        if abs(nz)>=.6:
            t = x if end else y
        else:
            t = z
    digest=hashlib.sha256((name+'|'+region).encode()).digest()
    # Different cuts of the same photograph avoid identical knots on 12 trays.
    u,v=digest[0]/255*3.7,digest[1]/255*3.7
    return s/.8+u,t/.8+v


def apply_wood_uv(objects, material):
    """Write UVs before batching; coordinates keep physical scale under rotation."""
    count=0
    for obj in objects:
        if obj.type!='MESH' or not obj.data.materials or obj.data.materials[0]!=material:
            continue
        mesh=obj.data
        detail=mesh.uv_layers.get('Detail UV') or mesh.uv_layers.new(name='Detail UV')
        coords=[tuple(v.co) for v in mesh.vertices]
        bounds=([min(c[i] for c in coords) for i in range(3)], [max(c[i] for c in coords) for i in range(3)])
        for face in mesh.polygons:
            # Select one board/face for the entire polygon. Per-vertex switching
            # would interpolate across two unrelated cuts and stretch the scan.
            for li in face.loop_indices:
                co=mesh.vertices[mesh.loops[li].vertex_index].co
                detail.data[li].uv=wood_uv(co,face.normal,bounds,obj.name,face.center)
            count+=1
    return count


def rebuild_wood_normals(objects, material):
    """Regenerate shading only after the final UV-seam/topology operations.

    BMesh dissolve/bisect changes corner indexing; copied custom split normals
    from the earlier weighted-normal modifier no longer describe those corners.
    Planar horizontal surfaces have exact face normals. Curved/beveled bands
    retain smooth, face-area/angle-weighted shading instead of faceted lighting.
    """
    import bpy
    results=[]
    for obj in objects:
        if obj.type!='MESH' or not obj.data.materials or obj.data.materials[0]!=material:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True);bpy.context.view_layer.objects.active=obj
        mesh=obj.data
        if mesh.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        flat=0
        for face in mesh.polygons:
            if abs(face.normal.z)>.999:
                face.use_smooth=False;flat+=1
        modifier=obj.modifiers.new('Final topology wood normals','WEIGHTED_NORMAL')
        modifier.mode='FACE_AREA_WITH_ANGLE';modifier.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        results.append({'part':obj.name,'planarHorizontalFaces':flat,'customNormalsRegenerated':True})
    return results
