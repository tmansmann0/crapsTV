import { useEffect, useRef } from "react";
import { Play, X } from "lucide-react";
import { MUSIC_TRACKS } from "./table-audio.js";

function Level({ label, value, onChange }) {
  const percent = Math.round(value * 100);
  return (
    <label className="table-audio-level">
      <span>{label}</span>
      <span className="table-audio-value" aria-hidden="true">
        {percent ? `${percent}%` : "Off"}
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={percent}
        onChange={(event) => onChange(event.target.valueAsNumber / 100)}
      />
    </label>
  );
}

export default function TableAudioDialog({
  settings,
  ready,
  onChange,
  onPreview,
  onClose,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const update = (key, value) => onChange({ ...settings, [key]: value });
  return (
    <dialog
      ref={dialog}
      className="table-audio-dialog"
      aria-labelledby="table-audio-title"
      onClose={onClose}
    >
      <header>
        <h2 id="table-audio-title">Table audio</h2>
        <button
          type="button"
          autoFocus
          aria-label="Close table audio"
          onClick={onClose}
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <Level
        label="Dice and chips"
        value={settings.effects}
        onChange={(value) => update("effects", value)}
      />
      <Level
        label="Room ambience"
        value={settings.ambience}
        onChange={(value) => update("ambience", value)}
      />
      <label className="table-audio-track">
        <span>Music</span>
        <select
          value={settings.music}
          onChange={(event) => update("music", event.target.value)}
        >
          {Object.entries(MUSIC_TRACKS).map(([id, title]) => (
            <option value={id} key={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {settings.music !== "off" && (
        <Level
          label="Music volume"
          value={settings.musicVolume}
          onChange={(value) => update("musicVolume", value)}
        />
      )}
      <footer>
        <button type="button" onClick={onPreview}>
          <Play size={16} aria-hidden="true" /> Test effects
        </button>
        {!ready && (
          <span role="status">Press Test effects to enable sound.</span>
        )}
      </footer>
    </dialog>
  );
}
