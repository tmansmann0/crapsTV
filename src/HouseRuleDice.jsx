import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetURL } from "./asset-url.js";
import { SUSPENSION_BUFFER_MS } from "./house-rule-fling.js";
import { CHANCE_DIE_FRAME_MS } from "./house-rule-suspension.js";
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

export default function HouseRuleDice({
  poses,
  flight,
  clockOffsetMs = 0,
  result,
  promptId,
  motionFeed,
  phone = false,
}) {
  const host = useRef(null);
  const invalidateRef = useRef(null);
  const latest = useRef({ poses, flight, clockOffsetMs, promptId, motionFeed });
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    latest.current = { poses, flight, clockOffsetMs, promptId, motionFeed };
    invalidateRef.current?.();
  }, [poses, flight, clockOffsetMs, promptId, motionFeed]);

  useLayoutEffect(() => {
    if (!motionFeed) return;
    const feed = motionFeed.current;
    feed.wake = () => invalidateRef.current?.();
    return () => {
      feed.wake = null;
    };
  }, [motionFeed]);

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
    const stage = element.closest(".hrc, .chance-phone");
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
    let hitGlass = false;
    const invalidate = () => {
      if (!frame && !disposed && !lost) frame = requestAnimationFrame(render);
    };

    function render() {
      frame = 0;
      if (!model) return;
      const { poses, flight, clockOffsetMs, promptId, motionFeed } =
        latest.current;
      const now = Date.now() + clockOffsetMs;
      const animate = !reduceMotion.matches;
      const elapsed = flight ? now - flight.startAt : 0;
      const waitingToDrop = Boolean(flight && animate && elapsed < 0);
      const moving = Boolean(flight && animate && !waitingToDrop);
      const landed = flight && !animate;
      const samples = motionFeed?.current.samples;
      const newest = samples?.at(-1);
      const sampleAt = phone ? now : now - SUSPENSION_BUFFER_MS;
      let live =
        animate && !moving && newest?.promptId === promptId ? newest : null;
      let before = null;
      if (live && !phone) {
        // Keep a short buffer so a refresh-rate frame can interpolate between
        // actual physics samples, even when packets don't arrive every frame.
        let index = samples.length - 1;
        while (index > 0 && samples[index - 1].at >= sampleAt) index--;
        live = samples[index];
        before = samples[index - 1];
      }
      const blend =
        before && live.at > before.at
          ? THREE.MathUtils.clamp(
              (sampleAt - before.at) / (live.at - before.at),
              0,
              1,
            )
          : 1;

      let stillRolling = false;
      dice.forEach(({ mesh, shadow }, index) => {
        const posesInFlight = moving ? flight.hops[index].frames : null;
        const last = posesInFlight ? posesInFlight.length - 1 : 0;
        const cursor = Math.min(
          Math.max(0, elapsed) / CHANCE_DIE_FRAME_MS,
          last,
        );
        const lower = Math.floor(cursor);
        const pose = moving
          ? posesInFlight[lower]
          : landed
            ? flight.hops[index].frames.at(-1)
            : (live?.poses[index] ??
              flight?.hops[index].frames[0] ??
              poses[index]);
        mesh.position.fromArray(pose);
        mesh.quaternion.fromArray(pose, 3).normalize();
        if (moving && lower < last) {
          const next = posesInFlight[lower + 1];
          const part = cursor - lower;
          mesh.position.lerp(nextPosition.fromArray(next), part);
          mesh.quaternion.slerp(
            nextRotation.fromArray(next, 3).normalize(),
            part,
          );
          stillRolling = true;
        } else if (!moving && before && blend < 1) {
          const previousPose = before.poses[index];
          mesh.position.lerp(nextPosition.fromArray(previousPose), 1 - blend);
          mesh.quaternion.slerp(
            nextRotation.fromArray(previousPose, 3).normalize(),
            1 - blend,
          );
        }

        const aboveFelt = Math.max(0, mesh.position.y - 0.5);
        shadow.position.set(mesh.position.x, 0.005, mesh.position.z);
        shadow.material.opacity = 1 / (1 + 1.6 * aboveFelt);
        shadow.scale.setScalar(1 + 0.3 * aboveFelt);
      });
      const impact =
        moving &&
        flight.hops.some(({ contacts }) =>
          contacts.some(
            ({ ms, surface, speed }) =>
              surface === "glass" &&
              speed >= 4 &&
              elapsed >= ms &&
              elapsed < ms + 165,
          ),
        );
      if (impact !== hitGlass) {
        hitGlass = impact;
        stage?.classList.toggle("is-dice-impact", impact);
      }
      renderer.render(scene, camera);
      if (
        (live && (live !== newest || blend < 1)) ||
        waitingToDrop ||
        stillRolling
      )
        invalidate();
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
