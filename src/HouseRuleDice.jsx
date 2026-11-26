import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetURL } from "./asset-url.js";
import { createChanceDieMotion } from "./house-rule-dice-motion.js";
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
  phase,
  firstDie,
  secondDie,
  lateReveal,
}) {
  const host = useRef(null);
  const update = useRef(null);
  const latest = useRef({ phase, firstDie, secondDie });
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    latest.current = { phase, firstDie, secondDie };
    update.current?.();
  }, [phase, firstDie, secondDie]);

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
    camera.lookAt(0, 0.48, 0.03);
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
    const dice = [0, 1].map((index) => {
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
        motion: createChanceDieMotion(index),
        materials: [],
      };
    });
    let model;
    let disposed = false;
    let lost = false;
    let frame = 0;
    let previousTime = null;

    const invalidate = () => {
      if (!frame && !disposed && !lost) frame = requestAnimationFrame(render);
    };
    function render(now) {
      frame = 0;
      const seconds = previousTime === null ? 0 : (now - previousTime) / 1000;
      let moving = false;
      for (const { mesh, shadow, motion } of dice) {
        moving = motion.advance(seconds) || moving;
        mesh.position.copy(motion.position);
        mesh.quaternion.copy(motion.orientation);
        shadow.position.set(mesh.position.x, 0.005, mesh.position.z);
      }
      if (model) renderer.render(scene, camera);
      previousTime = moving ? now : null;
      if (moving) invalidate();
    }
    function sync() {
      if (!model || lost) return;
      const { phase, firstDie, secondDie } = latest.current;
      dice[0].motion.sync({
        rolling: phase === "entering" || phase === "first-rolling",
        value: firstDie,
        enter: !lateReveal,
        reduceMotion: reduceMotion.matches,
      });
      dice[1].motion.sync({
        rolling: phase === "second-rolling",
        value: secondDie,
        reduceMotion: reduceMotion.matches,
      });
      invalidate();
    }
    update.current = sync;

    function resize() {
      const { clientWidth: width, clientHeight: height } = element;
      if (!width || !height || lost) return;
      const halfHeight = 1.24;
      const halfWidth = halfHeight * (width / height);
      camera.left = -halfWidth;
      camera.right = halfWidth;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
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
        sync();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      update.current = null;
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
  }, [lateReveal]);

  return (
    <div className="hrc-dice" ref={host}>
      {failed && (
        <div className="hrc-dice-fallback">
          {[firstDie, secondDie].map((value, index) => (
            <span key={index}>{value ?? "–"}</span>
          ))}
        </div>
      )}
    </div>
  );
}
