import { assetURL } from "./asset-url.js";
import * as THREE from "three";
import QRCode from "qrcode";
import { DEFAULT_GRAPHICS, GRAPHICS_OPTIONS } from "./graphics-settings.js";
import { bettingSecondsRemaining } from "./betting-window.js";

// The TV overlay is rendered entirely as raycastable WebGL meshes.
export function createSceneUI(renderer, onAction) {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
  camera.position.z = 1000;
  const raycaster = new THREE.Raycaster(),
    panels = {},
    interactive = [];
  let current = {},
    lastKey = "",
    qrURL = "",
    qr = null,
    logo = null,
    settingsPage = "main",
    viewWidth = 960,
    alive = true;
  const C = {
    ink: "#eee8db",
    muted: "#a7b5ae",
    gold: "#c7ab73",
    line: "rgba(199,171,115,.28)",
  };
  function panel(id, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.renderOrder = 50;
    mesh.userData = { id, buttons: [] };
    scene.add(mesh);
    interactive.push(mesh);
    panels[id] = { mesh, canvas, ctx: canvas.getContext("2d"), texture, w, h };
  }
  panel("brand", 205, 86);
  panel("settingsButton", 48, 48);
  panel("settings", 304, 368);
  panel("graphics", 320, 414);
  panel("join", 286, 126);
  panel("status", 410, 62);
  panel("intro", 430, 174);
  const img = new Image();
  img.onload = () => {
    if (alive) {
      logo = img;
      redraw();
    }
  };
  img.src = assetURL("brand-logo.png");
  function begin(p, glass = true) {
    const c = p.ctx;
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, p.w, p.h);
    p.mesh.userData.buttons = [];
    if (glass) {
      const g = c.createLinearGradient(0, 0, p.w, p.h);
      g.addColorStop(0, "rgba(12,28,24,.97)");
      g.addColorStop(1, "rgba(5,13,11,.91)");
      c.fillStyle = g;
      c.beginPath();
      c.roundRect(0.5, 0.5, p.w - 1, p.h - 1, 12);
      c.fill();
      c.strokeStyle = C.line;
      c.lineWidth = 1;
      c.stroke();
    }
    return c;
  }
  function text(c, str, x, y, size = 13, color = C.ink, weight = 500) {
    c.fillStyle = color;
    c.font = `${weight} ${size}px Manrope,Arial,sans-serif`;
    c.fillText(String(str), x, y);
  }
  function finish(p) {
    p.texture.needsUpdate = true;
  }
  function gear(c, x, y, r) {
    c.strokeStyle = C.gold;
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2,
        rr = i % 5 === 0 || i % 5 === 1 ? r : r * 0.78;
      const px = x + Math.cos(a) * rr,
        py = y + Math.sin(a) * rr;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.closePath();
    c.stroke();
    c.beginPath();
    c.arc(x, y, r * 0.3, 0, Math.PI * 2);
    c.stroke();
  }
  function redraw() {
    const {
      state,
      code,
      status,
      sound,
      error,
      cameraMode,
      settingsOpen,
      sceneLoading,
      graphics = DEFAULT_GRAPHICS,
      graphicsInfo = {},
      introActive,
      bettingSeconds = 0,
    } = current;
    let p = panels.brand,
      c = begin(p, false);
    if (logo) {
      const ratio = logo.width / logo.height,
        w = 194,
        h = w / ratio;
      c.drawImage(logo, 5, (p.h - h) / 2, w, h);
    }
    finish(p);
    p = panels.settingsButton;
    c = begin(p);
    gear(c, 24, 24, 12);
    p.mesh.userData.buttons = [
      { x: 0, y: 0, w: 48, h: 48, action: "settings" },
    ];
    finish(p);
    p = panels.settings;
    p.mesh.visible = !!settingsOpen && settingsPage === "main";
    c = begin(p);
    text(c, "TABLE SETTINGS", 19, 31, 11, C.gold, 700);
    text(c, "×", p.w - 33, 32, 24, C.muted);
    p.mesh.userData.buttons = [
      { x: p.w - 52, y: 0, w: 52, h: 48, action: "settings" },
    ];
    const rows = [
      ["sound", "Announcer", sound ? "ON" : "OFF"],
      ["camera", "Camera", (cameraMode || "auto").toUpperCase()],
      ["copy", "Copy invite", "↗"],
      ["join", "Phone controller", "↗"],
      ["fullscreen", "Fullscreen", "⛶"],
      ["graphics", "Graphics", "›"],
    ];
    rows.forEach(([action, label, value], i) => {
      const y = 55 + i * 48;
      c.strokeStyle = C.line;
      c.beginPath();
      c.moveTo(17, y - 6);
      c.lineTo(p.w - 17, y - 6);
      c.stroke();
      text(c, label, 19, y + 22, 13);
      c.textAlign = "right";
      text(c, value, p.w - 22, y + 22, 11, C.gold, 600);
      c.textAlign = "left";
      p.mesh.userData.buttons.push({ x: 0, y: y - 5, w: p.w, h: 48, action });
    });
    finish(p);
    p = panels.graphics;
    p.mesh.visible = !!settingsOpen && settingsPage === "graphics";
    c = begin(p);
    text(c, "‹ Back", 17, 31, 12, C.gold, 600);
    text(c, "GRAPHICS", 96, 31, 11, C.gold, 700);
    text(c, "×", p.w - 33, 32, 24, C.muted);
    p.mesh.userData.buttons = [
      { x: 0, y: 0, w: 86, h: 46, action: "graphics:back" },
      { x: p.w - 52, y: 0, w: 52, h: 46, action: "settings" },
    ];
    const graphicsLabels = {
      fps: "Frame rate",
      antialias: "Antialiasing",
      resolution: "Resolution",
      modelDetail: "Model detail",
      textures: "Textures",
    };
    Object.entries(graphicsLabels).forEach(([key, label], i) => {
      const y = 55 + i * 42;
      c.strokeStyle = C.line;
      c.beginPath();
      c.moveTo(17, y - 7);
      c.lineTo(p.w - 17, y - 7);
      c.stroke();
      const value = graphics[key] ?? "auto";
      const option = GRAPHICS_OPTIONS[key].find((o) => o.value === value);
      text(c, label, 18, y + 18, 13);
      c.textAlign = "right";
      text(
        c,
        `${option?.label || "Auto"}  ›`,
        p.w - 18,
        y + 18,
        11,
        C.gold,
        600,
      );
      c.textAlign = "left";
      p.mesh.userData.buttons.push({
        x: 0,
        y: y - 6,
        w: p.w,
        h: 42,
        action: `graphics:${key}`,
      });
    });
    const measured = Number.isFinite(graphicsInfo.fps)
      ? `${Math.round(graphicsInfo.fps)} FPS`
      : "FPS pending";
    const device = String(graphicsInfo.device || "This display");
    text(
      c,
      device.length > 40 ? `${device.slice(0, 37)}…` : device,
      18,
      282,
      10,
      C.muted,
    );
    text(
      c,
      graphicsInfo.status === "testing"
        ? "Measuring this display…"
        : `${measured} · ${graphicsInfo.resolution || "Auto resolution"}`,
      18,
      301,
      11,
      C.ink,
      600,
    );
    text(
      c,
      `Textures: ${graphicsInfo.textureLabel || "Auto"}`,
      18,
      320,
      10,
      C.muted,
    );
    c.fillStyle = "rgba(199,171,115,.12)";
    c.beginPath();
    c.roundRect(16, 340, p.w - 32, 43, 7);
    c.fill();
    text(
      c,
      graphicsInfo.status === "testing"
        ? "Restart graphics check"
        : "Retest automatic settings",
      29,
      367,
      12,
      C.gold,
      600,
    );
    p.mesh.userData.buttons.push({
      x: 16,
      y: 340,
      w: p.w - 32,
      h: 43,
      action: "graphics:retest",
    });
    text(
      c,
      "Auto adapts to this display. Tap a row to change.",
      18,
      401,
      9,
      C.muted,
    );
    finish(p);
    p = panels.join;
    p.mesh.visible = !settingsOpen || viewWidth >= 700;
    c = begin(p);
    text(c, "JOIN TABLE", 17, 24, 9, C.gold, 700);
    text(c, code || "······", 16, 64, 30, C.ink, 600);
    const url = current.joinURL ? new URL(current.joinURL) : null;
    text(
      c,
      url ? `${url.host}${url.pathname}` : "Connecting…",
      17,
      89,
      9,
      C.muted,
    );
    text(
      c,
      status === "connected"
        ? current.fallbackJoinURL
          ? `IP ${new URL(current.fallbackJoinURL).host}/join`
          : "Scan with your phone"
        : status === "disconnected"
          ? "Connection lost"
          : "Connecting…",
      17,
      109,
      10,
      C.muted,
    );
    if (qr) c.drawImage(qr, 199, 20, 72, 72);
    p.mesh.userData.buttons = [
      {
        x: 0,
        y: 0,
        w: p.w,
        h: p.h,
        action: status === "disconnected" ? "reconnect" : "join",
      },
    ];
    finish(p);
    p = panels.status;
    c = begin(p);
    p.mesh.visible =
      !settingsOpen &&
      !introActive &&
      (state?.status === "playing" ||
        state?.status === "ended" ||
        !!error ||
        status !== "connected" ||
        sceneLoading);
    let heading = "Connecting",
      detail = "";
    if (state?.status === "playing") {
      heading = state.rolling
        ? "Dice rolling"
        : state.point
          ? `POINT ${state.point}`
          : "COME OUT";
      const shooter = state.players.find((p) => p.id === state.shooterId);
      detail = state.rolling
        ? "Bets closed"
        : bettingSeconds > 0
          ? `Betting open · ${bettingSeconds}s before the next roll`
          : `${shooter?.name || "Host"} to roll${state.lastRoll ? ` · ${state.lastRoll.dice.join(" + ")} = ${state.lastRoll.total}` : ""}`;
    }
    if (state?.status === "ended") {
      heading = "SESSION CLOSED";
      detail = "Recaps are ready on your phones";
    }
    if (sceneLoading && !error) {
      heading = "Loading table…";
      detail = "";
    }
    if (error) {
      heading = "NOTICE";
      detail = error;
    }
    c.textAlign = "center";
    text(c, heading, p.w / 2, 27, 16, C.ink, 700);
    text(
      c,
      detail.length > 65 ? detail.slice(0, 62) + "…" : detail,
      p.w / 2,
      47,
      10,
      C.muted,
    );
    c.textAlign = "left";
    finish(p);
    p = panels.intro;
    p.mesh.visible = !!introActive && !settingsOpen;
    c = begin(p);
    const testing = graphicsInfo.status !== "ready";
    text(
      c,
      testing ? "GETTING YOUR TABLE READY" : "CRAPSTV",
      20,
      27,
      10,
      C.gold,
      700,
    );
    text(
      c,
      testing ? "Checking graphics performance" : "Your table is ready",
      20,
      58,
      20,
      C.ink,
      600,
    );
    text(
      c,
      testing
        ? "A short check tunes graphics for this display."
        : `${measured} · ${graphicsInfo.resolution || "Automatic resolution"}`,
      20,
      82,
      11,
      C.muted,
    );
    const progress = Math.max(
      0,
      Math.min(1, graphicsInfo.progress ?? (testing ? 0 : 1)),
    );
    c.fillStyle = "rgba(199,171,115,.18)";
    c.fillRect(20, 99, p.w - 40, 4);
    c.fillStyle = C.gold;
    c.fillRect(20, 99, (p.w - 40) * progress, 4);
    text(
      c,
      testing
        ? "You can change these choices in Graphics."
        : "Automatic choices can be changed at any time.",
      20,
      126,
      10,
      C.muted,
    );
    text(c, "Graphics settings  ›", 20, 153, 11, C.gold, 600);
    p.mesh.userData.buttons = [
      { x: 15, y: 135, w: 180, h: 32, action: "graphics:open" },
    ];
    finish(p);
  }
  function resize(w, h) {
    viewWidth = w;
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / 2000));
    camera.updateProjectionMatrix();
    const small = w < 650;
    const place = (id, x, y, s = 1) => {
      const p = panels[id];
      p.mesh.scale.setScalar(s);
      p.mesh.position.set(
        x - w / 2 + (p.w * s) / 2,
        h / 2 - y - (p.h * s) / 2,
        0,
      );
    };
    place("settingsButton", small ? 12 : 24, small ? 14 : 24);
    place("brand", small ? 64 : 82, small ? 0 : 4, small ? 0.76 : 1);
    place(
      "settings",
      small ? 12 : 24,
      small ? 70 : 84,
      Math.min(1, (w - 24) / 304, (h - 100) / 368),
    );
    place(
      "graphics",
      small ? 12 : 24,
      small ? 70 : 84,
      Math.min(1, (w - 24) / 320, (h - 100) / 414),
    );
    const js = small ? 0.8 : 1;
    place("join", w - 286 * js - (small ? 12 : 24), small ? 78 : 24, js);
    const ss = Math.min(1, (w - 28) / 410);
    place("status", (w - 410 * ss) / 2, h - 62 * ss - 20, ss);
    const introScale = Math.min(1, (w - 32) / 430);
    place(
      "intro",
      (w - 430 * introScale) / 2,
      Math.max(150, (h - 174 * introScale) / 2),
      introScale,
    );
    redraw();
  }
  function update(next) {
    if (!next.settingsOpen && current.settingsOpen) settingsPage = "main";
    current = { ...next, bettingSeconds: bettingSecondsRemaining(next.state) };
    const key = JSON.stringify([
      next.code,
      next.status,
      next.sound,
      next.error,
      next.cameraMode,
      next.settingsOpen,
      next.sceneLoading,
      next.graphics,
      Math.round(next.graphicsInfo?.fps || 0),
      next.graphicsInfo?.resolution,
      next.graphicsInfo?.device,
      next.graphicsInfo?.status,
      next.graphicsInfo?.textureLabel,
      Math.round((next.graphicsInfo?.progress || 0) * 100),
      next.introActive,
      next.introReducedMotion,
      next.fallbackJoinURL,
      next.state?.status,
      next.state?.point,
      next.state?.rolling,
      current.bettingSeconds,
      next.state?.lastRoll?.id,
      next.state?.shooterId,
      next.state?.players.map((p) => [p.id, p.name]),
    ]);
    if (next.joinURL && next.joinURL !== qrURL && next.code) {
      qrURL = next.joinURL;
      const canvas = document.createElement("canvas");
      QRCode.toCanvas(canvas, qrURL, {
        margin: 1,
        width: 180,
        color: { dark: "#091914", light: "#f0e7d6" },
      })
        .then(() => {
          if (alive) {
            qr = canvas;
            redraw();
          }
        })
        .catch(() => {});
    }
    if (key !== lastKey) {
      lastKey = key;
      redraw();
    }
  }
  function pick(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((x - r.left) / r.width) * 2 - 1,
        1 - ((y - r.top) / r.height) * 2,
      ),
      camera,
    );
    scene.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(
      interactive.filter((m) => m.visible),
    );
    for (const hit of hits) {
      const p = panels[hit.object.userData.id],
        px = hit.uv.x * p.w,
        py = (1 - hit.uv.y) * p.h;
      const b = hit.object.userData.buttons.find(
        (b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h,
      );
      if (b) return b.action;
    }
    return null;
  }
  return {
    scene,
    camera,
    resize,
    update,
    pick,
    get settingsPage() {
      return settingsPage;
    },
    setSettingsPage(page) {
      settingsPage = page === "graphics" ? "graphics" : "main";
      redraw();
    },
    activate(action) {
      if (action === "graphics" || action === "graphics:open") {
        settingsPage = "graphics";
        if (!current.settingsOpen) onAction("settings");
        redraw();
      } else if (action === "graphics:back") {
        settingsPage = "main";
        redraw();
      } else onAction(action);
    },
    dispose() {
      alive = false;
      for (const p of Object.values(panels)) {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        p.texture.dispose();
      }
    },
  };
}
