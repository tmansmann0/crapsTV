import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposeModel } from "./three-resources.js";
import { createSceneUI } from "./scene-ui.js";
import { createTablePieces } from "./table-pieces.js";
import { DICE_SIZE } from "./dice-physics.js";
import { sampleThrow, aimDicePose } from "./throw-motion.js";
import { assetURL as asset } from "./asset-url.js";
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
      displayRevision = -1;
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
      if (alive) {
        scene.add(addObject(g.scene));
        pieces.installDealerRack(g.scene);
      } else disposeModel(g.scene);
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
    const aimArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0.05, 1.9),
      2,
      0xe7c78c,
      0.22,
      0.12,
    );
    aimArrow.visible = false;
    scene.add(aimArrow);
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
      if (s?.lastRoll?.id !== previousRoll) {
        previousRoll = s?.lastRoll?.id;
        settlingUntil = time + 1100;
      }
      const shared = s?.throw
        ? sampleThrow(s.throw, Date.now() + (s.clockOffsetMs || 0))
        : null;
      const aiming = s?.aim?.active ? aimDicePose(s.aim) : null;
      const pose = aiming || shared;
      const cinematic =
        !reduced.matches && !!s?.throw && (s.rolling || time < settlingUntil);
      controls.minDistance = cinematic
        ? 1.2
        : Math.min(8, camera.position.distanceTo(controls.target));
      const targetFov = cinematic ? 38 : cameraMode === "room" ? 60 : 43;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
      let cinematicDistance = 0;
      if ((time > userUntil && !dragStart) || cinematic) {
        const elapsed = (time - startTime) / 1000;
        if (cinematic && shared) {
          const mid = new THREE.Vector3()
            .fromArray(shared.dice[0].position)
            .add(new THREE.Vector3().fromArray(shared.dice[1].position))
            .multiplyScalar(0.5);
          const ending = shared.progress > 0.72;
          const radius =
            Math.max(
              ...shared.dice.map((p) =>
                new THREE.Vector3().fromArray(p.position).distanceTo(mid),
              ),
            ) + 0.35;
          const halfFov = Math.min(
            THREE.MathUtils.degToRad(camera.fov / 2),
            Math.atan(
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                camera.aspect,
            ),
          );
          const distance = Math.max(
            ending ? 3.5 : 3.0,
            (radius / Math.sin(halfFov)) * 1.12,
          );
          cinematicDistance = distance;
          targetPosition
            .set(
              ending ? 0.18 : 0.28,
              ending ? 0.8 : 0.72,
              ending ? 0.58 : 0.64,
            )
            .normalize()
            .multiplyScalar(distance)
            .add(mid);
          controls.target.copy(mid);
          if (camera.position.distanceTo(mid) < distance)
            camera.position.sub(mid).setLength(distance).add(mid);
        } else {
          controls.target.lerp(
            new THREE.Vector3(0, 0.3, 0),
            Math.min(1, dt * 3),
          );
          if (cameraMode === "table") targetPosition.set(0.01, 14, 6.5);
          else if (cameraMode === "room") targetPosition.set(9, 3.0, 16);
          else if (aiming) targetPosition.set(1.2, 3.2, 7.5);
          else {
            const drift = reduced.matches ? 0 : Math.sin(elapsed * 0.09) * 2.2;
            targetPosition.set(drift, 4.2, 13.2);
          }
        }
        if (camera.aspect < 1) targetPosition.multiplyScalar(1.45);
        camera.position.lerp(
          targetPosition,
          reduced.matches ? 1 : 1 - Math.exp(-dt * (cinematic ? 5 : 1.6)),
        );
      }
      controls.update();
      if (
        cinematicDistance &&
        camera.position.distanceTo(controls.target) < cinematicDistance
      )
        camera.position
          .sub(controls.target)
          .setLength(cinematicDistance)
          .add(controls.target);
      pieces.update(s);
      el.dataset.settingsOpen = String(!!current.settingsOpen);
      el.dataset.playerLabels = String(pieces.labels.children.length);
      el.dataset.chips = String(pieces.chips.children.length);
      el.dataset.diceColor =
        s?.players.find((p) => p.id === s.shooterId)?.dice?.color || "red";
      el.dataset.diceFinish =
        s?.players.find((p) => p.id === s.shooterId)?.dice?.finish || "solid";
      if (pose) {
        pose.dice.forEach((p, i) => {
          dice[i].position.fromArray(p.position);
          dice[i].quaternion.fromArray(p.quaternion);
        });
      } else {
        const values = s?.lastRoll?.dice || [3, 4];
        dice.forEach((die, i) => {
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...rotations[values[i]]),
          );
          die.quaternion.slerp(q, reduced.matches ? 1 : Math.min(1, dt * 11));
          die.position.y = DICE_SIZE / 2 + 0.007;
        });
      }
      aimArrow.visible = !!aiming;
      if (aiming) {
        aimArrow.position
          .fromArray(aiming.dice[0].position)
          .add(new THREE.Vector3(0.17, -0.07, 0));
        aimArrow.setDirection(new THREE.Vector3().fromArray(aiming.direction));
        aimArrow.setLength(0.8 + aiming.power * 2.2, 0.22, 0.12);
      }
      el.dataset.throwId = s?.throw?.id || "";
      el.dataset.pose = pose ? JSON.stringify(pose.dice) : "";
      el.dataset.cinematic = String(cinematic);
      el.dataset.wallHits = String(shared?.wallHits || 0);
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
      pieces.dispose();
      el.removeEventListener("pointerdown", pointerDown, true);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointermove", pointerMove);
      const sceneTextures = new Set();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material)
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            for (const value of Object.values(m))
              if (value?.isTexture) sceneTextures.add(value);
            m.dispose();
          }
      });
      sceneTextures.forEach((t) => t.dispose());
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
