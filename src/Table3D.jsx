import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createSceneUI } from "./scene-ui.js";
import { createTablePieces } from "./table-pieces.js";
import { createDicePhysics, DICE_SIZE } from "./dice-physics.js";
const asset = (name) => new URL(`assets/${name}`, document.baseURI).href;
const rotations = {
  1: [0, 0, 0],
  6: [Math.PI, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  5: [Math.PI / 2, 0, 0],
  3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2],
};
export default function Table3D(props) {
  const host = useRef(),
    latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    const el = host.current;
    let alive = true,
      frame,
      readyEnvironment = null,
      cameraMode = "auto",
      userUntil = 0,
      dragStart = null,
      environmentShell = null,
      environmentTarget = null,
      displayRevision = -1,
      physicsRollActive = false,
      previousRolling = false,
      physicalSettleUntil = 0;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.autoClear = false;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#09100e");
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 160);
    camera.position.set(9, 5.3, 15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 26;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = 1.43;
    controls.rotateSpeed = 0.42;
    controls.addEventListener("start", () => {
      userUntil = performance.now() + 15000;
    });
    scene.add(new THREE.HemisphereLight(0xc6d9ce, 0x18251e, 0.38));
    const key = new THREE.DirectionalLight(0xffe5c6, 2.5);
    key.position.set(-4, 10, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -9,
      right: 9,
      top: 7,
      bottom: -7,
      near: 1,
      far: 30,
    });
    key.shadow.bias = -0.0002;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xf3d4a3, 1.1);
    rim.position.set(7, 4, -7);
    scene.add(rim);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -2.15;
    shadow.receiveShadow = true;
    scene.add(shadow);
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    function setEnvironment(texture, name) {
      if (!alive) {
        texture.dispose();
        return;
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      // A finite inward-facing shell lets dolly/zoom change the room's scale.
      environmentShell = new THREE.Mesh(
        new THREE.SphereGeometry(42, 96, 64),
        new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.BackSide,
          color: 0xd4d4d4,
          toneMapped: true,
        }),
      );
      environmentShell.position.y = 2.2;
      environmentShell.rotation.y = Math.PI / 2;
      environmentShell.userData.environment = true;
      scene.add(environmentShell);
      scene.environmentRotation.y = Math.PI / 2;
      environmentTarget = pmrem.fromEquirectangular(texture);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 1.2;
      readyEnvironment = texture;
      el.dataset.environment = name;
    }
    async function loadEnvironment(name, sourceLoader) {
      const response = await fetch(asset(name));
      if (
        !response.ok ||
        response.headers.get("content-type")?.includes("text/html")
      )
        throw new Error("Environment unavailable");
      const parsed = sourceLoader.parse(await response.arrayBuffer());
      if (!parsed?.data) throw new Error("Invalid HDR data");
      if (!alive) return;
      const texture = new THREE.DataTexture(
        parsed.data,
        parsed.width,
        parsed.height,
        parsed.format,
        parsed.type,
      );
      texture.colorSpace = parsed.colorSpace || THREE.LinearSRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;
      setEnvironment(texture, name);
    }
    loadEnvironment("casino-room.exr", new EXRLoader())
      .catch(() => loadEnvironment("casino-studio.hdr", new HDRLoader()))
      .catch(() => {
        el.dataset.environment = "unavailable";
      });
    const loader = new GLTFLoader(),
      textures = {};
    function addObject(object) {
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      return object;
    }
    loader.load(asset("table.glb"), (g) => {
      if (alive) scene.add(addObject(g.scene));
    });
    const weaveSize = 128,
      weave = new Uint8Array(weaveSize * weaveSize * 4);
    for (let i = 0; i < weaveSize * weaveSize; i++) {
      const x = i % weaveSize,
        y = Math.floor(i / weaveSize),
        j = i * 4;
      weave[j] = 128 + (x % 2 ? 5 : -5);
      weave[j + 1] = 128 + (y % 2 ? 5 : -5);
      weave[j + 2] = 255;
      weave[j + 3] = 255;
    }
    const normal = new THREE.DataTexture(weave, weaveSize, weaveSize);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(35, 18);
    normal.needsUpdate = true;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10.84, 5.4),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.94,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.18, 0.18),
        metalness: 0,
      }),
    );
    board.rotation.x = -Math.PI / 2;
    board.position.y = 0.012;
    board.receiveShadow = true;
    scene.add(board);
    const textureLoader = new THREE.TextureLoader();
    for (const mode of ["classic", "crapless"])
      textureLoader.load(asset(`board-${mode}.png`), (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        textures[mode] = t;
      });
    const pieces = createTablePieces(scene, renderer);
    const dice = pieces.dice;
    const physics = createDicePhysics();
    let previousRoll = null,
      settlingUntil = 0;
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.085, 48),
      new THREE.MeshStandardMaterial({ color: 0xf5ead0, roughness: 0.5 }),
    );
    puck.position.set(-4.5, 0.07, -2.1);
    scene.add(puck);
    const ui = createSceneUI(renderer, (action) => {
      if (action === "camera") {
        cameraMode =
          cameraMode === "auto"
            ? "table"
            : cameraMode === "table"
              ? "room"
              : "auto";
        userUntil = 0;
        el.dataset.camera = cameraMode;
      } else latest.current.onAction?.(action);
    });
    function pointerDown(e) {
      dragStart = { x: e.clientX, y: e.clientY };
      if (ui.pick(e.clientX, e.clientY)) controls.enabled = false;
    }
    function pointerUp(e) {
      const click =
        dragStart &&
        Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < 7;
      controls.enabled = true;
      if (click) {
        const action = ui.pick(e.clientX, e.clientY);
        if (action) ui.activate(action);
      }
      dragStart = null;
    }
    function pointerMove(e) {
      renderer.domElement.style.cursor = ui.pick(e.clientX, e.clientY)
        ? "pointer"
        : dragStart
          ? "grabbing"
          : "grab";
    }
    el.addEventListener("pointerdown", pointerDown, true);
    el.addEventListener("pointerup", pointerUp);
    el.addEventListener("pointermove", pointerMove);
    el.addEventListener("pointercancel", () => {
      controls.enabled = true;
      dragStart = null;
    });
    function resize() {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      ui.resize(w, h);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let lastTime = 0,
      startTime = performance.now();
    const targetPosition = new THREE.Vector3();
    function animate(time) {
      frame = requestAnimationFrame(animate);
      if (document.hidden && time - lastTime < 500) return;
      const frameDelta = (time - lastTime) / 1000;
      const dt = Math.min(frameDelta, 0.06);
      const interval =
        latest.current.state?.rolling || dragStart || time < settlingUntil
          ? 33
          : 66;
      if (time - lastTime < interval) return;
      lastTime = time;
      const targetFov = cameraMode === "room" ? 60 : 43;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
      const current = latest.current,
        s = current.state,
        mode = s?.config.mode === "crapless" ? "crapless" : "classic";
      if (s?.display && s.display.revision !== displayRevision) {
        displayRevision = s.display.revision;
        cameraMode = s.display.camera;
        userUntil = 0;
        el.dataset.camera = cameraMode;
      }
      if (textures[mode] && board.material.map !== textures[mode]) {
        board.material.map = textures[mode];
        board.material.needsUpdate = true;
      }
      if (time > userUntil && !dragStart) {
        const elapsed = (time - startTime) / 1000;
        if (cameraMode === "table") targetPosition.set(0.01, 14, 6.5);
        else if (cameraMode === "room") targetPosition.set(9, 3.0, 16);
        else if (s?.rolling) targetPosition.set(2.2, 5.7, 9.2);
        else {
          const drift = reduced.matches ? 0 : Math.sin(elapsed * 0.09) * 2.2;
          targetPosition.set(drift, 4.2, 13.2);
        }
        if (camera.aspect < 1) targetPosition.multiplyScalar(1.45);
        camera.position.lerp(
          targetPosition,
          reduced.matches ? 1 : 1 - Math.exp(-dt * 1.6),
        );
      }
      controls.update();
      pieces.update(s);
      el.dataset.settingsOpen = String(!!current.settingsOpen);
      el.dataset.playerLabels = String(pieces.labels.children.length);
      el.dataset.chips = String(pieces.chips.children.length);
      el.dataset.diceColor =
        s?.players.find((p) => p.id === s.shooterId)?.dice?.color || "red";
      el.dataset.diceFinish =
        s?.players.find((p) => p.id === s.shooterId)?.dice?.finish || "solid";
      if (s?.lastRoll?.id !== previousRoll) {
        previousRoll = s?.lastRoll?.id;
        settlingUntil = time + 1100;
      }
      const values = s?.lastRoll?.dice || [3, 4];
      if (s?.rolling && !previousRolling && !reduced.matches) {
        physics.throwDice((s.rolls?.length || 0) + 1);
        physicsRollActive = true;
      }
      if (!s?.rolling && previousRolling) physicalSettleUntil = time + 400;
      previousRolling = !!s?.rolling;
      const simulating =
        physicsRollActive &&
        !reduced.matches &&
        (!!s?.rolling || time < physicalSettleUntil);
      if (simulating) physics.step(frameDelta);
      else if (physicsRollActive) {
        physics.stop();
        physicsRollActive = false;
      }
      dice.forEach((die, i) => {
        if (simulating) {
          const body = physics.bodies[i];
          die.position.set(body.position.x, body.position.y, body.position.z);
          die.quaternion.set(
            body.quaternion.x,
            body.quaternion.y,
            body.quaternion.z,
            body.quaternion.w,
          );
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
          die.quaternion.slerp(q, reduced.matches ? 1 : Math.min(1, dt * 11));
          die.position.y +=
            (DICE_SIZE / 2 + 0.007 - die.position.y) * Math.min(1, dt * 12);
        }
      });
      el.dataset.wallHits = String(physics.wallHits);
      const pts =
        mode === "crapless"
          ? [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
          : [4, 5, 6, 8, 9, 10];
      puck.material.color.set(s?.point ? 0xf4ecd8 : 0x141b17);
      puck.position.x = s?.point
        ? ((136 + ((pts.indexOf(s.point) + 0.5) * 1776) / pts.length) / 2048 -
            0.5) *
          10.84
        : -4.5;
      ui.update({ ...current, cameraMode });
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();
      renderer.render(ui.scene, ui.camera);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      ui.dispose();
      physics.stop();
      pieces.dispose();
      el.removeEventListener("pointerdown", pointerDown, true);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointermove", pointerMove);
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material)
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
      });
      Object.values(textures).forEach((t) => t.dispose());
      normal.dispose();
      readyEnvironment?.dispose();
      environmentTarget?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="table-canvas immersive-canvas"
      ref={host}
      role="img"
      aria-label="3D craps table with in-scene room code and controls"
    >
      {failed && (
        <div className="webgl-fallback">
          This screen needs WebGL to display the table.{" "}
          <a href={props.joinURL}>Open the phone controller</a>
        </div>
      )}
    </div>
  );
}
