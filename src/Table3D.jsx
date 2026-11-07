import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
const asset = (name) => `${import.meta.env.BASE_URL}assets/${name}`;
const rotations = {
  1: [0, 0, 0],
  6: [Math.PI, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  5: [Math.PI / 2, 0, 0],
  3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2],
};
// Coordinates are matched to the editable 2048 × 1024 SVG felt layouts.
function chipLocation(bet, mode) {
  const points =
    mode === "crapless"
      ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
      : [4, 5, 6, 8, 9, 10];
  const [kind, number] = bet.type.split("-");
  let x = 1024,
    y = 900;
  if (kind === "place" || bet.point) {
    const point = bet.point || Number(number);
    x = 136 + ((points.indexOf(point) + 0.5) * 1776) / points.length;
    y = kind === "place" ? 290 : bet.type === "odds" ? 382 : 345;
  } else if (bet.type === "dont") {
    y = 840;
  } else if (bet.type === "come") {
    y = 470;
  } else if (bet.type === "dontcome") {
    x = 285;
    y = 465;
  } else if (bet.type === "field") {
    y = 720;
  } else if (kind === "hard") {
    const idx = [4, 6, 8, 10].indexOf(Number(number));
    if (mode === "classic") {
      x = idx % 2 ? 370 : 210;
      y = idx < 2 ? 640 : 735;
    } else {
      x = 1740;
      y = 520 + idx * 67;
    }
  } else if (kind === "prop" || bet.type === "craps") {
    const row =
      bet.type === "craps"
        ? 1
        : Number(number) === 7
          ? 0
          : [2, 12].includes(Number(number))
            ? 2
            : 3;
    x = mode === "classic" ? 1750 : 1940;
    y = 520 + row * 67;
  } else if (kind === "big") {
    x = Number(number) === 6 ? 720 : 1320;
    y = 785;
  }
  return [(x / 2048 - 0.5) * 10.84, (y / 1024 - 0.5) * 5.4];
}
export default function Table3D({ state, preview = false }) {
  const host = useRef(),
    data = useRef({}),
    props = useRef({ state, preview });
  props.current = { state, preview };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    const el = host.current,
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#1c1814");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    el.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    camera.position.set(0, 10.8, 11.5);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffecd7, 0x17342e, 1.3));
    const light = new THREE.DirectionalLight(0xffe1af, 2.5);
    light.position.set(-4, 9, 3);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -9,
      right: 9,
      top: 9,
      bottom: -9,
      near: 1,
      far: 30,
    });
    light.shadow.bias = -0.0003;
    scene.add(light);
    const fill = new THREE.PointLight(0xa4f8d4, 25);
    fill.position.set(4, 3, -3);
    scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(17, 11),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.1;
    floor.receiveShadow = true;
    scene.add(floor);
    const loader = new GLTFLoader();
    let alive = true;
    const tracked = [];
    const track = (object) => {
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      tracked.push(object);
      return object;
    };
    loader.load(asset("table.glb"), (g) => {
      if (alive) scene.add(track(g.scene));
    });
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10.84, 5.4),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        transparent: false,
      }),
    );
    board.rotation.x = -Math.PI / 2;
    board.position.y = 0.012;
    board.receiveShadow = true;
    scene.add(board);
    data.current.board = board;
    const texLoader = new THREE.TextureLoader(),
      textures = {};
    texLoader.load(asset("casino-panorama.png"), (t) => {
      if (!alive) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      t.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = t;
      scene.backgroundBlurriness = 0.03;
      scene.backgroundIntensity = 0.65;
      scene.backgroundRotation.set(-Math.PI / 4, 0.5, 0);
      data.current.panorama = t;
    });
    for (const mode of ["classic", "crapless"])
      texLoader.load(asset(`board-${mode}.png`), (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        textures[mode] = t;
      });
    new HDRLoader().load(asset("casino-studio.hdr"), (t) => {
      if (!alive) {
        t.dispose();
        return;
      }
      t.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = t;
      scene.environmentIntensity = 0.4;
      data.current.env = t;
    });
    const dice = [new THREE.Group(), new THREE.Group()];
    dice.forEach((d, i) => {
      d.position.set(i ? 1.05 : -0.25, 0.47, 0.5);
      d.scale.setScalar(0.7);
      scene.add(d);
    });
    loader.load(asset("dice.glb"), (g) => {
      if (!alive) return;
      dice.forEach((d) => d.add(track(g.scene.clone(true))));
    });
    // Chip stacks make each seat's action visible on the shared table.
    const chips = new THREE.Group();
    scene.add(chips);
    let chipKey = "";
    let prevRoll = null;
    let settlingUntil = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let clock = 0;
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.12, 40),
      new THREE.MeshStandardMaterial({
        color: 0xf5e5c5,
        metalness: 0.1,
        roughness: 0.35,
      }),
    );
    puck.position.set(-4, 0.1, -2);
    scene.add(puck);
    function resize() {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.set(0, preview ? 8.6 : 8.8, preview ? 9.4 : 9.2);
      if (w / h < 1.2) camera.position.multiplyScalar(1.25);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let frame,
      lastTime = 0;
    function animate(time) {
      const s = props.current.state;
      if (s?.lastRoll?.id !== prevRoll) {
        prevRoll = s?.lastRoll?.id;
        settlingUntil = time + 1000;
      }
      // An idle felt is static: save GPU work between updates and honor reduced motion.
      const moving =
        !reducedMotion.matches && (s?.rolling || time < settlingUntil);
      const frameInterval = document.hidden ? 1000 : moving ? 33 : 250;
      if (time - lastTime < frameInterval) {
        frame = requestAnimationFrame(animate);
        return;
      }
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      clock += dt;
      const mode = s?.config.mode === "crapless" ? "crapless" : "classic";
      if (textures[mode] && board.material.map !== textures[mode]) {
        board.material.map = textures[mode];
        board.material.needsUpdate = true;
      }
      const key = (s?.players || [])
        .map(
          (p) =>
            `${mode}:${p.id}:${p.bets.map((b) => `${b.id}/${b.type}/${b.point}/${b.amount}`).join(",")}`,
        )
        .join("|");
      if (key !== chipKey) {
        chipKey = key;
        while (chips.children.length) {
          const o = chips.children[0];
          o.geometry.dispose();
          o.material.dispose();
          chips.remove(o);
        }
        s?.players
          .filter((p) => !p.left)
          .forEach((p, i) => {
            for (const bet of p.bets) {
              const [x, z] = chipLocation(bet, mode);
              const count = Math.min(
                4,
                Math.max(1, Math.ceil(bet.amount / 2500)),
              );
              for (let j = 0; j < count; j++) {
                const chip = new THREE.Mesh(
                  new THREE.CylinderGeometry(0.115, 0.115, 0.045, 24),
                  new THREE.MeshStandardMaterial({
                    color: p.color,
                    roughness: 0.6,
                  }),
                );
                chip.position.set(
                  x + ((i % 4) - 1.5) * 0.19,
                  0.04 + j * 0.047,
                  z + Math.floor(i / 4) * 0.17,
                );
                chip.castShadow = true;
                chips.add(chip);
              }
            }
          });
      }
      const values = s?.lastRoll?.dice || [3, 4];
      dice.forEach((d, i) => {
        if (s?.rolling && !reducedMotion.matches) {
          d.position.y = 0.8 + Math.abs(Math.sin(clock * 9 + i)) * 1.2;
          d.position.x = (i ? 1.1 : -0.5) + Math.sin(clock * 5 + i) * 0.6;
          d.position.z = 0.3 + Math.cos(clock * 7 + i) * 0.5;
          d.rotation.x += dt * (7 + i);
          d.rotation.z += dt * (9 - i);
          d.rotation.y += dt * 4;
        } else {
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...rotations[values[i]]),
          );
          q.premultiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              i ? 0.45 : -0.25,
            ),
          );
          d.quaternion.slerp(
            q,
            reducedMotion.matches ? 1 : Math.min(1, dt * 12),
          );
          d.position.lerp(
            new THREE.Vector3(i ? 0.85 : -0.35, 0.37, 0.4),
            Math.min(1, dt * 9),
          );
        }
      });
      puck.material.color.set(s?.point ? 0xf5e5c5 : 0x242424);
      puck.position.x = s?.point
        ? Math.max(-4.4, Math.min(4.3, (s.point - 7) * 0.75))
        : -4.4;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
        }
      });
      Object.values(textures).forEach((t) => t.dispose());
      data.current.env?.dispose();
      data.current.panorama?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="table-canvas"
      ref={host}
      role="img"
      aria-label="Three dimensional craps table with dice, felt layout and player chips"
    >
      {failed && (
        <div className="webgl-fallback">
          <img
            src={asset(
              `board-${state?.config.mode === "crapless" ? "crapless" : "classic"}.svg`,
            )}
            alt="Craps table layout"
          />
          <p>
            3D unavailable on this device. Your phone controls and game still
            work.
          </p>
        </div>
      )}
    </div>
  );
}
