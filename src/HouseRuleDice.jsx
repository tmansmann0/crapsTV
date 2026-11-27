import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetURL } from "./asset-url.js";
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

export default function HouseRuleDice({
  poses,
  flight,
  clockOffsetMs = 0,
  firstDie,
  secondDie,
  controller,
}) {
  const host = useRef(null);
  const invalidateRef = useRef(null);
  const latest = useRef({ poses, flight, clockOffsetMs, controller });
  const phone = Boolean(controller);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    latest.current = { poses, flight, clockOffsetMs, controller };
    invalidateRef.current?.();
  }, [poses, flight, clockOffsetMs, controller]);

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
    const previewPosition = new THREE.Vector3();
    const previewRotation = new THREE.Quaternion();
    const invalidate = () => {
      if (!frame && !disposed && !lost) frame = requestAnimationFrame(render);
    };
    function render() {
      frame = 0;
      if (!model) return;
      const { poses, flight, clockOffsetMs, controller } = latest.current;
      const animate = !reduceMotion.matches;
      const active = flight && animate;
      const last = active ? flight.frames.length - 1 : 0;
      const elapsed = active ? Date.now() + clockOffsetMs - flight.startAt : 0;
      const cursor = Math.max(0, Math.min(elapsed / CHANCE_DIE_FRAME_MS, last));
      const lower = Math.floor(cursor);
      dice.forEach(({ mesh, shadow }, index) => {
        mesh.visible = !controller?.die || controller.die === index + 1;
        shadow.visible = mesh.visible;
        if (!mesh.visible) return;
        const moving = active && flight.die === index + 1;
        const pose = moving ? flight.frames[lower] : poses[index];
        mesh.position.fromArray(pose);
        mesh.quaternion.fromArray(pose, 3).normalize();
        if (moving && lower < last) {
          const next = flight.frames[lower + 1];
          const part = cursor - lower;
          mesh.position.lerp(nextPosition.fromArray(next), part);
          mesh.quaternion.slerp(
            nextRotation.fromArray(next, 3).normalize(),
            part,
          );
        }
        if (controller?.die) {
          const base = poses[index];
          mesh.position.x -= base[0];
          const touch = controller.gesture.current;
          if (animate && touch?.die === controller.die && touch.travel) {
            const mix = active ? Math.max(0, Math.min(elapsed / 170, 1)) : 0;
            if (mix < 1) {
              previewRotation
                .fromArray(base, 3)
                .normalize()
                .premultiply(touch.rotation);
              const { x, y, z, w } = previewRotation;
              const height =
                (Math.abs(2 * (x * y + z * w)) +
                  Math.abs(1 - 2 * (x * x + z * z)) +
                  Math.abs(2 * (y * z - x * w))) /
                2;
              previewPosition.set(touch.x, height + 0.045, base[2] + touch.z);
              mesh.position.lerp(previewPosition, 1 - mix);
              mesh.quaternion.slerp(previewRotation, 1 - mix);
            }
          }
        }
        shadow.position.set(mesh.position.x, 0.005, mesh.position.z);
      });
      renderer.render(scene, camera);
      if ((active && cursor < last) || (animate && controller?.dragging))
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
          {[firstDie, secondDie].map((value, index) =>
            !controller?.die || controller.die === index + 1 ? (
              <span key={index}>{value ?? "–"}</span>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
