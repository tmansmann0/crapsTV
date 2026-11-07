import { assetURL } from "./asset-url.js";
import * as THREE from "three";
import QRCode from "qrcode";

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
  panel("settings", 288, 316);
  panel("join", 286, 126);
  panel("status", 410, 62);
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
    const { state, code, status, sound, error, cameraMode, settingsOpen } =
      current;
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
    p.mesh.visible = !!settingsOpen;
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
    p = panels.join;
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
        ? "Scan with your phone"
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
      state?.status === "playing" ||
      state?.status === "ended" ||
      !!error ||
      status !== "connected";
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
        : `${shooter?.name || "Host"} to roll${state.lastRoll ? ` · ${state.lastRoll.dice.join(" + ")} = ${state.lastRoll.total}` : ""}`;
    }
    if (state?.status === "ended") {
      heading = "SESSION CLOSED";
      detail = "Recaps are ready on your phones";
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
  }
  function resize(w, h) {
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
      Math.min(1, (w - 24) / 288),
    );
    const js = small ? 0.8 : 1;
    place("join", w - 286 * js - (small ? 12 : 24), small ? 78 : 24, js);
    const ss = Math.min(1, (w - 28) / 410);
    place("status", (w - 410 * ss) / 2, h - 62 * ss - 20, ss);
  }
  function update(next) {
    current = next;
    const key = JSON.stringify([
      next.code,
      next.status,
      next.sound,
      next.error,
      next.cameraMode,
      next.settingsOpen,
      next.state?.status,
      next.state?.point,
      next.state?.rolling,
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
    activate: onAction,
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
