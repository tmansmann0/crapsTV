import { disposeModel } from "./three-resources.js";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { aimDicePose, sampleThrow } from "./throw-motion.js";
import { DICE_SIZE } from "./dice-physics.js";
import "./dice-throw.css";
import {
  DICE_COLORS as colors,
  createDiceMaterial,
  diceWearIndex,
} from "./dice-material.js";
import { assetURL as asset } from "./asset-url.js";

export default function DiceThrow({ state, player, isAdmin, send, connected }) {
  const host = useRef(null),
    latest = useRef(null),
    drag = useRef(null),
    lastAim = useRef(0);
  const [aim, setAim] = useState(null),
    [failed, setFailed] = useState(false);
  const shooter = state.players.find((p) => p.id === state.shooterId);
  const canThrow =
    connected && !state.rolling && (player.id === state.shooterId || isAdmin);
  latest.current = {
    state,
    shooterId: shooter?.id,
    aim,
    appearance: shooter?.dice || { color: "red", finish: "solid" },
  };
  useEffect(() => {
    if (state.rolling || !connected) {
      drag.current = null;
      setAim(null);
    }
  }, [state.rolling, connected]);
  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d332b");
    const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 50);
    camera.position.set(0, 2.1, 4.3);
    camera.lookAt(0, 0, 1.8);
    const pmrem = new THREE.PMREMGenerator(renderer),
      room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    room.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x284c3e, 0.8));
    const light = new THREE.DirectionalLight(0xffedce, 2.4);
    light.position.set(-2, 6, 4);
    light.castShadow = true;
    scene.add(light);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 6),
      new THREE.MeshStandardMaterial({ color: "#123d2e", roughness: 0.96 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(11, 0.74, 0.13),
      new THREE.MeshStandardMaterial({ color: "#142b21", roughness: 0.9 }),
    );
    rail.position.set(0, 0.37, -2.71);
    scene.add(rail);
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
      lastTime = 0;
    const tl = new THREE.TextureLoader();
    const normals = [1, 2, 3].map((i) => {
      const t = tl.load(asset(`dice-wear-${i}.png`));
      t.flipY = false;
      textures.add(t);
      return t;
    });
    const roughness = tl.load(asset("dice-roughness.png"));
    roughness.flipY = false;
    textures.add(roughness);
    new GLTFLoader().load(asset("dice.glb"), (g) => {
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
    });
    const cache = new Map(),
      focus = new THREE.Vector3(),
      target = new THREE.Vector3();
    const observer = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    });
    observer.observe(el);
    function render(time) {
      frame = requestAnimationFrame(render);
      if (time - lastTime < (document.hidden ? 500 : 32)) return;
      lastTime = time;
      const { state: s, aim: localAim, appearance, shooterId } = latest.current;
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
                roughness,
              );
              cache.set(k, m);
              materials.add(m);
            }
            o.material = cache.get(k);
          }),
        );
      }
      const shared =
        s.throw && !localAim && !s.aim?.active
          ? sampleThrow(s.throw, Date.now() + (s.clockOffsetMs || 0))
          : null;
      const pose = localAim
        ? aimDicePose(localAim)
        : s.aim?.active
          ? aimDicePose(s.aim)
          : shared || aimDicePose();
      pose.dice.forEach((p, i) => {
        dice[i].position.fromArray(p.position);
        dice[i].quaternion.fromArray(p.quaternion);
      });
      focus.copy(dice[0].position).add(dice[1].position).multiplyScalar(0.5);
      if (localAim || s.aim?.active) focus.set(0, 0.2, 1.85);
      // Follow the exact shared positions, framed closely enough for a phone.
      const radius =
        Math.max(...dice.map((d) => d.position.distanceTo(focus))) + 0.25;
      const halfFov = Math.min(
        THREE.MathUtils.degToRad(camera.fov / 2),
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect,
        ),
      );
      const distance = Math.max(2.2, (radius / Math.sin(halfFov)) * 1.12);
      target
        .set(0.08, 0.57, 0.82)
        .normalize()
        .multiplyScalar(distance)
        .add(focus);
      camera.position.lerp(target, 0.18);
      if (camera.position.distanceTo(focus) < distance)
        camera.position.sub(focus).setLength(distance).add(focus);
      camera.lookAt(focus);
      el.dataset.throwId = s.throw?.id || "";
      el.dataset.pose = JSON.stringify(pose.dice);
      el.dataset.loaded = String(loaded);
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(render);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      rail.geometry.dispose();
      rail.material.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  function updateAim(e) {
    if (!drag.current || e.pointerId !== drag.current.pointerId) return null;
    const dx = e.clientX - drag.current.x,
      dy = drag.current.y - e.clientY;
    const next = {
      x: Math.max(-1, Math.min(1, dx / 110)),
      power: Math.max(0, Math.min(1, dy / 130)),
    };
    setAim(next);
    if (performance.now() - lastAim.current > 110) {
      send({ type: "aim", aim: { ...next, active: true } });
      lastAim.current = performance.now();
    }
    return { next, dy };
  }
  function release(e, cancel = false) {
    if (!drag.current || e.pointerId !== drag.current.pointerId) return;
    const result = updateAim(e);
    drag.current = null;
    setAim(null);
    if (!cancel && result.dy > 20 && canThrow)
      send({ type: "roll", gesture: result.next });
    else send({ type: "aim", aim: { active: false } });
  }
  const pendingChoice = useRef(shooter?.dice),
    waitingChoice = useRef(null);
  useEffect(() => {
    const incoming = shooter?.dice,
      waiting = waitingChoice.current;
    if (
      !waiting ||
      state.rolling ||
      !incoming ||
      (incoming.color === waiting.color && incoming.finish === waiting.finish)
    ) {
      pendingChoice.current = incoming;
      waitingChoice.current = null;
    }
  }, [shooter?.dice, shooter?.id, state.rolling]);
  function choose(patch) {
    const appearance = {
      ...(pendingChoice.current || { color: "red", finish: "solid" }),
      ...patch,
    };
    pendingChoice.current = appearance;
    waitingChoice.current = appearance;
    send({ type: "dice", appearance });
  }
  return (
    <section className="dice-throw" aria-label="Dice throw">
      <div className="dice-throw-top">
        <strong>
          {state.rolling
            ? "Dice are out"
            : canThrow
              ? "Your throw"
              : `${shooter?.name || "Shooter"} has the dice`}
        </strong>
        <span>{aim ? `${Math.round(aim.power * 100)}%` : "LIVE WITH TV"}</span>
      </div>
      <div
        ref={host}
        className="dice-throw-view"
        data-testid="phone-dice"
        role="application"
        aria-label="Swipe dice upward to throw"
        onPointerDown={(e) => {
          if (!canThrow || drag.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
          setAim({ x: 0, power: 0 });
          lastAim.current = performance.now();
          send({ type: "aim", aim: { x: 0, power: 0, active: true } });
        }}
        onPointerMove={updateAim}
        onPointerUp={(e) => release(e)}
        onPointerCancel={(e) => release(e, true)}
      >
        {failed && <span>3D unavailable. Use Roll below.</span>}
        {!state.rolling && canThrow && (
          <div className="dice-swipe-hint">↑ Swipe up to throw</div>
        )}
        {aim && (
          <div className="dice-power">
            <i style={{ width: `${aim.power * 100}%` }} />
          </div>
        )}
      </div>
      <div className="dice-throw-bottom">
        {player.id === state.shooterId && (
          <div className="dice-appearance" aria-label="Dice appearance">
            {Object.keys(colors).map((color) => (
              <button
                key={color}
                aria-label={`${color} dice`}
                aria-pressed={shooter?.dice?.color === color}
                disabled={!canThrow}
                style={{ "--die": colors[color] }}
                onClick={() => choose({ color })}
              />
            ))}
            <button
              className="dice-glass"
              aria-label="Solid dice"
              aria-pressed={shooter?.dice?.finish !== "translucent"}
              disabled={!canThrow}
              onClick={() => choose({ finish: "solid" })}
            >
              Solid
            </button>
            <button
              className="dice-glass"
              aria-label="Translucent dice"
              aria-pressed={shooter?.dice?.finish === "translucent"}
              disabled={!canThrow}
              onClick={() => choose({ finish: "translucent" })}
            >
              Glass
            </button>
          </div>
        )}
        {canThrow && (
          <button
            className="dice-roll-button"
            onClick={() => send({ type: "roll" })}
          >
            Roll the dice
          </button>
        )}
        {state.rolling && (
          <button className="dice-roll-button" disabled>
            Dice are rolling…
          </button>
        )}
      </div>
    </section>
  );
}
