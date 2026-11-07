import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { createTableMaterials } from "/src/table-materials.js";
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1600, 1000);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#18201c");
const camera = new THREE.PerspectiveCamera(40, 1.6, 0.035, 100);
const env = await new EXRLoader().loadAsync("/assets/casino-room.exr");
env.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(env).texture;
scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
for (const [color, intensity, pos] of [
  [0xffe5c6, 2.5, [-3, 8, 3]],
  [0xf3d4a3, 1.1, [6, 5, -4]],
]) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.fromArray(pos);
  scene.add(l);
}
const g = (
  await new GLTFLoader().loadAsync("/assets/table-player-rails-optimized.glb")
).scene;
const materials = await createTableMaterials(renderer, {
  resolveAsset: (n) => "/assets/" + n,
});
materials.apply(g);
scene.add(g);
const boardTexture = await new THREE.TextureLoader().loadAsync(
  "/assets/board-classic.png",
);
boardTexture.colorSpace = THREE.SRGBColorSpace;
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(10.84, 5.4),
  new THREE.MeshStandardMaterial({ map: boardTexture, roughness: 0.98 }),
);
board.rotation.x = -Math.PI / 2;
board.position.y = 0.012;
scene.add(board);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: "#17231e", roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.5;
scene.add(floor);

const raycaster = new THREE.Raycaster();
const centers = [-4,4].flatMap(x=>[-3.055,3.055].map(z=>[x,0.92,z]));
window.captureCup = (index,view="high",angle=0) => {
 const c=centers[index];
 const offset=view==="low"?[.53,.12,.26]:view==="orbit"?[Math.cos(angle)*.58,.22,Math.sin(angle)*.58]:[.15,.55,.35];
 camera.position.set(c[0]+offset[0],c[1]+offset[1],c[2]+offset[2]);
 camera.lookAt(c[0],.84,c[2]);camera.updateMatrixWorld(true);g.updateMatrixWorld(true);
 renderer.render(scene,camera);
 return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,position:camera.position.toArray()};
};
window.cupRayProof=()=>centers.map((c,index)=>{
 const rim=[],inside=[];
 for(let i=0;i<64;i++){
  const a=i/64*Math.PI*2;
  for(const radius of [.178,.185,.192]){
   raycaster.set(new THREE.Vector3(c[0]+Math.cos(a)*radius,1.3,c[2]+Math.sin(a)*radius),new THREE.Vector3(0,-1,0));
   const h=raycaster.intersectObject(g,true)[0];rim.push(h?.object.material.name||"none");
  }
  raycaster.set(new THREE.Vector3(c[0],.82,c[2]),new THREE.Vector3(Math.cos(a),0,Math.sin(a)));
  const h=raycaster.intersectObject(g,true)[0];inside.push(h?.object.material.name||"none");
 }
 return {index,rim,inside};
});
window.captureCup(3);window.ready=true;
