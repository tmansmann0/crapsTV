import * as THREE from "three";
import QRCode from "qrcode";
import { equity, money } from "./game.js";

// All visible TV controls are textured, raycastable meshes rendered in WebGL.
// The UI camera uses pixels as world units at the panel plane for readable text.
export function createSceneUI(renderer, onAction) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
  camera.position.z = 1000;
  const raycaster = new THREE.Raycaster();
  const panels = {},
    interactive = [];
  let width = 1,
    height = 1,
    lastKey = "",
    current = {},
    qrURL = "",
    qr = null,
    alive = true;
  const palette = {
    ink: "#f3ecdf",
    muted: "#aab9b1",
    gold: "#c7b188",
    green: "#c5e0bc",
  };
  function panel(id, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.renderOrder = 50;
    mesh.userData = { id, buttons: [] };
    scene.add(mesh);
    interactive.push(mesh);
    panels[id] = { mesh, canvas, ctx: canvas.getContext("2d"), texture, w, h };
    return panels[id];
  }
  panel("brand", 160, 48);
  panel("join", 304, 130);
  panel("players", 226, 420);
  panel("status", 480, 74);
  panel("controls", 600, 44);
  function begin(p, glass = true) {
    const c = p.ctx;
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, p.w, p.h);
    p.mesh.userData.buttons = [];
    if (glass) {
      c.fillStyle = "rgba(7,17,15,.86)";
      c.beginPath();
      c.roundRect(0, 0, p.w, p.h, 10);
      c.fill();
      c.strokeStyle = "rgba(199,177,136,.35)";
      c.lineWidth = 0.8;
      c.stroke();
    }
    return c;
  }
  function text(c, str, x, y, size = 13, color = palette.ink, weight = 500) {
    c.fillStyle = color;
    c.font = `${weight} ${size}px Manrope,Arial,sans-serif`;
    c.fillText(String(str), x, y);
  }
  function finish(p) {
    p.texture.needsUpdate = true;
  }
  function redraw() {
    const { state, code, status, sound, error, cameraMode } = current;
    let p = panels.brand,
      c = begin(p, false);
    text(c, "crapsTV", 6, 31, 27, palette.ink, 700);
    finish(p);
    p = panels.join;
    c = begin(p);
    text(c, "JOIN", 18, 25, 10, palette.gold, 700);
    text(c, code || "······", 17, 66, 32, palette.ink, 600);
    const url = current.joinURL ? new URL(current.joinURL) : null;
    text(
      c,
      url ? `${url.host}${url.pathname}` : "Connecting…",
      18,
      91,
      10,
      palette.muted,
    );
    text(
      c,
      status === "connected"
        ? "Scan or select to join"
        : status === "disconnected"
          ? "Connection lost"
          : status === "reconnecting"
            ? "Reconnecting…"
            : "Connecting…",
      18,
      112,
      10,
      palette.muted,
    );
    if (qr) c.drawImage(qr, 214, 19, 73, 73);
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
    p = panels.players;
    c = begin(p, false);
    const players = state?.players.filter((player) => !player.left) || [];
    p.mesh.visible = players.length > 0;
    if (players.length) {
      c.fillStyle = "rgba(7,17,15,.72)";
      c.beginPath();
      c.roundRect(0, 0, p.w, Math.min(players.length * 32 + 28, p.h), 9);
      c.fill();
      players.slice(0, 12).forEach((player, i) => {
        const y = 28 + i * 32;
        c.fillStyle = player.color;
        c.beginPath();
        c.arc(15, y - 4, 3, 0, Math.PI * 2);
        c.fill();
        text(c, player.name.slice(0, 14), 27, y, 12);
        c.textAlign = "right";
        text(c, money(equity(player)), p.w - 12, y, 12, palette.gold);
        c.textAlign = "left";
        if (player.id === state.shooterId)
          text(c, "●", 9, y + 9, 5, palette.gold);
      });
    }
    finish(p);
    p = panels.status;
    c = begin(p);
    let heading = "Connecting",
      detail = "";
    p.mesh.visible =
      state?.status === "playing" ||
      state?.status === "ended" ||
      !!error ||
      status !== "connected";
    if (state?.status === "playing") {
      heading = state.rolling
        ? "Dice rolling"
        : state.point
          ? `Point ${state.point}`
          : "Come out";
      const shooter = state.players.find((x) => x.id === state.shooterId);
      detail = state.rolling
        ? "Bets closed"
        : `${shooter?.name || "Host"} to roll${state.lastRoll ? ` · Last roll ${state.lastRoll.total}` : ""}`;
    }
    if (state?.status === "ended") {
      heading = "Session closed";
      detail = "Recaps are ready on your phones";
    }
    if (error) {
      heading = "Notice";
      detail = error;
    }
    c.textAlign = "center";
    text(c, heading, p.w / 2, 29, 19, palette.ink, 600);
    text(
      c,
      detail.length > 74 ? detail.slice(0, 71) + "…" : detail,
      p.w / 2,
      53,
      11,
      palette.muted,
    );
    c.textAlign = "left";
    finish(p);
    p = panels.controls;
    c = begin(p);
    const buttons = [
      ["sound", sound ? "Sound on" : "Sound off"],
      ["camera", `View: ${cameraMode || "auto"}`],
      ["copy", "Copy link"],
      ["join", "Controller"],
      ["fullscreen", "Fullscreen"],
    ];
    buttons.forEach(([action, label], i) => {
      const x = i * 120;
      if (i) {
        c.strokeStyle = "rgba(199,177,136,.2)";
        c.beginPath();
        c.moveTo(x, 12);
        c.lineTo(x, 32);
        c.stroke();
      }
      c.textAlign = "center";
      text(c, label, x + 60, 27, 11, palette.ink, 600);
      p.mesh.userData.buttons.push({ x, y: 0, w: 120, h: 44, action });
    });
    c.textAlign = "left";
    finish(p);
  }
  function resize(w, h) {
    width = w;
    height = h;
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / 2000));
    camera.updateProjectionMatrix();
    const small = w < 700;
    const place = (id, x, y, scale = 1) => {
      const p = panels[id];
      p.mesh.scale.setScalar(scale);
      p.mesh.position.set(
        x - w / 2 + (p.w * scale) / 2,
        h / 2 - y - (p.h * scale) / 2,
        0,
      );
    };
    place("brand", small ? 14 : 28, small ? 10 : 22, small ? 0.8 : 1);
    const joinScale = small ? 0.8 : 1;
    place(
      "join",
      w - panels.join.w * joinScale - (small ? 14 : 28),
      small ? 61 : 22,
      joinScale,
    );
    place("players", small ? 14 : 28, small ? 181 : 90, small ? 0.78 : 1);
    const controlScale = Math.min(1, (w - 28) / 600);
    place(
      "controls",
      (w - 600 * controlScale) / 2,
      h - 44 * controlScale - 18,
      controlScale,
    );
    const statusScale = Math.min(1, (w - 28) / 480);
    place(
      "status",
      (w - 480 * statusScale) / 2,
      h - 44 * controlScale - 30 - 74 * statusScale,
      statusScale,
    );
  }
  function update(next) {
    current = next;
    const key = JSON.stringify({
      code: next.code,
      status: next.status,
      sound: next.sound,
      error: next.error,
      cameraMode: next.cameraMode,
      state: next.state?.status,
      point: next.state?.point,
      rolling: next.state?.rolling,
      last: next.state?.lastRoll?.id,
      players: next.state?.players.map((p) => [
        p.id,
        p.name,
        p.bank,
        p.bets.reduce((n, b) => n + b.amount, 0),
        p.left,
        p.connected,
      ]),
      min: next.state?.config.minBet,
      mode: next.state?.config.mode,
    });
    if (next.joinURL && next.joinURL !== qrURL && next.code) {
      qrURL = next.joinURL;
      const canvas = document.createElement("canvas");
      QRCode.toCanvas(canvas, qrURL, {
        margin: 1,
        width: 180,
        color: { dark: "#0a1713", light: "#f3ecdf" },
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
  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    scene.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(
      interactive.filter((m) => m.visible),
    )[0];
    if (!hit) return null;
    const p = panels[hit.object.userData.id],
      x = hit.uv.x * p.w,
      y = (1 - hit.uv.y) * p.h;
    return (
      hit.object.userData.buttons.find(
        (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
      )?.action || null
    );
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
