import { configureRenderer } from "./render-quality.js";
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
import {
  DEFAULT_GRAPHICS,
  GRAPHICS_OPTIONS,
  normalizeGraphics,
} from "./graphics-settings.js";
import {
  recommendGraphics,
  calibrateGraphics,
  resolveGraphics,
} from "./graphics-profile.js";
import { createTextureQuality } from "./texture-quality.js";
const GRAPHICS_STORAGE = "crapstv-graphics-v1";
function savedGraphics() {
  try {
    return normalizeGraphics(
      JSON.parse(localStorage.getItem(GRAPHICS_STORAGE) || "{}"),
    );
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}
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
    latest = useRef(props),
    graphicsRef = useRef(null),
    profileRef = useRef(null),
    remoteGraphicsRevision = useRef(-1),
    graphicsPage = useRef("main"),
    retainedView = useRef(null),
    introDone = useRef(false);
  if (!graphicsRef.current) graphicsRef.current = savedGraphics();
  latest.current = props;
  const [failed, setFailed] = useState(false);
  const [rendererEpoch, setRendererEpoch] = useState(0);
  useEffect(() => {
    let renderer;
    let graphics = graphicsRef.current;
    const capabilities = {
      devicePixelRatio: window.devicePixelRatio || 1,
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
    const initialProfile =
      profileRef.current || recommendGraphics(capabilities);
    const initialQuality = resolveGraphics(
      graphics,
      initialProfile,
      capabilities,
    );
    let contextAntialias = initialQuality.antialias;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: initialQuality.antialias,
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
      cameraMode = retainedView.current?.cameraMode || "auto",
      userUntil = retainedView.current?.userUntil || 0,
      dragStart = null,
      environmentShell = null,
      environmentTarget = null,
      displayRevision = retainedView.current?.displayRevision ?? -1,
      tableLoaded = false,
      piecesLoaded = false,
      detailLoaded = 0,
      boardsLoaded = 0,
      stageReady = false,
      warming = false,
      stageError = "";
    const { software } = configureRenderer(renderer);
    capabilities.software = software;
    capabilities.maxTextureSize = renderer.capabilities.maxTextureSize;
    if (!profileRef.current)
      profileRef.current = recommendGraphics(capabilities);
    let quality = resolveGraphics(graphics, profileRef.current, capabilities);
    if (
      quality.antialias !==
      renderer.getContext().getContextAttributes().antialias
    ) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = new THREE.WebGLRenderer({
        antialias: quality.antialias,
        powerPreference: "high-performance",
      });
      configureRenderer(renderer);
      contextAntialias = quality.antialias;
    }
    renderer.setPixelRatio(quality.pixelRatio);
    const textureQuality = createTextureQuality(quality.textureLimit);
    let restarting = false;
    let introStart = null;
    let introPaused = null;
    let introIntervals = [];
    let introPreviousFrame = null;
    const introDuration = software ? 900 : 2400;
    const glInfo = renderer
      .getContext()
      .getExtension("WEBGL_debug_renderer_info");
    const deviceName = glInfo
      ? renderer.getContext().getParameter(glInfo.UNMASKED_RENDERER_WEBGL)
      : "WebGL device";
    el.dataset.renderQuality = software ? "software" : "full";
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The room light is fixed: camera movement does not invalidate its shadows.
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.autoClear = false;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#09100e");
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 160);
    camera.position.set(10, 6.5, 18);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0.5);
    if (retainedView.current) {
      camera.position.fromArray(retainedView.current.position);
      controls.target.fromArray(retainedView.current.target);
    }
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
    shadow.position.y = -2.54;
    shadow.receiveShadow = true;
    scene.add(shadow);
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    function setEnvironment(texture, name) {
      if (!alive) {
        texture.dispose();
        return;
      }
      textureQuality.register(texture);
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
      readyEnvironment = texture;
      rebuildEnvironment();
      el.dataset.environment = name;
    }
    function rebuildEnvironment() {
      if (!readyEnvironment) return;
      const texture = readyEnvironment;
      let lightingTexture = texture;
      if (software && texture.image.width > 512) {
        // Keep the real HDR backdrop, but prefilter a smaller lighting map on
        // CPU renderers instead of asking them to convolve the full 4K image.
        const source = texture.image;
        const width = 512,
          height = Math.round((source.height * width) / source.width);
        const channels = source.data.length / (source.width * source.height);
        const pixels = new source.data.constructor(width * height * channels);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const from =
              (Math.floor((y * source.height) / height) * source.width +
                Math.floor((x * source.width) / width)) *
              channels;
            for (let c = 0; c < channels; c++)
              pixels[(y * width + x) * channels + c] = source.data[from + c];
          }
        lightingTexture = new THREE.DataTexture(
          pixels,
          width,
          height,
          texture.format,
          texture.type,
        );
        lightingTexture.colorSpace = texture.colorSpace;
        lightingTexture.mapping = THREE.EquirectangularReflectionMapping;
        lightingTexture.needsUpdate = true;
      }
      const previous = environmentTarget;
      environmentTarget = pmrem.fromEquirectangular(lightingTexture);
      if (lightingTexture !== texture) lightingTexture.dispose();
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 1.2;
      previous?.dispose();
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
        stageError = "Casino environment could not load. Refresh to retry.";
      });
    const loader = new GLTFLoader(),
      textures = {};
    function addObject(object) {
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          registerMaterialTextures(o.material);
        }
      });
      return object;
    }
    function registerMaterialTextures(material) {
      for (const m of Array.isArray(material) ? material : [material])
        for (const value of Object.values(m || {}))
          if (value?.isTexture && value !== environmentTarget?.texture)
            textureQuality.register(value);
    }
    loader.load(
      asset("table-player-rails-optimized.glb"),
      (g) => {
        if (alive) {
          scene.add(addObject(g.scene));
          pieces.installDealerRack(g.scene);
          tableLoaded = true;
        } else disposeModel(g.scene);
      },
      undefined,
      () => {
        stageError = "Table model could not load. Refresh to retry.";
      },
    );
    const detailLoader = new THREE.TextureLoader();
    const loadDetail = (name) =>
      detailLoader.load(
        asset(name),
        (texture) => {
          if (!alive) {
            texture.dispose();
            return;
          }
          detailLoaded++;
          textureQuality.register(texture);
        },
        undefined,
        () => {
          stageError = "Table texture could not load. Refresh to retry.";
        },
      );
    const normal = loadDetail("felt-normal.png"),
      roughness = loadDetail("felt-roughness.png");
    for (const texture of [normal, roughness]) {
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(10.84 / 0.46, 5.4 / 0.46);
      texture.anisotropy = Math.min(
        8,
        renderer.capabilities.getMaxAnisotropy(),
      );
    }
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10.84, 5.4),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.98,
        roughnessMap: roughness,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.26, 0.26),
        metalness: 0,
      }),
    );
    board.rotation.x = -Math.PI / 2;
    board.position.y = 0.012;
    board.receiveShadow = true;
    scene.add(board);
    const textureLoader = new THREE.TextureLoader();
    for (const mode of ["classic", "crapless"])
      textureLoader.load(
        asset(`board-${mode}.png`),
        (t) => {
          if (!alive) {
            t.dispose();
            return;
          }
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
          textures[mode] = t;
          textureQuality.register(t);
          boardsLoaded++;
        },
        undefined,
        () => {
          stageError = "Table layout could not load. Refresh to retry.";
        },
      );
    const pieces = createTablePieces(scene, renderer, { software });
    pieces.ready
      .then(() => {
        if (alive) piecesLoaded = true;
      })
      .catch(() => {
        stageError = "Playing pieces could not load. Refresh to retry.";
      });
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
    function applyRuntimeQuality() {
      quality = resolveGraphics(graphics, profileRef.current, capabilities);
      if (quality.antialias !== contextAntialias && !restarting) {
        graphicsPage.current = ui.settingsPage;
        retainedView.current = {
          cameraMode,
          userUntil,
          displayRevision,
          position: camera.position.toArray(),
          target: controls.target.toArray(),
        };
        restarting = true;
        setRendererEpoch((value) => value + 1);
        return;
      }
      if (renderer.getPixelRatio() !== quality.pixelRatio) {
        renderer.setPixelRatio(quality.pixelRatio);
        resize();
      }
      if (textureQuality.setLimit(quality.textureLimit)) rebuildEnvironment();
      renderer.shadowMap.needsUpdate = true;
    }
    function setGraphics(next) {
      graphics = normalizeGraphics(next);
      graphicsRef.current = graphics;
      try {
        localStorage.setItem(GRAPHICS_STORAGE, JSON.stringify(graphics));
      } catch {}
      applyRuntimeQuality();
    }
    function handleGraphics(action) {
      const key = action.slice("graphics:".length);
      if (key === "retest") {
        introDone.current = false;
        introStart = null;
        introPreviousFrame = null;
        introIntervals = [];
        return;
      }
      const options = GRAPHICS_OPTIONS[key];
      if (!options) return;
      const index = options.findIndex(
        (option) => option.value === graphics[key],
      );
      setGraphics({
        ...graphics,
        [key]: options[(index + 1) % options.length].value,
      });
    }
    const ui = createSceneUI(renderer, (action) => {
      if (action.startsWith("graphics:")) handleGraphics(action);
      else if (action === "camera") {
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
    ui.setSettingsPage(graphicsPage.current);
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
    function pointerCancel() {
      controls.enabled = true;
      dragStart = null;
    }
    el.addEventListener("pointercancel", pointerCancel);
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
    let lastPiecesState = null,
      lastPiecesConnection = null,
      lastPiecesReady = false,
      renderedOnce = false,
      metricStart = 0,
      metricFrames = 0;
    const targetPosition = new THREE.Vector3(),
      tableTarget = new THREE.Vector3(0, 0.4, 0.5),
      diceMidpoint = new THREE.Vector3(),
      scratchPosition = new THREE.Vector3(),
      aimOffset = new THREE.Vector3(0.17, -0.07, 0),
      aimDirection = new THREE.Vector3();
    let nextFrameAt = 0;
    function animate(time) {
      frame = requestAnimationFrame(animate);
      if (restarting) return;
      if (document.hidden) {
        if (introPaused === null) introPaused = time;
        introPreviousFrame = null;
      } else {
        if (introPaused !== null && introStart !== null)
          introStart += time - introPaused;
        introPaused = null;
        if (stageReady && !introDone.current) {
          if (introStart === null) introStart = time;
          if (introPreviousFrame !== null && time - introStart > 300)
            introIntervals.push(time - introPreviousFrame);
          introPreviousFrame = time;
          if (time - introStart >= introDuration) {
            if (!software)
              profileRef.current = calibrateGraphics(
                profileRef.current,
                introIntervals,
              );
            introDone.current = true;
            applyRuntimeQuality();
            nextFrameAt = 0;
          }
        }
      }
      if (document.hidden && time - lastTime < 500) return;
      const frameDelta = (time - lastTime) / 1000;
      const dt = Math.min(frameDelta, 0.06);
      const testing = stageReady && !introDone.current;
      const interval = 1000 / (testing && !software ? 60 : quality.fps);
      // Carry fractional deadlines: 24 FPS on a 60 Hz display needs alternating
      // two/three-refresh gaps, rather than accidentally becoming 20 FPS.
      if (!document.hidden && time + 0.75 < nextFrameAt) return;
      if (!nextFrameAt || time - nextFrameAt > interval) nextFrameAt = time;
      nextFrameAt += interval;
      lastTime = time;
      const current = latest.current,
        s = current.state,
        mode = s?.config.mode === "crapless" ? "crapless" : "classic";
      const graphicsRevision = s?.display?.graphicsRevision ?? 0;
      if (
        s?.display?.graphics &&
        graphicsRevision !== remoteGraphicsRevision.current
      ) {
        remoteGraphicsRevision.current = graphicsRevision;
        if (graphicsRevision > 0) setGraphics(s.display.graphics);
      }
      if (restarting) return;
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
          const mid = diceMidpoint
            .fromArray(shared.dice[0].position)
            .add(scratchPosition.fromArray(shared.dice[1].position))
            .multiplyScalar(0.5);
          const ending = shared.progress > 0.72;
          const radius =
            Math.max(
              ...shared.dice.map((p) =>
                scratchPosition.fromArray(p.position).distanceTo(mid),
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
          controls.target.lerp(tableTarget, Math.min(1, dt * 3));
          if (testing && !reduced.matches && time > userUntil)
            targetPosition.set(
              Math.sin(((time - introStart) / introDuration) * Math.PI * 2) *
                3.5,
              7.5 +
                Math.sin(((time - introStart) / introDuration) * Math.PI) * 2,
              15.5,
            );
          else if (cameraMode === "table") targetPosition.set(0.01, 17, 8);
          else if (cameraMode === "room") targetPosition.set(11, 4.5, 19);
          else if (aiming) targetPosition.set(1.2, 3.2, 7.5);
          else {
            const drift = reduced.matches ? 0 : Math.sin(elapsed * 0.09) * 2.2;
            targetPosition.set(drift, 6.0, 16.2);
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
      const connected = current.status === "connected";
      const piecesChanged =
        s !== lastPiecesState ||
        connected !== lastPiecesConnection ||
        pieces.isReady !== lastPiecesReady ||
        pieces.animating;
      if (piecesChanged) {
        pieces.update(s, { connected });
        scene.traverse((object) => {
          if (object.isMesh) registerMaterialTextures(object.material);
        });
        lastPiecesState = s;
        lastPiecesConnection = connected;
        lastPiecesReady = pieces.isReady;
      }
      el.dataset.settingsOpen = String(!!current.settingsOpen);
      el.dataset.playerLabels = String(pieces.labels.children.length);
      el.dataset.banks = String(pieces.banks.children.length);
      el.dataset.previews = String(pieces.previews.children.length);
      el.dataset.transfers = String(pieces.transfers.children.length);
      el.dataset.sceneReady = String(stageReady);
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
        aimArrow.position.fromArray(aiming.dice[0].position).add(aimOffset);
        aimArrow.setDirection(aimDirection.fromArray(aiming.direction));
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
          10.84 *
          (1588 / 1776)
        : -4.0;
      if (
        !stageReady &&
        !warming &&
        tableLoaded &&
        detailLoaded === 2 &&
        boardsLoaded === 2 &&
        piecesLoaded &&
        readyEnvironment
      ) {
        warming = true;
        Promise.resolve(renderer.compileAsync?.(scene, camera))
          .then(() => {
            if (alive) stageReady = true;
          })
          .catch(() => {
            if (alive) stageReady = true;
          });
      }
      ui.update({
        ...current,
        cameraMode,
        sceneLoading: !stageReady,
        error: current.error || stageError,
        graphics,
        introActive: testing,
        introReducedMotion: reduced.matches,
        graphicsInfo: {
          fps: Number(el.dataset.renderFps) || null,
          resolution: `${renderer.domElement.width} × ${renderer.domElement.height}`,
          device: String(deviceName),
          status: testing ? "testing" : "ready",
          progress: testing
            ? Math.min(1, (time - introStart) / introDuration)
            : 1,
          textureLabel: `${Math.min(quality.textureLimit, textureQuality.maxNativeDimension || quality.textureLimit)}px maximum`,
        },
      });
      // Hidden TV tabs still advance shared state, but need no GPU readback.
      if (!document.hidden) {
        const lodChanged = pieces.updateLOD(
          camera,
          el.clientHeight,
          quality.modelDetail,
        );
        el.dataset.graphics = JSON.stringify(graphics);
        el.dataset.graphicsFps = String(quality.fps);
        el.dataset.graphicsModel = quality.modelDetail;
        el.dataset.graphicsTextures = String(quality.textureLimit);
        el.dataset.graphicsIntro = String(testing);
        el.dataset.graphicsPage = ui.settingsPage;
        renderer.info.reset();
        renderer.shadowMap.needsUpdate =
          !renderedOnce ||
          lodChanged ||
          piecesChanged ||
          !!aiming ||
          !!s?.rolling ||
          time < settlingUntil;
        renderer.clear();
        if (stageReady) renderer.render(scene, camera);
        renderer.clearDepth();
        renderer.render(ui.scene, ui.camera);
        if (stageReady) {
          renderedOnce = true;
          if (!metricStart) metricStart = time;
          else metricFrames++;
          if (time - metricStart >= 1000) {
            el.dataset.renderFps = (
              (metricFrames * 1000) /
              (time - metricStart)
            ).toFixed(1);
            el.dataset.drawCalls = String(renderer.info.render.calls);
            el.dataset.triangles = String(renderer.info.render.triangles);
            metricStart = time;
            metricFrames = 0;
          }
        }
      }
    }
    frame = requestAnimationFrame(animate);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      textureQuality.dispose();
      observer.disconnect();
      controls.dispose();
      ui.dispose();
      pieces.dispose();
      el.removeEventListener("pointerdown", pointerDown, true);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointercancel", pointerCancel);
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
      roughness.dispose();
      readyEnvironment?.dispose();
      environmentTarget?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [rendererEpoch]);
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
