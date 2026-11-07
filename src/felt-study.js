import * as THREE from "three";
import { createFeltSurface } from "./felt-material.js";

/** Reversible prototypes; only a selected option should enter the game factory. */
export const FELT_STUDIES = Object.freeze({
  fine: {
    label: "Fine casino baize",
    relief: 0.55,
    tile: 0.34,
    sheen: 0.55,
    sheenRoughness: 0.92,
    sheenColor: "#47775a",
    nap: 0.018,
    colour: 0.028,
    fibre: 0.02,
  },
  plush: {
    label: "Soft wool felt",
    relief: 0.7,
    tile: 0.43,
    sheen: 0.75,
    sheenRoughness: 0.69,
    sheenColor: "#47775a",
    nap: 0.035,
    colour: 0.035,
    fibre: 0.09,
  },
  nap: {
    label: "Deep brushed nap",
    relief: 0.65,
    tile: 0.48,
    sheen: 0.86,
    sheenRoughness: 0.55,
    sheenColor: "#3d6c48",
    nap: 0.05,
    colour: 0.031,
    fibre: 0.11,
  },
});

export function createFeltStudy(material, atlas) {
  const controller = createFeltSurface(material, atlas);
  return {
    apply(id) {
      const spec = FELT_STUDIES[id];
      if (!spec) throw Error("Unknown felt study");
      return controller.apply(spec);
    },
    dispose: controller.dispose,
  };
}

/** One optional shallow microfibre batch, restricted to the macro-view area. */
export function createFeltFuzzLayer(print, { count = 50000 } = {}) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0],
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const data = new Float32Array(count * 4);
  let seed = 915711;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    data[i * 4] = -0.9 + random() * 1.8;
    data[i * 4 + 1] = 0.4 + random() * 2.3;
    data[i * 4 + 2] = random() * Math.PI * 2;
    data[i * 4 + 3] = random();
  }
  geometry.setAttribute(
    "feltFiber",
    new THREE.InstancedBufferAttribute(data, 4),
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0.014, 1.55),
    1.6,
  );
  const uniforms = {
    feltPrint: { value: print },
    feltFuzzHeight: { value: 0.002 },
    feltFuzzOpacity: { value: 0.2 },
    feltFuzzFade: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    uniforms,
    vertexShader: `
attribute vec4 feltFiber;
uniform float feltFuzzHeight;
varying vec2 vFiberUv;
varying vec2 vFiberPrintUv;
varying vec3 vFiberWorld;
void main(){
 vFiberUv=uv;
 vec2 direction=vec2(cos(feltFiber.z),sin(feltFiber.z));
 float len=mix(.0022,.0062,feltFiber.w);
 vec2 p=feltFiber.xy+direction*(position.y-.5)*len+vec2(-direction.y,direction.x)*position.x*.0006;
 vFiberWorld=vec3(p.x,.0122+position.y*feltFuzzHeight,p.y);
 vFiberPrintUv=vec2(p.x/10.84+.5,.5-p.y/5.4);
 gl_Position=projectionMatrix*viewMatrix*vec4(vFiberWorld,1.0);
}`,
    fragmentShader: `
uniform sampler2D feltPrint;
uniform float feltFuzzOpacity;
uniform float feltFuzzFade;
varying vec2 vFiberUv;
varying vec2 vFiberPrintUv;
varying vec3 vFiberWorld;
void main(){
 vec3 colour=texture2D(feltPrint,vFiberPrintUv).rgb;
 float cloth=1.0-smoothstep(.14,.38,max(max(colour.r,colour.g),colour.b));
 float strand=exp(-pow((vFiberUv.x-.5)*4.2,2.0))*smoothstep(0.0,.15,vFiberUv.y)*(1.0-smoothstep(.85,1.0,vFiberUv.y));
 float grazing=pow(1.0-abs(normalize(cameraPosition-vFiberWorld).y),2.0);
 float alpha=strand*cloth*feltFuzzOpacity*feltFuzzFade;
 if(alpha<.008) discard;
 gl_FragColor=vec4(colour*(2.0+grazing*.6)+vec3(.004,.012,.005),alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  const allSettings = {
    fine: [0, 0, 0],
    plush: [0, 0, 0],
    nap: [50000, 0.0032, 0.65],
  };
  const focus = new THREE.Vector3(0, 0.012, 1.4);
  function apply(id, camera) {
    const settings = allSettings[id];
    if (!settings) throw Error("Unknown felt fuzz option");
    geometry.instanceCount = settings[0];
    uniforms.feltFuzzHeight.value = settings[1];
    uniforms.feltFuzzOpacity.value = settings[2];
    const distance = camera.position.distanceTo(focus);
    uniforms.feltFuzzFade.value =
      1 - THREE.MathUtils.smoothstep(distance, 2.4, 4.2);
    mesh.visible =
      geometry.instanceCount > 0 && uniforms.feltFuzzFade.value > 0.001;
  }
  return {
    mesh,
    apply,
    get triangles() {
      return mesh.visible ? geometry.instanceCount * 2 : 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
