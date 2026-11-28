import * as T from 'three';
const up=new T.Vector3(0,1,0);

// Resolve a photographed eye corner on the actual shaped cheek surface.
export function surfaceAtUV(geometry,uvPoint,offset=.021) {
  const {uv,position}=geometry.attributes,indices=geometry.index;
  const uvTriangle=new T.Triangle(),sample=new T.Vector3(uvPoint.x,uvPoint.y,0);
  const weights=new T.Vector3(),surface=new T.Triangle();
  for(let i=0;i<(indices?.count??position.count);i+=3){
    const ids=[0,1,2].map(j=>indices?indices.getX(i+j):i+j);
    if(ids.every(j=>position.getZ(j)<=0))continue;
    for(const [j,key] of ['a','b','c'].entries()){
      uvTriangle[key].set(uv.getX(ids[j]),uv.getY(ids[j]),0);
    }
    if(!uvTriangle.getBarycoord(sample,weights)||Math.min(weights.x,weights.y,weights.z)<-.00003)continue;
    for(const [j,key] of ['a','b','c'].entries())surface[key].fromBufferAttribute(position,ids[j]);
    const normal=surface.getNormal(new T.Vector3());
    if(normal.z<=0)continue;
    const origin=new T.Vector3().addScaledVector(surface.a,weights.x).addScaledVector(surface.b,weights.y).addScaledVector(surface.c,weights.z);
    const right=new T.Vector3().crossVectors(up,normal).normalize();
    const basis=new T.Matrix4().makeBasis(right,new T.Vector3().crossVectors(normal,right),normal);
    return basis.setPosition(origin.addScaledVector(normal,offset));
  }
  return null;
}

export function headMount(head,name){
  const bone=head.skeleton.getBoneByName('Head'),mount=new T.Group();
  mount.name=name;mount.matrixAutoUpdate=false;
  mount.matrix.copy(head.skeleton.boneInverses[head.skeleton.bones.indexOf(bone)]).multiply(head.bindMatrix);
  bone.add(mount);return mount;
}
