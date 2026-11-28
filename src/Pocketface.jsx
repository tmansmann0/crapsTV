import { useEffect, useRef, useState } from "react";
import { Camera, CircleUserRound, LoaderCircle, Smile, X } from "lucide-react";
import * as THREE from "three";
import {
  applyPocketface,
  fitPocketfacePhoto,
  openPocketface,
} from "./pocketface-runtime.js";
import {
  POCKETFACE_EMOTES,
  POCKETFACE_FACES,
  normalizePocketface,
} from "./pocketface-state.js";
import "./pocketface.css";

const shirts = [
  "#884c55",
  "#3c7566",
  "#d1974a",
  "#476482",
  "#846189",
  "#e6d5b6",
];
const hairColors = ["#392a28", "#744732", "#96704a", "#c3a166", "#71595a"];
const defaults = {
  face: 0,
  hair: 1,
  shirt: shirts[0],
  hairColor: hairColors[0],
};

function PocketfaceView({ profile, onHairOptions }) {
  const host = useRef(null);
  const latest = useRef({ profile, onHairOptions });
  latest.current = { profile, onHairOptions };
  const [status, setStatus] = useState("Loading Pocketface…");

  useEffect(() => {
    const mount = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setStatus("3D preview unavailable");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff3e2, 0xd6e4da, 2.1));
    const key = new THREE.DirectionalLight(0xfff4df, 2.2);
    key.position.set(-3, 4, 5);
    const rim = new THREE.DirectionalLight(0xcdede9, 1.1);
    rim.position.set(2, 3, -3);
    scene.add(key, rim);
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 25);
    camera.position.set(0, 1.95, 6.8);
    camera.lookAt(0, 1.37, 0);
    const observer = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      const span = Math.max(1.56, (1.15 * h) / w);
      camera.left = (-span * w) / h;
      camera.right = -camera.left;
      camera.top = span;
      camera.bottom = -span;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    observer.observe(mount);

    let avatar;
    let disposed = false;
    let rendered;
    let applying = false;
    let previous = 0;
    let frame;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");

    function draw(time) {
      frame = requestAnimationFrame(draw);
      if (time - previous < 31) return;
      const dt = previous ? Math.min(0.08, (time - previous) / 1000) : 0;
      previous = time;
      if (!avatar) return;
      const { profile: selected } = latest.current;
      if (selected !== rendered && !applying) {
        applying = true;
        const newFace =
          selected.face !== rendered?.face ||
          selected.photo !== rendered?.photo;
        applyPocketface(avatar, selected, newFace)
          .then(() => {
            if (disposed) return;
            rendered = selected;
            setStatus("");
          })
          .catch(() => {
            if (disposed) return;
            rendered = selected;
            setStatus("This portrait couldn’t be rendered");
          })
          .finally(() => {
            applying = false;
          });
      }
      if (!reduce.matches) avatar.update(dt);
      renderer.render(scene, camera);
    }
    openPocketface()
      .then((made) => {
        if (disposed) return made.dispose();
        avatar = made;
        scene.add(made.object);
        latest.current.onHairOptions?.(made.hairstyles);
        made.play(reduce.matches ? "Still" : "Idle");
        frame = requestAnimationFrame(draw);
      })
      .catch(() => {
        if (!disposed) setStatus("3D preview unavailable");
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      avatar?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="pf-view" aria-label="Animated Pocketface avatar">
      <div className="pf-render" ref={host} />
      {status && (
        <span className="pf-loading" role="status">
          {status}
        </span>
      )}
    </div>
  );
}

export function PocketfaceEditor({
  initial,
  onSave,
  disabled,
  submitLabel = "Save avatar",
}) {
  const [profile, setProfile] = useState(() => initial ?? defaults);
  const [styles, setStyles] = useState(["Bald", "Crop"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef(null);
  const update = (patch) => setProfile((current) => ({ ...current, ...patch }));
  async function load(event) {
    const picture = event.target.files?.[0];
    event.target.value = "";
    if (!picture) return;
    setBusy(true);
    setError("");
    try {
      const fitted = await fitPocketfacePhoto(picture);
      update(fitted);
    } catch (err) {
      setError(err.message || "Couldn’t read the portrait.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pf-editor">
      <PocketfaceView profile={profile} onHairOptions={setStyles} />
      <div className="pf-controls">
        <fieldset>
          <legend>Face</legend>
          <div className="pf-faces">
            {POCKETFACE_FACES.map((name, face) => (
              <button
                type="button"
                key={name}
                aria-pressed={!profile.photo && profile.face === face}
                onClick={() =>
                  setProfile(({ photo, points, ...style }) => ({
                    ...style,
                    face,
                  }))
                }
              >
                <span>{name}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={load}
          aria-label="Portrait photo"
        />
        <button
          className="button outline"
          type="button"
          onClick={() => file.current.click()}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle size={17} className="pf-spinner" />
          ) : (
            <Camera size={17} />
          )}
          {busy ? "Fitting portrait…" : "Use a photo"}
        </button>
        {error && <p role="alert">{error}</p>}
        <div className="pf-style">
          <label>
            Hair
            <select
              value={profile.hair}
              onChange={(event) => update({ hair: Number(event.target.value) })}
            >
              {styles.map((style, index) => (
                <option key={style} value={index}>
                  {style}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hair color{" "}
            <input
              type="color"
              value={profile.hairColor}
              onChange={(event) => update({ hairColor: event.target.value })}
            />
          </label>
          <label>
            Shirt{" "}
            <input
              type="color"
              value={profile.shirt}
              onChange={(event) => update({ shirt: event.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          className="button dark"
          disabled={disabled || busy}
          onClick={() => {
            const valid = normalizePocketface(profile);
            if (valid) onSave(valid);
            else setError("Choose a preset or try a different photo.");
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function PocketfaceDialog({
  label = "Your Pocketface",
  initial,
  onSave,
  onClose,
  disabled,
  error,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal pf-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
    >
      <header>
        <div>
          <span>Pocketface</span>
          <h2>{label}</h2>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close avatar editor"
          >
            <X size={21} />
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      <PocketfaceEditor initial={initial} onSave={onSave} disabled={disabled} />
    </dialog>
  );
}

export function PocketfaceActions({ open, send, ready }) {
  return (
    <div className="pf-actions">
      <button type="button" className="button outline" onClick={open}>
        <CircleUserRound size={17} />
        Avatar
      </button>
      {ready && (
        <details>
          <summary>
            <Smile size={17} />
            Emotes
          </summary>
          <div>
            {Object.keys(POCKETFACE_EMOTES).map((name) => (
              <button
                type="button"
                key={name}
                className="button outline"
                onClick={(event) => {
                  send({ type: "avatar-emote", name });
                  event.currentTarget.closest("details").open = false;
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
