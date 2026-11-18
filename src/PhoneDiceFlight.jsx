import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { configureRenderer } from "./render-quality.js";
import { disposeModel } from "./three-resources.js";
import { sampleThrow } from "./throw-motion.js";
import { DICE_SIZE } from "./dice-launch.js";
import { createDiceMaterial, diceWearIndex } from "./dice-material.js";
import { assetURL as asset } from "./asset-url.js";

let modelBytes;
let preloadedMaps = false;
function preloadModel() {
  modelBytes ??= fetch(asset("dice.glb"), { priority: "low" })
    .then((response) => {
      if (!response.ok) throw new Error("Dice model unavailable");
      return response.arrayBuffer();
    })
    .catch((error) => {
      modelBytes = null;
      throw error;
    });
  return modelBytes;
}

export function preloadDiceFlight() {
  preloadModel().catch(() => {});
  if (preloadedMaps) return;
  preloadedMaps = true;
  for (const map of ["wear", "roughness"])
    for (const i of [1, 2, 3])
      fetch(asset(`dice-${map}-${i}.png`), { priority: "low" })
        .then((response) => response.blob())
        .catch(() => {});
}

function loadDiceModel() {
  return preloadModel().then((bytes) => new GLTFLoader().parseAsync(bytes, ""));
}

export default function PhoneDiceFlight(props) {
  const host = useRef(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      return;
    }
    const { software } = configureRenderer(renderer, 1.5);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b1113");
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 2.1, 4.3);
    camera.lookAt(0, 0, 1.8);
    let pmrem = null,
      environment = null;
    if (!software) {
      pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = pmrem.fromScene(room, 0.04);
      scene.environment = environment.texture;
      // The broad studio panels otherwise wash dyed resin toward pastel.
      // Keep a reflected highlight while preserving the player's base color.
      scene.environmentIntensity = 0.35;
      room.dispose();
    }
    scene.add(
      new THREE.HemisphereLight(0xfff7e8, 0x243543, software ? 0.9 : 0.65),
    );
    const light = new THREE.DirectionalLight(0xffedce, software ? 2 : 1.6);
    light.position.set(-2, 6, 4);
    scene.add(light);
    const rim = new THREE.DirectionalLight(0x8fdaca, software ? 1 : 0.75);
    rim.position.set(3, 2, -4);
    scene.add(rim);
    const dice = [new THREE.Group(), new THREE.Group()];
    dice.forEach((d) => {
      d.scale.setScalar(DICE_SIZE);
      scene.add(d);
    });
    const materials = new Set(),
      geometries = new Set(),
      textures = new Set();
    let alive = true,
      frame,
      loaded = false,
      appearanceKey = "",
      lastTime = 0,
      viewDistance = 0;
    const tl = new THREE.TextureLoader();
    const normals = [1, 2, 3].map((i) => {
      const t = tl.load(asset(`dice-wear-${i}.png`));
      t.flipY = false;
      textures.add(t);
      return t;
    });
    const roughness = [1, 2, 3].map((i) => {
      const t = tl.load(asset(`dice-roughness-${i}.png`));
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      textures.add(t);
      return t;
    });
    loadDiceModel()
      .then((g) => {
        if (!alive) {
          disposeModel(g.scene);
          return;
        }
        g.scene.traverse((o) => {
          if (o.isMesh) {
            geometries.add(o.geometry);
            materials.add(o.material);
            for (const value of Object.values(o.material))
              if (value?.isTexture) textures.add(value);
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        dice.forEach((d) => d.add(g.scene.clone(true)));
        loaded = true;
      })
      .catch(() => {
        // The TV and the phone result still show the authoritative throw.
      });
    const cache = new Map(),
      focus = new THREE.Vector3(),
      viewDirection = new THREE.Vector3(0.08, 0.85, 1).normalize(),
      corner = new THREE.Vector3();
    const observer = new ResizeObserver(() => {
      renderer.setSize(
        Math.max(1, el.clientWidth),
        Math.max(1, el.clientHeight),
      );
      camera.aspect =
        Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    });
    observer.observe(el);
    function render(time) {
      frame = requestAnimationFrame(render);
      if (time - lastTime < (document.hidden ? 500 : software ? 80 : 0)) return;
      const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 1 / 60;
      lastTime = time;
      const { flight, appearance, clockOffsetMs } = latest.current;
      if (!loaded || document.hidden) return;
      const shooterId = flight.shooterId;
      const key = JSON.stringify([appearance, shooterId]);
      if (loaded && key !== appearanceKey) {
        appearanceKey = key;
        dice.forEach((d, i) =>
          d.traverse((o) => {
            if (!o.isMesh || !o.material.name.includes("DiceBody")) return;
            const k = key + i;
            if (!cache.has(k)) {
              const m = createDiceMaterial(
                appearance,
                normals[diceWearIndex(shooterId, i)],
                roughness[diceWearIndex(shooterId, i)],
                software,
              );
              cache.set(k, m);
              materials.add(m);
            }
            o.material = cache.get(k);
          }),
        );
      }
      const pose = sampleThrow(flight, Date.now() + (clockOffsetMs || 0));
      if (!pose) return;
      pose.dice.forEach((p, i) => {
        dice[i].position.fromArray(p.position);
        dice[i].quaternion.fromArray(p.quaternion);
      });
      focus.copy(dice[0].position).add(dice[1].position).multiplyScalar(0.5);
      // Frame the true positions together. The full cube diagonal bounds every
      // orientation; no fake table, snapping, or independent animation is used.
      const radius =
        Math.max(...dice.map((d) => d.position.distanceTo(focus))) +
        (DICE_SIZE * Math.sqrt(3)) / 2;
      const halfFov = Math.min(
        THREE.MathUtils.degToRad(camera.fov / 2),
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect,
        ),
      );
      const requiredDistance = Math.max(
        0.6,
        (radius / Math.sin(halfFov)) * 1.17,
      );
      // Widen immediately to prevent clipping; ease only the move back inward.
      viewDistance = Math.max(
        requiredDistance,
        viewDistance +
          (requiredDistance - viewDistance) * (1 - Math.exp(-dt * 7)),
      );
      camera.position.copy(focus).addScaledVector(viewDirection, viewDistance);
      camera.lookAt(focus);
      camera.updateMatrixWorld();
      let framed = true;
      for (const die of dice)
        for (const x of [-0.5, 0.5])
          for (const y of [-0.5, 0.5])
            for (const z of [-0.5, 0.5]) {
              corner
                .set(x, y, z)
                .multiplyScalar(DICE_SIZE)
                .applyQuaternion(die.quaternion)
                .add(die.position)
                .project(camera);
              if (
                Math.abs(corner.x) > 0.98 ||
                Math.abs(corner.y) > 0.98 ||
                corner.z < -1 ||
                corner.z > 1
              )
                framed = false;
            }
      el.dataset.framed = String(framed);
      el.dataset.pose = JSON.stringify(pose.dice);
      renderer.render(scene, camera);
      if (!el.dataset.loaded) el.dataset.loaded = "true";
    }
    frame = requestAnimationFrame(render);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      environment?.dispose();
      pmrem?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="dice-flight" aria-hidden="true" />;
}
