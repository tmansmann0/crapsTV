import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// Decode actual exported geometry without textures/DOM, including node transforms.
const bytes=readFileSync(new URL('../public/assets/table-player-rails-optimized.glb',import.meta.url));
const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength));
const bin=bytes.subarray(28+jsonLength);
function values(index){
 const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView];
 const [read,size]=({5126:['readFloatLE',4],5125:['readUInt32LE',4],5123:['readUInt16LE',2],5121:['readUInt8',1]})[a.componentType];
 const width=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type],stride=v.byteStride||width*size;
 const start=(v.byteOffset||0)+(a.byteOffset||0);
 return Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>bin[read](start+i*stride+j*size)));
}
const meshes=gltf.nodes.filter(n=>n.mesh!==undefined).flatMap(node=>gltf.meshes[node.mesh].primitives.map(p=>{
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(values(p.attributes.POSITION).flat(),3));
 geometry.setAttribute('normal',new THREE.Float32BufferAttribute(values(p.attributes.NORMAL).flat(),3));
 geometry.setIndex(values(p.indices).flat());
 const material=new THREE.MeshBasicMaterial({side:THREE.FrontSide});material.name=gltf.materials[p.material].name;
 const mesh=new THREE.Mesh(geometry,material);
 const transform=new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation||[0,0,0])),new THREE.Quaternion(...(node.rotation||[0,0,0,1])),new THREE.Vector3(...(node.scale||[1,1,1])));
 if(node.matrix)transform.fromArray(node.matrix);
 mesh.applyMatrix4(transform);mesh.updateMatrixWorld(true);return mesh;
}));
const centers=[-4,4].flatMap(x=>[-3.055,3.055].map(z=>[x,z]));
const cast=new THREE.Raycaster();
const first=(origin,direction,far=2)=>{cast.set(new THREE.Vector3(...origin),new THREE.Vector3(...direction));cast.far=far;return cast.intersectObjects(meshes,false)[0];};

test('all four complete brass collars remain above the leather at every azimuth',()=>{
 for(const [x,z]of centers)for(let i=0;i<96;i++)for(const radius of [.178,.185,.192]){
  const angle=(i+.37)/96*Math.PI*2;
  const hit=first([x+Math.cos(angle)*radius,1.2,z+Math.sin(angle)*radius],[0,-1,0]);
  assert.equal(hit?.object.material.name,'Aged champagne brass',`rim ${x},${z} angle ${i} radius ${radius}`);
  assert.ok(hit.point.y>.928 && hit.point.y<.943,'rim clears .920 crown');
 }
});

test('the exposed mounting sleeve is dark rather than a bulky gold side band',()=>{
 for(const [x,z] of centers){
  const sign=Math.sign(z);
  const hit=first([x,.90,z+sign*.26],[0,0,-sign],.12);
  assert.equal(hit?.object.material.name,'Dark recessed cup wells');
  assert.ok(hit.distance>.05 && hit.distance<.06,'actual collar mounting sleeve');
 }
});

test('exported cups have inward FrontSide walls and complete recessed floors',()=>{
 for(const [x,z]of centers)for(let i=0;i<96;i++){
  const angle=(i+.41)/96*Math.PI*2,dx=Math.cos(angle),dz=Math.sin(angle);
  const wall=first([x,.82,z],[dx,0,dz],.3);
  assert.equal(wall?.object.material.name,'Dark recessed cup wells');
  assert.ok(wall.distance>.163 && wall.distance<.167,'near inward wall, not distant table');
  const floor=first([x+dx*.12,1.15,z+dz*.12],[0,-1,0]);
  assert.equal(floor?.object.material.name,'Dark recessed cup wells');
  assert.ok(Math.abs(floor.point.y-.656)<1e-5,'actual flat interior floor');
 }
});

test('exported cup triangles and shading normals are sound at every cup, with closed authoring shells',()=>{
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3(),centroid=new THREE.Vector3(),radial=new THREE.Vector3(),vNormal=new THREE.Vector3();
 const stats=JSON.parse(readFileSync(new URL('../public/assets/table-player-rails-optimized-stats.json',import.meta.url)));
 assert.equal(stats.cupholderValidation.length,4);assert.equal(stats.cupholderProfileVersion,1);
 for(const cup of stats.cupholderValidation)for(const part of ['rim','bowl']){
  assert.equal(cup[part].boundaryEdges,0);assert.equal(cup[part].nonManifoldEdges,0);assert.equal(cup[part].degenerateFaces,0);assert.ok(cup[part].volume>0);assert.equal(cup[part].radialSegments,96);
 }
 for(const [x,z]of centers){let checked=0,inward=0;
  for(const mesh of meshes.filter(m=>['Aged champagne brass','Dark recessed cup wells'].includes(m.material.name))){
   const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal,indices=mesh.geometry.index.array;
   const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
   for(let i=0;i<indices.length;i+=3){
    a.fromBufferAttribute(p,indices[i]).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,indices[i+1]).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,indices[i+2]).applyMatrix4(mesh.matrixWorld);
    if(![a,b,c].every(v=>Math.hypot(v.x-x,v.z-z)<.207 && v.y>.64 && v.y<.944))continue;
    normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a));assert.ok(normal.length()>1e-8,'nondegenerate exported triangle');checked++;
    centroid.copy(a).add(b).add(c).multiplyScalar(1/3);const radius=Math.hypot(centroid.x-x,centroid.z-z);
    if(mesh.material.name==='Dark recessed cup wells'&&radius<.167&&centroid.y>.70&&centroid.y<.90){
     radial.set(centroid.x-x,0,centroid.z-z).normalize();assert.ok(normal.normalize().dot(radial)<-.99,'geometric inner wall points inward');
     for(const k of [0,1,2]){vNormal.fromBufferAttribute(n,indices[i+k]).applyNormalMatrix(normalMatrix);assert.ok(vNormal.dot(radial)<-.15,'shading normal faces cavity');}inward++;
    }
   }
  }
  assert.equal(checked,2112,'all collar and bowl triangles inspected');assert.ok(inward>=96);
 }
});
