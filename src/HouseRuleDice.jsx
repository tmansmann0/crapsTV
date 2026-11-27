import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetURL } from "./asset-url.js";
import {
  FLING_IMPACT_MS,
  FLING_REBOUND_MS,
  ORBIT_TIMEOUT_MS,
  orbitSpeed,
} from "./house-rule-fling.js";
import { CHANCE_DIE_FRAME_MS } from "./house-rule-dice-motion.js";
import { configureRenderer } from "./render-quality.js";
import { disposeModel } from "./three-resources.js";

function contactShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ink = canvas.getContext("2d");
  const gradient = ink.createRadialGradient(32, 32, 9, 32, 32, 32);
  gradient.addColorStop(0, "#000c");
  gradient.addColorStop(0.55, "#0007");
  gradient.addColorStop(1, "#0000");
  ink.fillStyle = gradient;
  ink.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function createVortex(color) {
  const geometry = new THREE.PlaneGeometry(3.4, 3.4);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ink: { value: new THREE.Color(color) }, turn: { value: 0 } },
    vertexShader: `
      varying vec2 point;
      void main() {
        point = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 ink;
      uniform float turn;
      varying vec2 point;
      void main() {
        float radius = length(point);
        float phi = atan(point.y, point.x);
        float envelope = 1.0 - smoothstep(0.72, 0.99, radius);
        float hole = smoothstep(0.18, 0.24, radius);
        float twist = phi * 3.0 + 13.0 * radius - turn * 3.0;
        float arms = pow(max(0.0, cos(twist)), 3.0);
        float distanceFromRidge = (radius - 0.30) * 12.0;
        float ridge = exp(-distanceFromRidge * distanceFromRidge);
        float glow = (arms * 0.58 + ridge * 0.42) * hole;
        gl_FragColor = vec4(ink * glow, envelope * (glow + 0.92 * (1.0 - hole)));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export default function HouseRuleDice({
  poses,
  flight,
  clockOffsetMs = 0,
  result,
  promptId,
  orbitFeed,
  phone = false,
}) {
  const host = useRef(null);
  const invalidateRef = useRef(null);
  const latest = useRef({ poses, flight, clockOffsetMs, promptId, orbitFeed });
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    latest.current = { poses, flight, clockOffsetMs, promptId, orbitFeed };
    invalidateRef.current?.();
  }, [poses, flight, clockOffsetMs, promptId, orbitFeed]);

  useLayoutEffect(() => {
    if (!orbitFeed) return;
    const feed = orbitFeed.current;
    feed.wake = () => invalidateRef.current?.();
    return () => {
      feed.wake = null;
    };
  }, [orbitFeed]);

  useEffect(() => {
    const element = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }

    configureRenderer(renderer, 1.5);
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.17;
    element.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 30);
    camera.position.set(0, 6.8, 4.2);
    if (phone) camera.lookAt(0, 0.57, 0.14);
    else camera.lookAt(0, 0.48, 0.03);
    camera.updateMatrixWorld();
    scene.add(new THREE.HemisphereLight(0xfff5df, 0x5d746e, 1.8));
    const key = new THREE.DirectionalLight(0xfff3e2, 2.5);
    key.position.set(-3, 5, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe8fff6, 1.6);
    rim.position.set(2, 4, -4);
    scene.add(rim);

    const css = getComputedStyle(element);
    const colors = ["#f3e2bd", css.getPropertyValue("--dice-resin").trim()];
    const pips = ["#16382c", css.getPropertyValue("--dice-pips").trim()];
    const vortex = createVortex(css.getPropertyValue("--a").trim());
    const stage = element.closest(".hrc, .chance-phone");
    scene.add(vortex);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shadowTexture = contactShadowTexture();
    const shadowGeometry = new THREE.PlaneGeometry(1.72, 1.72);
    const dice = [0, 1].map(() => {
      const mesh = new THREE.Group();
      const shadow = new THREE.Mesh(
        shadowGeometry,
        new THREE.MeshBasicMaterial({
          map: shadowTexture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow, mesh);
      return {
        mesh,
        shadow,
        materials: [],
      };
    });
    let model;
    let disposed = false;
    let lost = false;
    let frame = 0;
    const nextPosition = new THREE.Vector3();
    const nextRotation = new THREE.Quaternion();
    const windPosition = new THREE.Vector3();
    const windRotation = new THREE.Quaternion();
    const launchPosition = new THREE.Vector3();
    const launchRotation = new THREE.Quaternion();
    const rollAxis = new THREE.Vector3();
    const easedAnchor = new THREE.Vector2();
    const pivot = new THREE.Vector2();
    let lastFrameAt = null;
    let orbitWasLive = false;
    let hitGlass = false;
    const invalidate = () => {
      if (!frame && !disposed && !lost) frame = requestAnimationFrame(render);
    };

    function orbitPose(index, orbit, angle) {
      const theta = angle + index * Math.PI;
      const radius = 0.96 + 0.19 * orbit.energy;
      windPosition.set(
        pivot.x + Math.cos(theta) * radius,
        0.78 + 0.17 * Math.sin(theta * 2 + 0.55),
        pivot.y + Math.sin(theta) * radius * 0.86,
      );
      rollAxis.set(Math.cos(theta), 0.35, Math.sin(theta)).normalize();
      windRotation.setFromAxisAngle(rollAxis, theta * 1.8);
    }

    function render(time) {
      frame = 0;
      if (!model) return;
      const { poses, flight, clockOffsetMs, promptId, orbitFeed } =
        latest.current;
      const now = Date.now() + clockOffsetMs;
      const animate = !reduceMotion.matches;
      const moving = Boolean(flight && animate);
      const elapsed = moving ? now - flight.startAt : 0;
      const flightTime = Math.max(0, elapsed - FLING_REBOUND_MS);
      const fling = moving && elapsed < FLING_REBOUND_MS;
      const sample = orbitFeed?.current.sample;
      const orbitLive =
        animate &&
        sample?.promptId === promptId &&
        sample?.orbit &&
        now - sample.at <= ORBIT_TIMEOUT_MS;
      const dt = lastFrameAt === null ? 16.7 : Math.min(time - lastFrameAt, 42);
      lastFrameAt = time;
      if (orbitLive) {
        if (!orbitWasLive) easedAnchor.set(sample.orbit.x, sample.orbit.y);
        const follow = 1 - Math.exp(-dt / 22);
        easedAnchor.x += (sample.orbit.x - easedAnchor.x) * follow;
        easedAnchor.y += (sample.orbit.y - easedAnchor.y) * follow;
      }
      orbitWasLive = Boolean(orbitLive);

      const orbit = fling
        ? flight.orbit
        : orbitLive && {
            ...sample.orbit,
            x: easedAnchor.x,
            y: easedAnchor.y,
          };
      const angle = orbit
        ? orbit.turn +
          (fling ? 0 : Math.max(0, now - sample.at) * orbitSpeed(orbit.energy))
        : 0;
      vortex.visible = Boolean(orbit && !fling);
      if (orbit) {
        // Project the pointer onto the felt instead of offsetting the swirl
        // from the touch. Keep the TV's pivot within its title and score panel.
        const vertical =
          (camera.top + camera.bottom) / 2 -
          ((orbit.y * (camera.top - camera.bottom)) / 2) * (phone ? 1 : 0.43);
        const [, , , , , upY, upZ] = camera.matrixWorld.elements;
        pivot.set(
          orbit.x * camera.right * (phone ? 1 : 0.63),
          camera.position.z +
            (vertical - upY * (0.12 - camera.position.y)) / upZ,
        );
        vortex.position.set(pivot.x, 0.12, pivot.y);
        vortex.material.uniforms.turn.value = angle;
      }

      let stillRolling = false;
      dice.forEach(({ mesh, shadow }, index) => {
        const posesInFlight = moving ? flight.hops[index].frames : null;
        const last = posesInFlight ? posesInFlight.length - 1 : 0;
        const cursor = Math.min(flightTime / CHANCE_DIE_FRAME_MS, last);
        const lower = Math.floor(cursor);
        const pose = moving ? posesInFlight[lower] : poses[index];
        mesh.position.fromArray(pose);
        mesh.quaternion.fromArray(pose, 3).normalize();
        mesh.scale.setScalar(1);
        if (moving && lower < last) {
          const next = posesInFlight[lower + 1];
          const part = cursor - lower;
          mesh.position.lerp(nextPosition.fromArray(next), part);
          mesh.quaternion.slerp(
            nextRotation.fromArray(next, 3).normalize(),
            part,
          );
          stillRolling = true;
        }
        if (orbit) {
          const base = mesh.quaternion;
          orbitPose(index, orbit, angle);
          windRotation.multiply(base);
          if (fling) {
            const side = index === 0 ? -1 : 1;
            const approach = Math.max(
              0,
              Math.min(elapsed / FLING_IMPACT_MS, 1),
            );
            const recoil = Math.max(
              0,
              (elapsed - FLING_IMPACT_MS) /
                (FLING_REBOUND_MS - FLING_IMPACT_MS),
            );
            const towardsGlass = approach ** 2.6;
            const rebound = 1 - (1 - recoil) ** 2;
            launchPosition.set(
              side * 1.64 + orbit.x * 0.15,
              1.42,
              0.86 + orbit.y * 0.15,
            );
            const spread = 1 - (1 - approach) ** 2;
            const glassX = THREE.MathUtils.lerp(
              windPosition.x,
              launchPosition.x,
              spread,
            );
            windPosition.lerp(launchPosition, towardsGlass);
            windPosition.x = glassX;
            windPosition.lerp(mesh.position, rebound);
            launchRotation.setFromAxisAngle(
              rollAxis,
              side * (0.7 + flight.flick),
            );
            windRotation.premultiply(
              launchRotation.slerp(nextRotation.identity(), 1 - towardsGlass),
            );
            windRotation.slerp(base, rebound);
            mesh.scale.setScalar(
              1 + (1.05 + flight.flick * 0.65) * towardsGlass * (1 - rebound),
            );
          }
          mesh.position.copy(windPosition);
          mesh.quaternion.copy(windRotation);
        }
        shadow.position.set(mesh.position.x, 0.005, mesh.position.z);
      });
      const impact =
        moving && elapsed >= FLING_IMPACT_MS && elapsed < FLING_IMPACT_MS + 165;
      if (impact !== hitGlass) {
        hitGlass = impact;
        stage?.classList.toggle("is-dice-impact", impact);
      }
      renderer.render(scene, camera);
      if (orbitLive || fling || stillRolling) invalidate();
      else lastFrameAt = null;
    }
    invalidateRef.current = invalidate;

    function resize() {
      const { clientWidth: width, clientHeight: height } = element;
      if (!width || !height || lost) return;
      // Keep the dice's resting positions and give the hop overhead clearance.
      const floor = phone ? -2.32 * (height / width) : -1.24;
      const ceiling = phone ? -floor : 1.24 + 2.48 * (7 / 42);
      const halfWidth = phone
        ? 2.32
        : ((ceiling - floor) / 2) * (width / height);
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = ceiling;
      camera.bottom = floor;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      invalidate();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    const onContextLost = () => {
      lost = true;
      cancelAnimationFrame(frame);
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    new GLTFLoader()
      .loadAsync(assetURL("dice.glb"))
      .then(({ scene: source }) => {
        if (disposed || lost) {
          disposeModel(source);
          return;
        }
        model = source;
        dice.forEach(({ mesh, materials }, index) => {
          const die = model.clone(true);
          die.traverse((part) => {
            if (!part.isMesh) return;
            const material = part.material.clone();
            material.color.set(
              material.name === "DiceBody" ? colors[index] : pips[index],
            );
            part.material = material;
            materials.push(material);
          });
          mesh.add(die);
        });
        invalidate();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      invalidateRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (model) disposeModel(model);
      shadowTexture.dispose();
      shadowGeometry.dispose();
      vortex.geometry.dispose();
      vortex.material.dispose();
      stage?.classList.remove("is-dice-impact");
      for (const { shadow, materials } of dice) {
        shadow.material.dispose();
        materials.forEach((material) => material.dispose());
      }
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [phone]);

  return (
    <div className="hrc-dice" ref={host}>
      {failed && (
        <div className="hrc-dice-fallback">
          {[0, 1].map((index) => (
            <span key={index}>{result?.[index] ?? "–"}</span>
          ))}
        </div>
      )}
    </div>
  );
}
