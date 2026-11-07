import * as THREE from "three";
import { createSceneUI } from "../../src/scene-ui.js";
import * as game from "../../src/game.js";
import "../../node_modules/@fontsource/manrope/latin-500.css";
import "../../node_modules/@fontsource/manrope/latin-600.css";
import "../../node_modules/@fontsource/manrope/latin-700.css";
import "../../node_modules/@fontsource/manrope/latin-800.css";
await document.fonts.load("700 36px Manrope");
await document.fonts.load("600 36px Manrope");
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor("#0a1713");
document.body.appendChild(renderer.domElement);
let ui = createSceneUI(renderer, () => {});
const state = game.createState("ABCDEF");
const player = game.join(state, "Alexandria");
game.start(state, player.id);
state.lastRoll = {
  id: "display-fixture",
  dice: [3, 4],
  total: 7,
  kind: "natural",
};
const props = {
  state,
  code: state.code,
  status: "connected",
  cameraMode: "table",
  settingsOpen: false,
  sceneLoading: false,
  joinURL: "http://192.168.0.25:3000/?room=ABCDEF",
  graphics: {
    fps: 60,
    resolution: "75",
    antialias: "on",
    modelDetail: "full",
    textures: "4k",
  },
  graphicsInfo: {
    fps: 60,
    resolution: `${Math.floor(innerWidth * devicePixelRatio * 0.75)}×${Math.floor(innerHeight * devicePixelRatio * 0.75)}`,
    uiResolution: `${innerWidth * devicePixelRatio}×${innerHeight * devicePixelRatio}`,
    status: "ready",
    device: "QA graphics device",
    textureLabel: "4096px maximum",
  },
};
ui.resize(innerWidth, innerHeight);
window.tvReadability = {
  setJoinURL(url) {
    props.joinURL = url;
  },
  activateAt(x, y) {
    const action = ui.pick(x, y);
    ui.activate(action);
    return {
      action,
      stored: localStorage.getItem("crapstv-tv-ui-size-v1"),
      mode: ui.getLayout().uiSize,
    };
  },
  labels() {
    return {
      mode: ui.labelMotion,
      stored: localStorage.getItem("crapstv-tv-labels-v1"),
    };
  },
  recreate() {
    ui.dispose();
    ui = createSceneUI(renderer, () => {});
    ui.resize(innerWidth, innerHeight);
    return ui.getLayout().uiSize;
  },
  snapshot(scenario) {
    ui.setSettingsPage(scenario === "graphics" ? "graphics" : "main");
    ui.update({
      ...props,
      settingsOpen: ["settings", "graphics"].includes(scenario),
      introActive: scenario === "intro",
    });
    renderer.render(ui.scene, ui.camera);
    return {
      layout: ui.getLayout(),
      text: ui.textMetrics,
      actions: ui.getActionPoints(),
      framebuffer: [
        renderer.getContext().drawingBufferWidth,
        renderer.getContext().drawingBufferHeight,
      ],
    };
  },
};
window.tvReady = true;
