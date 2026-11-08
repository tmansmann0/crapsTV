import { assetURL } from "./asset-url.js";
import * as THREE from "three";
import QRCode from "qrcode";
import { DEFAULT_GRAPHICS, GRAPHICS_OPTIONS } from "./graphics-settings.js";
import { bettingSecondsRemaining } from "./betting-window.js";
import { money } from "./game.js";
import {
  createTVLayout,
  TV_TYPE,
  TV_UI_STORAGE_KEY,
  TV_LABEL_STORAGE_KEY,
  TV_LABEL_MOTIONS,
  normalizeLabelMotion,
  fitJoinAddress,
  JOIN_CARD,
} from "./tv-layout.js";

// The TV overlay is rendered entirely as raycastable WebGL meshes.
export function createSceneUI(renderer, onAction) {
  let uiSize = "compact",
    labelMotion = "smooth";
  try {
    uiSize =
      localStorage.getItem(TV_UI_STORAGE_KEY) === "large" ? "large" : "compact";
  } catch {
    /* Storage may be unavailable in private contexts. */
  }
  try {
    labelMotion = normalizeLabelMotion(
      localStorage.getItem(TV_LABEL_STORAGE_KEY),
    );
  } catch {
    /* Retain the default when storage is unavailable. */
  }
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
    qrVersion = 0,
    logo = null,
    settingsPage = "main",
    layout = createTVLayout(1920, 1080, { uiSize, labelMotion }),
    revision = 0,
    alive = true,
    presentationOpacity = 1,
    fontsReady = !document.fonts,
    logoReady = false;
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
    panels[id] = {
      mesh,
      canvas,
      ctx: canvas.getContext("2d"),
      texture,
      w,
      h,
      backingScale: 2,
    };
  }
  for (const [id, box] of Object.entries(layout.panels))
    panel(id, box.logicalWidth, box.logicalHeight);
  if (document.fonts)
    Promise.all([
      document.fonts.load("600 36px Manrope"),
      document.fonts.load("700 78px Manrope"),
      document.fonts.ready,
    ])
      .finally(() => {
        fontsReady = true;
        if (alive) redraw();
      })
      .catch(() => {});
  const img = new Image();
  img.onload = () => {
    logoReady = true;
    if (alive) {
      logo = img;
      redraw();
    }
  };
  img.onerror = () => {
    logoReady = true;
  };
  img.src = assetURL("brand-logo.png");
  function begin(p, glass = true) {
    const c = p.ctx;
    c.setTransform(p.backingScale, 0, 0, p.backingScale, 0, 0);
    c.clearRect(0, 0, p.w, p.h);
    p.mesh.userData.buttons = [];
    p.mesh.userData.textMetrics = [];
    if (glass) {
      const g = c.createLinearGradient(0, 0, p.w, p.h);
      g.addColorStop(0, "rgba(12,28,24,.97)");
      g.addColorStop(1, "rgba(5,13,11,.91)");
      c.fillStyle = g;
      c.beginPath();
      c.roundRect(0.5, 0.5, p.w - 1, p.h - 1, 18);
      c.fill();
      c.strokeStyle = C.line;
      c.lineWidth = 1;
      c.stroke();
    }
    return c;
  }
  function text(
    c,
    str,
    x,
    y,
    size = 36,
    color = C.ink,
    weight = 500,
    importance = "primary",
  ) {
    c.fillStyle = color;
    c.font = `${weight} ${size}px Manrope,Arial,sans-serif`;
    const value = String(str),
      metrics = c.measureText(value);
    const panel = Object.values(panels).find((panel) => panel.ctx === c);
    panel?.mesh.userData.textMetrics.push({
      text: value,
      importance,
      fontSize: size,
      x,
      y,
      align: c.textAlign,
      ascent: metrics.actualBoundingBoxAscent,
      descent: metrics.actualBoundingBoxDescent,
      left: metrics.actualBoundingBoxLeft,
      right: metrics.actualBoundingBoxRight,
      glyphHeight:
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      glyphWidth:
        metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
      cssGlyphHeight:
        (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) *
        panel.mesh.scale.y,
      backingGlyphHeight:
        (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) *
        panel.backingScale,
    });
    c.fillText(value, x, y);
  }
  function finish(p) {
    // Countdown/FPS updates redraw all canvases, but static corners should not
    // upload multi-megapixel textures again when only the status text changed.
    const key = JSON.stringify([
      p.canvas.width,
      p.canvas.height,
      p.mesh.userData.textMetrics,
      p.mesh.userData.id === "brand" && !!logo,
      p.mesh.userData.id === "join" && qrVersion,
    ]);
    if (key !== p.drawKey) {
      p.drawKey = key;
      p.texture.needsUpdate = true;
    }
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
  function fittedText(
    c,
    str,
    x,
    y,
    size,
    maxWidth,
    color = C.ink,
    weight = 500,
  ) {
    const minimumSize = Math.min(36, size);
    c.font = `${weight} ${size}px Manrope,Arial,sans-serif`;
    while (c.measureText(String(str)).width > maxWidth && size > minimumSize) {
      size -= 1;
      c.font = `${weight} ${size}px Manrope,Arial,sans-serif`;
    }
    const value = String(str);
    let shown = value;
    while (c.measureText(shown).width > maxWidth && shown.length > 2)
      shown = shown.slice(0, -2) + "…";
    text(c, shown, x, y, size, color, weight);
  }
  function redraw() {
    revision++;
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
      const w = 250,
        h = w / (logo.width / logo.height);
      c.drawImage(logo, 3, (p.h - h) / 2, w, h);
    }
    finish(p);
    p = panels.settingsButton;
    c = begin(p);
    gear(c, 44, 44, 25);
    p.mesh.userData.buttons = [
      { x: 0, y: 0, w: 88, h: 88, action: "settings" },
    ];
    finish(p);

    p = panels.settings;
    p.mesh.visible = !!settingsOpen && settingsPage === "main";
    c = begin(p);
    text(c, "TABLE SETTINGS", 28, 49, 36, C.gold, 700);
    text(c, "×", p.w - 54, 51, 42, C.muted);
    p.mesh.userData.buttons = [
      { x: p.w - 88, y: 0, w: 88, h: 76, action: "settings" },
    ];
    const rows = [
      ["sound", "Announcer", sound ? "ON" : "OFF"],
      ["camera", "Camera", (cameraMode || "auto").toUpperCase()],
      ["copy", "Copy invite", "↗"],
      ["join", "Phone controller", "↗"],
      ["fullscreen", "Fullscreen", "⛶"],
      ["graphics", "Graphics", "›"],
      ["ui-size", "UI size", uiSize === "large" ? "LARGE" : "COMPACT"],
      ["labels", "Labels", labelMotion.toUpperCase()],
    ];
    rows.forEach(([action, label, value], i) => {
      const y = 92 + i * 76;
      c.strokeStyle = C.line;
      c.beginPath();
      c.moveTo(26, y - 10);
      c.lineTo(p.w - 26, y - 10);
      c.stroke();
      text(c, label, 28, y + 32, TV_TYPE.setting);
      c.textAlign = "right";
      text(c, value, p.w - 30, y + 32, 38, C.gold, 600);
      c.textAlign = "left";
      p.mesh.userData.buttons.push({ x: 0, y: y - 10, w: p.w, h: 76, action });
    });
    finish(p);

    p = panels.graphics;
    p.mesh.visible =
      !!settingsOpen && ["graphics", "effects"].includes(settingsPage);
    c = begin(p);
    const effectsPage = settingsPage === "effects";
    text(
      c,
      effectsPage ? "‹ Graphics" : "‹ Back",
      26,
      49,
      effectsPage ? 30 : 36,
      C.gold,
      600,
    );
    text(c, effectsPage ? "EFFECTS" : "GRAPHICS", 218, 49, 36, C.gold, 700);
    text(c, "×", p.w - 54, 51, 42, C.muted);
    p.mesh.userData.buttons = [
      {
        x: 0,
        y: 0,
        w: 166,
        h: 76,
        action: effectsPage ? "effects:back" : "graphics:back",
      },
      { x: p.w - 88, y: 0, w: 88, h: 76, action: "settings" },
    ];
    const labels = effectsPage
      ? {
          lensFlares: "Lens flares",
          localReflections: "Local reflections",
          contactShadows: "Contact shadows",
        }
      : {
          fps: "Frame rate",
          antialias: "Antialiasing",
          resolution: "Resolution",
          modelDetail: "Model detail",
          textures: "Textures",
        };
    Object.entries(labels).forEach(([key, label], i) => {
      const rowHeight = effectsPage ? 110 : 64;
      const y = 91 + i * rowHeight;
      c.strokeStyle = C.line;
      c.beginPath();
      c.moveTo(26, y - 10);
      c.lineTo(p.w - 26, y - 10);
      c.stroke();
      const option = GRAPHICS_OPTIONS[key].find(
        (o) => o.value === (graphics[key] ?? DEFAULT_GRAPHICS[key]),
      );
      text(c, label, 28, y + 31, TV_TYPE.setting);
      c.textAlign = "right";
      fittedText(
        c,
        `${option?.label || "Auto"}  ›`,
        p.w - 28,
        y + 31,
        38,
        300,
        C.gold,
        600,
      );
      c.textAlign = "left";
      if (effectsPage)
        text(
          c,
          {
            lensFlares: "Small glints from room lights",
            localReflections:
              graphicsInfo.reflectionsSupported === false
                ? "Unavailable on this renderer"
                : "Nearby objects in glossy surfaces",
            contactShadows:
              graphicsInfo.contactShadowsSupported === false
                ? "Unavailable on this renderer"
                : "Sharper chip and dice grounding",
          }[key],
          28,
          y + 68,
          26,
          C.muted,
        );
      p.mesh.userData.buttons.push({
        x: 0,
        y: y - 10,
        w: p.w,
        h: rowHeight,
        action: `graphics:${key}`,
      });
    });
    if (effectsPage) {
      text(c, "Off by default. Your choices are saved.", 28, 451, 28, C.muted);
    } else {
      c.fillStyle = "rgba(199,171,115,.12)";
      c.beginPath();
      c.roundRect(24, 414, p.w - 48, 56, 10);
      c.fill();
      text(c, "Effects", 42, 452, 36, C.gold, 600);
      c.textAlign = "right";
      text(c, "›", p.w - 42, 452, 36, C.gold, 600);
      c.textAlign = "left";
      p.mesh.userData.buttons.push({
        x: 24,
        y: 414,
        w: p.w - 48,
        h: 56,
        action: "graphics:effects",
      });
    }
    const measured = Number.isFinite(graphicsInfo.fps)
      ? `${Math.round(graphicsInfo.fps)} FPS`
      : "FPS pending";
    fittedText(
      c,
      graphicsInfo.device || "This display",
      28,
      508,
      30,
      p.w - 56,
      C.muted,
    );
    fittedText(
      c,
      graphicsInfo.status === "testing"
        ? "Measuring this display…"
        : `${measured} · 3D ${graphicsInfo.resolution || "Auto"}`,
      28,
      548,
      36,
      p.w - 56,
    );
    fittedText(
      c,
      `UI ${graphicsInfo.uiResolution || "Native"} · Maps ${graphicsInfo.textureLabel || "Auto"}`,
      28,
      586,
      36,
      p.w - 56,
      C.muted,
    );
    c.fillStyle = "rgba(199,171,115,.12)";
    c.beginPath();
    c.roundRect(24, 620, p.w - 48, 68, 10);
    c.fill();
    text(
      c,
      graphicsInfo.status === "testing"
        ? "Restart graphics check"
        : "Retest automatic settings",
      42,
      664,
      36,
      C.gold,
      600,
    );
    p.mesh.userData.buttons.push({
      x: 24,
      y: 620,
      w: p.w - 48,
      h: 68,
      action: "graphics:retest",
    });
    finish(p);

    p = panels.join;
    p.mesh.visible = !settingsOpen || !layout.compact;
    c = begin(p);
    // A compact invitation: the room code leads, with the QR isolated in a
    // warm paper inset so the two ways to join have distinct visual groups.
    c.fillStyle = C.gold;
    c.beginPath();
    c.moveTo(29, 25);
    c.lineTo(35, 31);
    c.lineTo(29, 37);
    c.lineTo(23, 31);
    c.closePath();
    c.fill();
    text(c, "JOIN TABLE", 46, 38, 22, C.gold, 700, "secondary");
    fittedText(c, code || "······", 22, 105, 72, 378, C.ink, 700);
    c.strokeStyle = "rgba(199,171,115,.22)";
    c.beginPath();
    c.moveTo(409, 25);
    c.lineTo(409, 185);
    c.stroke();
    c.fillStyle = "#f0e7d6";
    c.beginPath();
    c.roundRect(422, 15, 160, 180, 12);
    c.fill();
    const address = fitJoinAddress(current.joinURL, (value, size) => {
      c.font = `600 ${size}px Manrope,Arial,sans-serif`;
      return c.measureText(value).width;
    });
    address.lines.forEach((line, index) =>
      text(
        c,
        line,
        JOIN_CARD.addressX,
        JOIN_CARD.addressBaselines[index],
        address.size,
        index ? C.muted : C.ink,
        600,
      ),
    );
    p.mesh.userData.joinAddress = address;
    if (qr) {
      c.imageSmoothingEnabled = false;
      c.drawImage(
        qr,
        JOIN_CARD.qr.x,
        JOIN_CARD.qr.y,
        JOIN_CARD.qr.size,
        JOIN_CARD.qr.size,
      );
      c.imageSmoothingEnabled = true;
    }
    c.textAlign = "center";
    text(
      c,
      status === "disconnected" ? "TAP TO RECONNECT" : "SCAN TO JOIN",
      502,
      183,
      16,
      "#233c31",
      700,
      "secondary",
    );
    c.textAlign = "start";
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
      detail = "",
      headingColor = C.ink;
    if (state?.status === "playing") {
      const roll = state.lastRoll;
      const kind = {
        natural: "WINNER",
        craps: "CRAPS",
        "point-hit": "POINT MADE",
        "seven-out": "SEVEN OUT",
      }[roll?.kind];
      const point = state.point ? `POINT ${state.point}` : "COME OUT";
      heading = state.rolling
        ? "DICE ROLLING"
        : roll
          ? `${roll.total} · ${kind || point}`
          : point;
      const shooter =
        state.players.find((p) => p.id === state.shooterId)?.name || "Host";
      detail = state.rolling
        ? "Bets closed"
        : bettingSeconds > 0
          ? `Betting open · ${bettingSeconds}s${layout.compact ? "" : ` · ${shooter} next`}`
          : `${shooter} to roll · Betting open`;
      const focus = current.cameraFocus;
      if (!state.rolling && focus?.phase === "outcome-player") {
        const delta = focus.delta || 0;
        heading = `${focus.name} · ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${money(Math.abs(delta))}`;
        headingColor = delta > 0 ? "#c4e1b5" : delta < 0 ? "#edb6a5" : C.ink;
        const outcomes = (focus.bets || []).map(
          (bet) =>
            `${bet.label || "Bet"} ${bet.result === "win" ? "won" : bet.result === "lose" ? "lost" : "returned"}`,
        );
        detail = outcomes.slice(0, 2).join(" · ") || "Resolving wagers";
        if (outcomes.length > 2) detail += ` · +${outcomes.length - 2} more`;
      } else if (!state.rolling && focus?.phase === "outcome-group") {
        const events = (state.lastRoll?.events || []).filter((event) =>
          focus.playerIds?.includes(event.playerId),
        );
        const total = events.reduce((sum, event) => sum + event.delta, 0);
        const names = events.map((event) => event.name);
        const group =
          names.length === 2
            ? names.join(" + ")
            : `${focus.playerCount} players`;
        heading = `${group} · ${total > 0 ? "+" : total < 0 ? "−" : ""}${money(Math.abs(total))}`;
        headingColor = total > 0 ? "#c4e1b5" : total < 0 ? "#edb6a5" : C.ink;
        const outcomes = events.flatMap((event) => event.bets || []);
        const labels = [...new Set(outcomes.map((bet) => bet.label))];
        const results = new Set(outcomes.map((bet) => bet.result));
        detail =
          labels.length === 1 && results.size === 1
            ? `${labels[0]} ${outcomes[0].result === "win" ? "wins" : outcomes[0].result === "lose" ? "lost" : "returned"}`
            : "Wagers resolved";
        if (bettingSeconds > 0) detail += ` · ${bettingSeconds}s to roll`;
      } else if (!state.rolling && focus?.phase === "idle-player") {
        const player = state.players.find((p) => p.id === focus.playerId);
        if (player) {
          heading = player.name;
          detail = `Bank ${money(player.bank)} · ${bettingSeconds > 0 ? `Betting open · ${bettingSeconds}s` : `${shooter} to roll`}`;
        }
      }
    }
    if (state?.status === "ended") {
      heading = "SESSION CLOSED";
      detail = "Your recaps are on your phones";
    }
    if (sceneLoading && !error) {
      heading = "Loading table…";
      detail = "";
    }
    if (error) {
      heading = "NOTICE";
      detail = error;
      headingColor = C.ink;
    }
    c.textAlign = "center";
    fittedText(
      c,
      heading,
      p.w / 2,
      70,
      TV_TYPE.result,
      p.w - 56,
      headingColor,
      700,
    );
    fittedText(
      c,
      detail,
      p.w / 2,
      123,
      TV_TYPE.status,
      p.w - 56,
      bettingSeconds > 0 ? C.gold : C.muted,
      600,
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
      30,
      47,
      36,
      C.gold,
      700,
    );
    text(
      c,
      testing ? "Checking graphics" : "Your table is ready",
      30,
      100,
      40,
      C.ink,
      700,
    );
    fittedText(
      c,
      testing
        ? "A quick check for this display."
        : `${measured} · ${graphicsInfo.resolution || "Automatic resolution"}`,
      30,
      145,
      36,
      p.w - 60,
      C.muted,
    );
    const progress = Math.max(
      0,
      Math.min(1, graphicsInfo.progress ?? (testing ? 0 : 1)),
    );
    c.fillStyle = "rgba(199,171,115,.18)";
    c.fillRect(30, 172, p.w - 60, 8);
    c.fillStyle = C.gold;
    c.fillRect(30, 172, (p.w - 60) * progress, 8);
    text(c, "You can change graphics in Settings.", 30, 224, 36, C.muted);
    text(c, "Graphics settings  ›", 30, 279, 36, C.gold, 600);
    p.mesh.userData.buttons = [
      { x: 20, y: 243, w: p.w - 40, h: 58, action: "graphics:open" },
    ];
    finish(p);
  }
  function resize(w, h) {
    layout = createTVLayout(w, h, {
      uiSize,
      labelMotion,
      pixelRatio: renderer.getPixelRatio?.() || 1,
      maxTextureSize: renderer.capabilities?.maxTextureSize || 4096,
    });
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / 2000));
    camera.updateProjectionMatrix();
    for (const [id, box] of Object.entries(layout.panels)) {
      const p = panels[id];
      if (p.w !== box.logicalWidth || p.h !== box.logicalHeight) {
        p.mesh.geometry.dispose();
        p.w = box.logicalWidth;
        p.h = box.logicalHeight;
        p.mesh.geometry = new THREE.PlaneGeometry(p.w, p.h);
      }
      if (
        p.canvas.width !== box.backingWidth ||
        p.canvas.height !== box.backingHeight
      ) {
        // Release immutable GPU storage before changing canvas dimensions.
        p.texture.dispose();
        p.canvas.width = box.backingWidth;
        p.canvas.height = box.backingHeight;
      }
      p.backingScale = box.backingScale;
      p.mesh.scale.setScalar(box.scale);
      p.mesh.position.set(
        box.x - w / 2 + box.width / 2,
        h / 2 - box.y - box.height / 2,
        0,
      );
    }
    redraw();
  }
  function update(next) {
    if (!next.settingsOpen && current.settingsOpen) settingsPage = "main";
    current = { ...next, bettingSeconds: bettingSecondsRemaining(next.state) };
    const key = JSON.stringify([
      next.code,
      next.joinURL,
      next.status,
      next.sound,
      next.error,
      next.cameraMode,
      next.settingsOpen,
      next.sceneLoading,
      next.graphics,
      Math.round(next.graphicsInfo?.fps || 0),
      next.graphicsInfo?.resolution,
      next.graphicsInfo?.uiResolution,
      next.graphicsInfo?.device,
      next.graphicsInfo?.reflectionsSupported,
      next.graphicsInfo?.contactShadowsSupported,
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
      next.cameraFocus?.shotKey,
      next.cameraFocus &&
        next.state?.players.find((p) => p.id === next.cameraFocus.playerId)
          ?.bank,
      next.state?.players.map((p) => [p.id, p.name]),
    ]);
    if (next.joinURL && next.joinURL !== qrURL && next.code) {
      qrURL = next.joinURL;
      const canvas = document.createElement("canvas");
      QRCode.toCanvas(canvas, qrURL, {
        margin: 1,
        width: 512,
        color: { dark: "#091914", light: "#f0e7d6" },
      })
        .then(() => {
          if (alive) {
            qr = canvas;
            qrVersion++;
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
    if (presentationOpacity < 0.98) return null;
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
  function getActionPoints() {
    if (presentationOpacity < 0.98) return {};
    const points = {};
    for (const [id, p] of Object.entries(panels)) {
      if (!p.mesh.visible) continue;
      const box = layout.panels[id];
      for (const button of p.mesh.userData.buttons) {
        if (points[button.action]) continue;
        const left = box.x + button.x * box.scale;
        const top = box.y + button.y * box.scale;
        const width = button.w * box.scale;
        const height = button.h * box.scale;
        points[button.action] = {
          x: left + width / 2,
          y: top + height / 2,
          left,
          top,
          width,
          height,
          panel: id,
        };
      }
    }
    return points;
  }
  return {
    scene,
    camera,
    get isReady() {
      return fontsReady && logoReady;
    },
    get opacity() {
      return presentationOpacity;
    },
    setPresentation(opacity) {
      const next = Math.max(0, Math.min(1, opacity));
      if (next >= 0.98 !== presentationOpacity >= 0.98) revision++;
      presentationOpacity = next;
      scene.visible = next > 0.001;
      scene.position.y = -(1 - next) * 18;
      for (const p of Object.values(panels)) p.mesh.material.opacity = next;
    },
    get layout() {
      return layout;
    },
    get revision() {
      return revision;
    },
    get labelMotion() {
      return labelMotion;
    },
    get textMetrics() {
      return Object.fromEntries(
        Object.entries(panels).map(([id, p]) => [
          id,
          {
            visible: p.mesh.visible,
            ...layout.panels[id],
            lines: p.mesh.userData.textMetrics || [],
            ...(id === "join"
              ? { address: p.mesh.userData.joinAddress, qr: JOIN_CARD.qr }
              : {}),
          },
        ]),
      );
    },
    resize,
    update,
    pick,
    getLayout() {
      return layout;
    },
    getActionPoints,
    getVisibleRects() {
      if (presentationOpacity < 0.98) return [];
      return Object.entries(panels)
        .filter(([, p]) => p.mesh.visible)
        .map(([id]) => ({ id, ...layout.panels[id] }));
    },
    get settingsPage() {
      return settingsPage;
    },
    setSettingsPage(page) {
      settingsPage = ["graphics", "effects"].includes(page) ? page : "main";
      redraw();
    },
    activate(action) {
      if (action === "ui-size") {
        uiSize = uiSize === "large" ? "compact" : "large";
        try {
          localStorage.setItem(TV_UI_STORAGE_KEY, uiSize);
        } catch {
          /* The in-session preference still works without storage. */
        }
        resize(layout.width, layout.height);
      } else if (action === "labels") {
        labelMotion =
          TV_LABEL_MOTIONS[
            (TV_LABEL_MOTIONS.indexOf(labelMotion) + 1) %
              TV_LABEL_MOTIONS.length
          ];
        try {
          localStorage.setItem(TV_LABEL_STORAGE_KEY, labelMotion);
        } catch {
          /* Keep the in-session preference without storage. */
        }
        resize(layout.width, layout.height);
      } else if (action === "graphics" || action === "graphics:open") {
        settingsPage = "graphics";
        if (!current.settingsOpen) onAction("settings");
        redraw();
      } else if (action === "graphics:effects") {
        settingsPage = "effects";
        redraw();
      } else if (action === "effects:back") {
        settingsPage = "graphics";
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
