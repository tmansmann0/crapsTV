import { useBettingWindow } from "./use-betting-window.js";
import { configureRenderer } from "./render-quality.js";
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
    lastAim = useRef(0),
    observedThrow = useRef(state.rolling ? state.throw?.id : null);
  const [aim, setAim] = useState(null),
    [failed, setFailed] = useState(false);
  const shooter = state.players.find((p) => p.id === state.shooterId);
  if (state.rolling && state.throw?.id) observedThrow.current = state.throw.id;
  const justLanded =
    !!observedThrow.current &&
    !state.rolling &&
    state.lastRoll?.throwId === observedThrow.current;
  const remaining = useBettingWindow(state);
  const canCustomize =
    connected && !state.rolling && player.id === state.shooterId;
  const canThrow =
    connected &&
    !state.rolling &&
    !justLanded &&
    remaining === 0 &&
    (player.id === state.shooterId || isAdmin);
  latest.current = { state, aim, activeThrowId: observedThrow.current };
  useEffect(() => {
    if (state.rolling || !connected || remaining > 0) {
      drag.current = null;
      setAim(null);
    }
  }, [state.rolling, connected, remaining]);
  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setFailed(true);
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
    const roughness = tl.load(asset("dice-roughness.png"));
    roughness.flipY = false;
    textures.add(roughness);
    new GLTFLoader().load(
      asset("dice.glb"),
      (g) => {
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
      },
      undefined,
      () => {
        if (alive) setFailed(true);
      },
    );
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
      const { state: s, aim: localAim, activeThrowId } = latest.current;
      // A freshly opened Roll tab is a ready close-up, not a replay of the
      // previous roll. Once observed, a throw keeps its final pose until unmount.
      const showingShared =
        !!s.throw &&
        (s.rolling || s.throw.id === activeThrowId) &&
        !localAim &&
        !s.aim?.active;
      const shooterId = showingShared ? s.throw.shooterId : s.shooterId;
      const appearance = s.players.find((p) => p.id === shooterId)?.dice || {
        color: "red",
        finish: "solid",
      };
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
                software,
              );
              cache.set(k, m);
              materials.add(m);
            }
            o.material = cache.get(k);
          }),
        );
      }
      const shared = showingShared
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
      el.dataset.view = showingShared
        ? s.rolling
          ? "rolling"
          : "landed"
        : "ready";
      el.dataset.throwId = s.throw?.id || "";
      el.dataset.pose = JSON.stringify(pose.dice);
      el.dataset.loaded = String(loaded);
      if (!document.hidden) renderer.render(scene, camera);
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
            : justLanded
              ? "Dice landed"
              : canThrow
                ? "Your throw"
                : `${shooter?.name || "Shooter"} has the dice`}
        </strong>
        <span>
          {aim
            ? `${Math.round(aim.power * 100)}% POWER`
            : state.rolling
              ? "LIVE WITH TV"
              : justLanded
                ? "RETURNING TO PLAY"
                : remaining > 0
                  ? `BETTING OPEN · ${remaining}s`
                  : "DICE CLOSE-UP"}
        </span>
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
                disabled={!canCustomize}
                style={{ "--die": colors[color] }}
                onClick={() => choose({ color })}
              />
            ))}
            <button
              className="dice-glass"
              aria-label="Solid dice"
              aria-pressed={shooter?.dice?.finish !== "translucent"}
              disabled={!canCustomize}
              onClick={() => choose({ finish: "solid" })}
            >
              Solid
            </button>
            <button
              className="dice-glass"
              aria-label="Translucent dice"
              aria-pressed={shooter?.dice?.finish === "translucent"}
              disabled={!canCustomize}
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
        {!state.rolling &&
          !justLanded &&
          remaining > 0 &&
          (player.id === state.shooterId || isAdmin) && (
            <button className="dice-roll-button" disabled>
              Betting open · {remaining}s
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
