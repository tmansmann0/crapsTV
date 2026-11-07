"""Crown-only curvature refinement, preserving the physical table envelope.

The visible pad follows the existing profile anchors with tangent-continuous
Bezier arcs, sampled by arc length. Analytic normals survive Boolean n-gons.
"""
import math
import numpy as np

BASE = (10.90, 5.48, .89)
ANCHORS = np.array([(.60,.74),(.555,.85),(.44,.905),(.29,.92),
                    (.16,.875),(.055,.815),(0,.780)], dtype=float)
MAX_PROFILE_TURN_DEGREES = 14
CORNER_SEGMENTS = 28
CUP_CENTERS = [(x,y) for x in (-4.,4.) for y in (-3.055,3.055)]


def curved_profile():
    lengths=np.linalg.norm(np.diff(ANCHORS,axis=0),axis=1)
    tangents=[]
    for i in range(len(ANCHORS)):
        if i==0:t=np.array([0.,1.])
        elif i==len(ANCHORS)-1:t=np.array([0.,-1.])
        elif i==3:t=np.array([-1.,0.]) # Preserve the exact .920 maximum.
        else:
            t=(ANCHORS[i]-ANCHORS[i-1])/lengths[i-1]+(ANCHORS[i+1]-ANCHORS[i])/lengths[i]
            t/=np.linalg.norm(t)
        tangents.append(t)
    points=[];derivatives=[]
    for i in range(len(lengths)):
        a,b=ANCHORS[i],ANCHORS[i+1]
        c=a+tangents[i]*lengths[i]/3
        d=b-tangents[i+1]*lengths[i]/3
        for u in np.linspace(0,1,257,endpoint=i==len(lengths)-1):
            points.append((1-u)**3*a+3*(1-u)**2*u*c+3*(1-u)*u*u*d+u**3*b)
            derivatives.append(3*(1-u)**2*(c-a)+6*(1-u)*u*(d-c)+3*u*u*(b-d))
    points=np.array(points);derivatives=np.array(derivatives)
    directions=derivatives/np.linalg.norm(derivatives,axis=1,keepdims=True)
    turns=np.r_[0,np.cumsum(np.arccos(np.clip(np.sum(directions[:-1]*directions[1:],axis=1),-1,1)))]
    # Spend rows on curvature (especially the small inner roll), rather than
    # uniformly spacing them and leaving a large angular step at the lip.
    chosen=[0];start=0
    while start<len(points)-1:
        end=start+1
        while end<len(points)-1 and turns[end+1]-turns[start]<math.radians(MAX_PROFILE_TURN_DEGREES) and np.linalg.norm(points[end+1]-points[start])<.085:
            end+=1
        chosen.append(end);start=end
    chosen=sorted(set(chosen+[int(np.argmax(points[:,1]))]))
    samples=points[chosen]
    return np.vstack([[.595,.64],samples,[0,.74]]),points,derivatives


def rebuild_padded_crown(material, ring):
    import bpy,bmesh
    from mathutils import Vector
    old=bpy.data.objects.get('Continuous sealed padded crown')
    if old:bpy.data.objects.remove(old,do_unlink=True)
    profile,dense,tangents=curved_profile()
    obj=ring('Continuous sealed padded crown',[(BASE[0]+2*t,BASE[1]+2*t,BASE[2]+t,z) for t,z in profile],material,0)
    for x,y in CUP_CENTERS:
        bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.18,depth=1.10,location=(x,y,.77))
        cutter=bpy.context.object;bpy.context.view_layer.objects.active=obj
        mod=obj.modifiers.new('Preserved closed cup opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    mesh=obj.data
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges)
    assert boundary==nonmanifold==0,(boundary,nonmanifold)
    bm.to_mesh(mesh);bm.free();mesh.update()
    # Along a straight span, radial projection is constant. On corners, the
    # rounded rectangle shares the same center at every offset/profile row.
    def radial(co):
        x,y,z=co;cx,cy=4.56,1.85
        if abs(x)>cx and abs(y)>cy:
            dx,dy=abs(x)-cx,abs(y)-cy;length=math.hypot(dx,dy)
            return length-.89,(math.copysign(dx/length,x),math.copysign(dy/length,y))
        if abs(x)>cx:return abs(x)-5.45,(math.copysign(1,x),0)
        return abs(y)-2.74,(0,math.copysign(1,y))
    normals=[];cup_faces=0
    for face in mesh.polygons:
        face.use_smooth=True
        cup=None
        for cx,cy in CUP_CENTERS:
            if all(abs(math.hypot(mesh.vertices[v].co.x-cx,mesh.vertices[v].co.y-cy)-.18)<.0001 for v in face.vertices):
                cup=(cx,cy);break
        if cup:cup_faces+=1
        for li in face.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co
            if cup:
                normal=Vector((cup[0]-co.x,cup[1]-co.y,0));normal.normalize()
            elif face.normal.z<-.8:
                normal=face.normal.copy() # Hidden closed underside remains a hard seam.
            else:
                offset,r=radial(co)
                if co.z<.74001 and offset>.59:
                    dt,dz=.005,.1
                elif offset<.00001 and co.z<.78001:
                    dt,dz=0,-1
                else:
                    i=int(np.argmin(np.sum((dense-np.array([offset,co.z]))**2,axis=1)))
                    dt,dz=tangents[i]
                normal=Vector((dz*r[0],dz*r[1],-dt));normal.normalize()
            normals.append(normal)
    mesh.normals_split_custom_set(normals)
    mesh.calc_loop_triangles()
    return obj,{'version':1,'visibleCurveSegments':len(profile)-3,'profileRows':len(profile),
        'cornerSegments':CORNER_SEGMENTS,'triangles':len(mesh.loop_triangles),'analyticCornerNormals':True,
        'cupCutFaces':cup_faces,'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,
        'maxProfileTurnDegrees':MAX_PROFILE_TURN_DEGREES,'profile':profile.tolist(),'bounds':[[min(v.co[i] for v in mesh.vertices),max(v.co[i] for v in mesh.vertices)] for i in range(3)]}
