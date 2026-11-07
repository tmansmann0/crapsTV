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
import { createTableMaterials } from "./table-materials.js";
import { createTableCompositor } from "./table-compositor.js";
import { puckHome } from "./puck-layout.js";
import { resolveOutcomePresentation } from "./chip-flow.js";
import { wagerStackLayout } from "./wager-layout.js";
import { DICE_SIZE } from "./dice-physics.js";
import { sampleThrow, aimDicePose } from "./throw-motion.js";
import { sampleThrowCamera, sampleTableCamera } from "./throw-camera.js";
import { assetURL as asset } from "./asset-url.js";
import {
  DEFAULT_GRAPHICS,
  GRAPHICS_OPTIONS,
  normalizeGraphics,
} from "./graphics-settings.js";
import { recommendGraphics, resolveGraphics } from "./graphics-profile.js";
import { createTextureQuality } from "./texture-quality.js";
import {
  createStartupShowcase,
  sampleStartup,
  STARTUP_DURATION_MS,
} from "./startup-sequence.js";
import {
  startupCandidates,
  selectStartupProfile,
  STARTUP_PROBE_AT,
} from "./startup-calibration.js";
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
      viewportWidth: host.current.clientWidth,
      viewportHeight: host.current.clientHeight,
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
      puckLoaded = false,
      piecesLoaded = false,
      detailLoaded = 0,
      boardsLoaded = 0,
      stageReady = false,
      warming = false,
      startupCompile = null,
      stageError = "";
    let tableMaterials = null;
    const { software } = configureRenderer(renderer);
    capabilities.software = software;
    capabilities.maxTextureSize = renderer.capabilities.maxTextureSize;
    if (!profileRef.current)
      profileRef.current = recommendGraphics(capabilities);
    const recommendedProfile = { ...profileRef.current };
    let candidates = startupCandidates(recommendedProfile, { software });
    if (!introDone.current) profileRef.current = candidates[0];
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
    let introPreviousFrame = null;
    let introReports = [[], [], []],
      introCandidate = 0;
    let introShowcase = null,
      introFinishedAt = introDone.current ? -Infinity : null;
    let introSample = null,
      probeWarmUntil = 0;
    let introLiveProbe = false;
    let sceneRevealedAt = introDone.current ? -Infinity : null;
    const introDuration = STARTUP_DURATION_MS;
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
    renderer.setClearColor(0x000000, 1);
    const compositor = createTableCompositor(renderer);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#09100e");
    const camera = new THREE.PerspectiveCamera(43, 1, 0.035, 160);
    camera.position.set(10, 6.5, 18);
    const fadeScene = new THREE.Scene();
    const fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    fadeCamera.position.z = 1;
    const fadeMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const fadeQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      fadeMaterial,
    );
    fadeQuad.frustumCulled = false;
    fadeScene.add(fadeQuad);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0.5);
    if (retainedView.current) {
      camera.position.fromArray(retainedView.current.position);
      controls.target.fromArray(retainedView.current.target);
    }
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.35;
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
    key.shadow.normalBias = 0.02;
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
    Promise.all([
      loader.loadAsync(asset("table-player-rails-optimized.glb")),
      createTableMaterials(renderer),
    ])
      .then(([g, materials]) => {
        if (alive) {
          tableMaterials = materials;
          for (const texture of materials.textures)
            textureQuality.register(texture);
          scene.add(addObject(materials.apply(g.scene)));
          pieces.installDealerRack(g.scene);
          tableLoaded = true;
        } else {
          disposeModel(g.scene);
          materials.dispose();
        }
      })
      .catch(() => {
        stageError =
          "Table model or materials could not load. Refresh to retry.";
      });
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
        asset(`board-${mode}-4k.png`),
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
    const puck = new THREE.Group();
    puck.name = "Physical ON/OFF puck";
    scene.add(puck);
    loader
      .loadAsync(asset("puck.glb"))
      .then((gltf) => {
        if (!alive) return disposeModel(gltf.scene);
        puck.add(addObject(gltf.scene));
        puckLoaded = true;
      })
      .catch(() => {
        stageError = "Puck model could not load. Refresh to retry.";
      });
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
      resize();
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
    function finishOpening(time, skipped = false) {
      if (introDone.current) return;
      const measured = introReports.some((samples) => samples.length >= 8);
      profileRef.current =
        skipped && !measured
          ? recommendedProfile
          : selectStartupProfile(candidates, introReports, {
              requestedFps: graphics.fps,
              software,
            });
      introDone.current = true;
      introFinishedAt = skipped && !introLiveProbe ? time : time - 1200;
      introLiveProbe = false;
      introSample = null;
      applyRuntimeQuality();
      nextFrameAt = 0;
    }
    function skipOpening(event) {
      if (event.key === "Escape" && !introDone.current) {
        finishOpening(performance.now(), true);
      }
    }
    window.addEventListener("keydown", skipOpening);
    function handleGraphics(action) {
      const key = action.slice("graphics:".length);
      if (key === "retest") {
        introDone.current = false;
        introStart = null;
        introPreviousFrame = null;
        introReports = [[], [], []];
        introCandidate = 0;
        introLiveProbe = latest.current.state?.status === "playing";
        introFinishedAt = null;
        if (!introLiveProbe) sceneRevealedAt = performance.now();
        candidates = startupCandidates(recommendedProfile, { software });
        if (latest.current.settingsOpen && !introLiveProbe)
          latest.current.onAction?.("settings");
        profileRef.current = candidates[0];
        applyRuntimeQuality();
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
      if (!introDone.current && !introLiveProbe) {
        controls.enabled = false;
        return;
      }
      const overUI = !!ui.pick(e.clientX, e.clientY);
      const pan = !overUI && e.button === 0 && e.shiftKey;
      dragStart = { x: e.clientX, y: e.clientY, pan, overUI };
      // OrbitControls already maps Shift + left-drag to screen-space pan.
      // Enable it only for that gesture so ordinary left-drag keeps orbiting.
      controls.enablePan = pan;
      if (overUI) controls.enabled = false;
    }
    function pointerUp(e) {
      const click =
        dragStart &&
        !dragStart.pan &&
        Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < 7;
      if (dragStart && !click && controls.enabled)
        userUntil = performance.now() + 15000;
      controls.enabled = true;
      controls.enablePan = false;
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
      controls.enablePan = false;
      dragStart = null;
    }
    el.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", pointerCancel);
    function resize() {
      const w = el.clientWidth,
        h = el.clientHeight;
      capabilities.viewportWidth = w;
      capabilities.viewportHeight = h;
      capabilities.devicePixelRatio = window.devicePixelRatio || 1;
      quality = resolveGraphics(graphics, profileRef.current, capabilities);
      const buffers = compositor.resize({
        width: w,
        height: h,
        devicePixelRatio: capabilities.devicePixelRatio,
        scenePixelRatio: quality.pixelRatio,
        antialias: quality.antialias,
      });
      el.dataset.sceneResolution = `${buffers.sceneWidth}x${buffers.sceneHeight}`;
      el.dataset.uiResolution = `${buffers.uiWidth}x${buffers.uiHeight}`;
      el.dataset.splitResolution = String(buffers.split);
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
      metricFrames = 0,
      uiRevision = -1,
      uiExclusions = [],
      labelCameraMotionAt = performance.now(),
      labelCameraFov = camera.fov;
    const labelCameraPosition = camera.position.clone();
    const labelCameraRotation = camera.quaternion.clone();
    const targetPosition = new THREE.Vector3(),
      tableTarget = new THREE.Vector3(0, 0.4, 0.5),
      shotTarget = new THREE.Vector3(),
      puckTarget = new THREE.Vector3(),
      puckRotation = new THREE.Quaternion(),
      aimOffset = new THREE.Vector3(0.17, -0.07, 0),
      aimDirection = new THREE.Vector3();
    let previousCameraShot = null;
    let launchState = null,
      launchProps = {};
    let incomingState = null,
      displayState = null,
      localPresentation = null;
    function stateForDisplay(next) {
      if (next === incomingState) return displayState;
      if (
        !next ||
        next.code !== incomingState?.code ||
        next.createdAt !== incomingState?.createdAt
      )
        localPresentation = null;
      if (
        next?.lastRoll &&
        !next.lastRoll.presentation &&
        next.lastRoll.id !== localPresentation?.rollId
      )
        localPresentation = resolveOutcomePresentation(incomingState, next);
      displayState =
        next?.lastRoll && !next.lastRoll.presentation && localPresentation
          ? {
              ...next,
              lastRoll: { ...next.lastRoll, presentation: localPresentation },
            }
          : next;
      incomingState = next;
      return displayState;
    }
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
          if (latest.current.state?.status === "playing" && !introLiveProbe)
            finishOpening(time, true);
          else {
            if (introStart === null) {
              introStart = time;
              probeWarmUntil = time + 800;
              if (!introLiveProbe) introShowcase ||= createStartupShowcase();
            }
            const elapsed = time - introStart;
            const probe =
              elapsed >= STARTUP_PROBE_AT[3]
                ? 3
                : elapsed >= STARTUP_PROBE_AT[2]
                  ? 2
                  : elapsed >= STARTUP_PROBE_AT[1]
                    ? 1
                    : 0;
            if (probe !== introCandidate) {
              introCandidate = probe;
              introPreviousFrame = null;
              probeWarmUntil = time + 900;
              profileRef.current =
                probe < 3
                  ? candidates[probe]
                  : selectStartupProfile(candidates, introReports, {
                      requestedFps: graphics.fps,
                      software,
                    });
              applyRuntimeQuality();
            }
            if (elapsed >= introDuration) finishOpening(time);
          }
        }
      }
      if (document.hidden && time - lastTime < 500) return;
      const frameDelta = (time - lastTime) / 1000;
      const dt = Math.min(frameDelta, 0.06);
      const testing = stageReady && !introDone.current;
      const interval =
        1000 /
        (testing && graphics.fps === "auto" && !software ? 60 : quality.fps);
      // Carry fractional deadlines: 24 FPS on a 60 Hz display needs alternating
      // two/three-refresh gaps, rather than accidentally becoming 20 FPS.
      if (!document.hidden && time + 0.75 < nextFrameAt) return;
      if (!nextFrameAt || time - nextFrameAt > interval) nextFrameAt = time;
      nextFrameAt += interval;
      lastTime = time;
      const current = latest.current;
      const live = stateForDisplay(current.state);
      introSample =
        !introDone.current && introShowcase && !introLiveProbe
          ? sampleStartup(
              introShowcase,
              introStart === null ? 0 : time - introStart,
              {
                aspect: camera.aspect,
                reducedMotion: reduced.matches,
              },
            )
          : null;
      if (introSample)
        introSample.state.clockOffsetMs = introSample.elapsed - Date.now();
      const s = introSample?.state || live;
      const mode = s?.config.mode === "crapless" ? "crapless" : "classic";
      const graphicsRevision = live?.display?.graphicsRevision ?? 0;
      if (
        live?.display?.graphics &&
        graphicsRevision !== remoteGraphicsRevision.current
      ) {
        remoteGraphicsRevision.current = graphicsRevision;
        if (graphicsRevision > 0) setGraphics(live.display.graphics);
      }
      if (restarting) return;
      if (live?.display && live.display.revision !== displayRevision) {
        displayRevision = live.display.revision;
        cameraMode = live.display.camera;
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
      const throwTime = Date.now() + (s?.clockOffsetMs || 0);
      const shared = s?.throw ? sampleThrow(s.throw, throwTime) : null;
      if (s !== launchState) {
        launchState = s;
        launchProps = {
          puck:
            s?.puck && s.puck.point === s.point
              ? s.puck
              : puckHome(s?.point, s?.config.mode),
          stacks: wagerStackLayout(s),
        };
      }
      const aiming = s?.aim?.active ? aimDicePose(s.aim, launchProps) : null;
      const pose = aiming || shared;
      const automaticCamera = !!introSample || (time > userUntil && !dragStart);
      controls.enabled =
        (introDone.current || introLiveProbe) && !dragStart?.overUI;
      const autoView =
        automaticCamera && cameraMode === "auto" && (!testing || introLiveProbe)
          ? sampleTableCamera({
              state: s,
              now: throwTime,
              aspect: camera.aspect,
              viewportWidth: el.clientWidth,
              viewportHeight: el.clientHeight,
              hudRects: uiExclusions,
              reducedMotion: reduced.matches,
            })
          : null;
      // A short betting window can schedule camera setup before the usual
      // dice-result hold finishes. Its shared payout plan owns that handoff.
      const outcomeReady =
        !s?.rolling && autoView?.phase?.startsWith("outcome-");
      const cameraShot =
        automaticCamera &&
        cameraMode === "auto" &&
        (!testing || introLiveProbe) &&
        !outcomeReady
          ? sampleThrowCamera({
              throwState: s?.throw,
              pose: shared,
              now: throwTime,
              aspect: camera.aspect,
              viewportWidth: el.clientWidth,
              viewportHeight: el.clientHeight,
              hudRects: uiExclusions,
              reducedMotion: reduced.matches,
            })
          : null;
      const playerShot = !cameraShot && autoView?.shotKey ? autoView : null;
      const openingShot = introSample && {
        ...introSample.camera,
        phase: "opening",
        shotKey: `opening:${introSample.camera.shotKey || introSample.phase}:${s.throw?.id || "establish"}`,
      };
      const directedShot = openingShot || cameraShot || playerShot;
      const cinematic = !!directedShot;
      controls.minDistance = cinematic ? 0.18 : 0.35;
      controls.minPolarAngle = cinematic ? 0.0001 : 0.15;
      controls.maxPolarAngle = directedShot ? Math.PI - 0.01 : 1.43;
      controls.enableDamping = !cinematic;
      const shotKey = openingShot
        ? openingShot.shotKey
        : cameraShot
          ? `${s.throw.id}:${cameraShot.phase}`
          : playerShot?.shotKey || null;
      const cut = shotKey !== null && shotKey !== previousCameraShot;
      const targetFov = !automaticCamera
        ? camera.fov
        : (directedShot?.fov ??
          autoView?.fov ??
          (cameraMode === "room" ? 60 : 43));
      camera.fov +=
        (targetFov - camera.fov) *
        (directedShot ? 1 : Math.min(1, dt * 5));
      camera.updateProjectionMatrix();
      if (automaticCamera) {
        const elapsed = (time - startTime) / 1000;
        if (directedShot) {
          // Flush any leftover manual orbit damping before the selected shot.
          if (cut) controls.update();
          targetPosition.fromArray(directedShot.position);
          shotTarget.fromArray(directedShot.target);
          // The shot sampler already supplies its smooth path. A second
          // follower filter makes the camera trail the chips and miss setup.
          controls.target.copy(shotTarget);
          camera.position.copy(targetPosition);
        } else {
          if (autoView) shotTarget.fromArray(autoView.target);
          controls.target.lerp(
            autoView ? shotTarget : tableTarget,
            Math.min(1, dt * 3),
          );
          if (cameraMode === "table") targetPosition.set(0.01, 8.1, 1.2);
          else if (cameraMode === "room") targetPosition.set(11, 4.5, 19);
          else if (autoView) targetPosition.fromArray(autoView.position);
          else if (aiming) targetPosition.set(1.2, 3.2, 7.5);
          else {
            const drift = reduced.matches ? 0 : Math.sin(elapsed * 0.09) * 2.2;
            targetPosition.set(drift, 6.0, 16.2);
          }
          if (camera.aspect < 1 && !autoView)
            targetPosition.multiplyScalar(1.45);
          camera.position.lerp(
            targetPosition,
            reduced.matches
              ? 1
              : 1 - Math.exp(-dt * (autoView?.phase === "betting" ? 3 : 1.6)),
          );
        }
      }
      controls.update();
      el.dataset.cameraPosition = JSON.stringify(camera.position.toArray());
      el.dataset.cameraTarget = JSON.stringify(controls.target.toArray());
      el.dataset.cameraFov = String(camera.fov);
      el.dataset.cameraManual = String(!automaticCamera);
      if (
        camera.position.distanceToSquared(labelCameraPosition) > 0.000001 ||
        camera.quaternion.angleTo(labelCameraRotation) > 0.0001 ||
        Math.abs(camera.fov - labelCameraFov) > 0.02
      )
        labelCameraMotionAt = time;
      labelCameraPosition.copy(camera.position);
      labelCameraRotation.copy(camera.quaternion);
      labelCameraFov = camera.fov;
      previousCameraShot = shotKey;
      el.dataset.cameraShot =
        openingShot?.phase ||
        cameraShot?.phase ||
        autoView?.phase ||
        "overview";
      el.dataset.cameraRig = cameraShot ? String(cameraShot.rig) : "";
      el.dataset.cameraPlayer = playerShot?.playerId || "";
      el.dataset.cameraShotKey = shotKey || "";
      el.dataset.cameraVariant = directedShot?.shotVariant || "";
      el.dataset.cameraArrivalAt = String(directedShot?.arrivalAt ?? "");
      el.dataset.cameraTransferAt = String(directedShot?.transferAt ?? "");
      el.dataset.cameraSubjectHeight = String(directedShot?.subjectHeight ?? "");
      const connected = !!introSample || current.status === "connected";
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
      el.dataset.activeTransfers = JSON.stringify(
        pieces.transfers.children
          .filter((group) => group.visible)
          .map((group) => ({
            id: group.userData.flow?.id,
            playerId: group.userData.flow?.playerId,
            kind: group.userData.flow?.kind,
            amount: group.userData.flow?.amount,
            position: group.position.toArray(),
          })),
      );
      el.dataset.sceneReady = String(stageReady);
      el.dataset.chips = String(pieces.chips.children.length);
      const chipImpacts = pieces.impactStatus;
      el.dataset.chipImpacts = String(chipImpacts.planned);
      el.dataset.activeChipImpacts = String(chipImpacts.active);
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
      el.dataset.throwSettled = String(
        !!(shared?.done && !aiming && !s?.rolling),
      );
      el.dataset.cinematic = String(cinematic);
      el.dataset.wallHits = String(shared?.wallHits || 0);
      const puckPlacement = s?.puck || puckHome(s?.point, mode);
      const physicalPuck = shared?.puck;
      puck.position.fromArray(physicalPuck?.position || puckPlacement.position);
      puck.quaternion.fromArray(
        physicalPuck?.quaternion || puckPlacement.quaternion,
      );
      if (physicalPuck && shared.done && !s?.rolling) {
        // Only the dealer's marker placement is animated after a point change.
        // Dice always retain the exact authoritative physical poses above.
        puckTarget.fromArray(puckPlacement.position);
        puckRotation.fromArray(puckPlacement.quaternion);
        const moved =
          puck.position.distanceToSquared(puckTarget) > 1e-8 ||
          Math.abs(puck.quaternion.dot(puckRotation)) < 0.99999;
        if (moved) {
          const progress = THREE.MathUtils.clamp(
            (throwTime - s.throw.startAt - s.throw.duration) / 650,
            0,
            1,
          );
          const eased = progress * progress * (3 - 2 * progress);
          puck.position.lerp(puckTarget, eased);
          puck.position.y += Math.sin(progress * Math.PI) * 0.13;
          puck.quaternion.slerp(puckRotation, eased);
        }
      }
      el.dataset.puckPose = JSON.stringify({
        position: puck.position.toArray(),
        quaternion: puck.quaternion.toArray(),
      });
      el.dataset.propHits = String(shared?.propHits || 0);
      if (
        !stageReady &&
        !warming &&
        tableLoaded &&
        puckLoaded &&
        detailLoaded === 2 &&
        boardsLoaded === 2 &&
        piecesLoaded &&
        readyEnvironment &&
        ui.isReady
      ) {
        warming = true;
        if (!introDone.current && latest.current.state?.status !== "playing") {
          try {
            introShowcase ||= createStartupShowcase();
            const first = introShowcase.stages[0].state;
            first.clockOffsetMs = -Date.now();
            pieces.update(first, { connected: true });
          } catch {
            finishOpening(time, true);
          }
        }
        startupCompile = Promise.resolve(compositor.compile(scene, camera))
          .then(() => {
            if (alive) {
              stageReady = true;
              sceneRevealedAt ??= performance.now();
            }
          })
          .catch(() => {
            if (alive) {
              stageError = "Table shaders could not load. Refresh to retry.";
              stageReady = true;
            }
          });
      }
      ui.update({
        ...current,
        cameraMode,
        cameraFocus: playerShot && {
          phase: playerShot.phase,
          shotKey: playerShot.shotKey,
          playerId: playerShot.playerId,
          playerIds: playerShot.playerIds,
          playerCount: playerShot.playerCount,
          name: playerShot.name,
          delta: playerShot.delta,
          bets: playerShot.bets,
        },
        sceneLoading: !stageReady,
        error: current.error || stageError,
        graphics,
        introActive: false,
        introReducedMotion: reduced.matches,
        graphicsInfo: {
          fps: Number(el.dataset.renderFps) || null,
          resolution: `${compositor.plan.sceneWidth} × ${compositor.plan.sceneHeight}`,
          uiResolution: `${compositor.plan.uiWidth} × ${compositor.plan.uiHeight}`,
          device: String(deviceName),
          status: testing ? "testing" : "ready",
          progress: testing
            ? Math.min(1, (time - introStart) / introDuration)
            : 1,
          textureLabel: `${Math.min(quality.textureLimit, textureQuality.maxNativeDimension || quality.textureLimit)}px`,
        },
      });
      const uiOpacity = introLiveProbe
        ? 1
        : stageError
          ? 1
          : !stageReady
            ? 0
            : introSample
              ? introSample.uiOpacity
              : THREE.MathUtils.smoothstep(
                  time - (introFinishedAt ?? time),
                  0,
                  1200,
                );
      ui.setPresentation(uiOpacity);
      const sceneOpacity = stageError
        ? 1
        : stageReady
          ? THREE.MathUtils.smoothstep(
              time - (sceneRevealedAt ?? time),
              0,
              1500,
            )
          : 0;
      el.dataset.startupPhase = !stageReady
        ? "loading"
        : introSample?.phase || "live";
      el.dataset.startupElapsed = String(
        introStart === null ? 0 : Math.min(introDuration, time - introStart),
      );
      el.dataset.startupFade = String(sceneOpacity);
      el.dataset.startupUiOpacity = String(uiOpacity);
      el.dataset.demoActive = String(!!introSample && stageReady);
      el.dataset.startupProbe = String(introCandidate);
      if (uiRevision !== ui.revision) {
        uiRevision = ui.revision;
        uiExclusions = ui.getVisibleRects();
        el.dataset.uiActions = JSON.stringify(ui.getActionPoints());
        el.dataset.uiTextMetrics = JSON.stringify(ui.textMetrics);
        el.dataset.uiLayout = JSON.stringify(ui.getLayout());
      }
      // Hidden TV tabs still advance shared state, but need no GPU readback.
      if (!document.hidden) {
        const lodChanged = pieces.updateLOD(
          camera,
          el.clientHeight,
          quality.modelDetail,
          {
            width: el.clientWidth,
            renderHeight: compositor.plan.sceneHeight,
            exclusions: uiExclusions,
            labelScale: ui.getLayout().labelScale,
            labelMotion: ui.labelMotion,
            puckPose: puck,
            labelsAllowed:
              !s?.rolling &&
              !cameraShot &&
              autoView?.phase !== "breather" &&
              !testing &&
              !current.settingsOpen &&
              time - labelCameraMotionAt >= 300,
          },
        );
        el.dataset.amountLabelsVisible = String(
          !!pieces.financialLabelsVisible,
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
        compositor.render(stageReady ? scene : null, camera);
        renderer.clearDepth();
        if (stageReady) {
          // Seat, wager, and transfer labels stay native-resolution even when
          // the modeled table is rendered at a lower resolution.
          const background = scene.background;
          const autoUpdate = scene.matrixWorldAutoUpdate;
          scene.background = null;
          scene.matrixWorldAutoUpdate = false;
          camera.layers.set(1);
          try {
            renderer.render(scene, camera);
          } finally {
            camera.layers.set(0);
            scene.background = background;
            scene.matrixWorldAutoUpdate = autoUpdate;
          }
          renderer.clearDepth();
        }
        renderer.render(ui.scene, ui.camera);
        if (sceneOpacity < 1) {
          fadeMaterial.opacity = 1 - sceneOpacity;
          renderer.clearDepth();
          renderer.render(fadeScene, fadeCamera);
        }
        if (testing && introCandidate < 3 && time > probeWarmUntil) {
          if (introPreviousFrame !== null)
            introReports[introCandidate].push(time - introPreviousFrame);
          introPreviousFrame = time;
        }
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
      observer.disconnect();
      controls.dispose();
      el.removeEventListener("pointerdown", pointerDown, true);
      el.removeEventListener("pointerup", pointerUp);
      el.removeEventListener("pointermove", pointerMove);
      el.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", pointerCancel);
      window.removeEventListener("keydown", skipOpening);
      renderer.domElement.remove();
      const disposeResources = () => {
        textureQuality.dispose();
        ui.dispose();
        compositor.dispose();
        fadeQuad.geometry.dispose();
        fadeMaterial.dispose();
        pieces.dispose();
        tableMaterials?.dispose();
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
      };
      // Three's async compiler polls each material's GPU program. A rapid AA
      // toggle can unmount this renderer while that poll is still pending;
      // retain its resources until it settles, but detach its UI immediately.
      if (startupCompile)
        startupCompile.then(disposeResources, disposeResources);
      else disposeResources();
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
