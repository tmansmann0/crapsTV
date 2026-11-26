import { useEffect, useRef, useState } from "react";
import { Music2, Search, SkipForward, X } from "lucide-react";
import "./jukebox.css";

function Track({ track, requester = false }) {
  const minutes = Math.floor(track.duration / 60);
  const seconds = String(track.duration % 60).padStart(2, "0");
  return (
    <span className="jukebox-track">
      <strong>{track.title}</strong>
      <small>
        {[
          track.artist,
          `${minutes}:${seconds}`,
          requester && `From ${track.requester}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </span>
  );
}

export default function Jukebox({
  state,
  search,
  isHost,
  connected,
  send,
  onClose,
}) {
  const dialog = useRef(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const queued = new Set([
    state.current?.id,
    ...state.queue.map((track) => track.id),
  ]);
  const control = (action, payload) =>
    send({ type: "jukebox-control", action, ...payload });
  const canRequest = connected && state.mode !== "off";
  return (
    <dialog
      ref={dialog}
      className="modal jukebox-dialog"
      aria-labelledby="jukebox-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="jukebox-heading">
        <Music2 size={23} aria-hidden="true" />
        <h2 id="jukebox-title">Music requests</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close music requests"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      {isHost && (
        <label className="jukebox-mode">
          Requests
          <select
            aria-label="Request mode"
            value={state.mode}
            disabled={!connected}
            onChange={(event) => control("mode", { mode: event.target.value })}
          >
            <option value="open">Queue automatically</option>
            <option value="approval">Host approval</option>
            <option value="off">Pause new requests</option>
          </select>
        </label>
      )}
      <form
        className="jukebox-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRequest && !search.pending && query.trim().length >= 2)
            send({ type: "jukebox-search", query });
        }}
      >
        <label htmlFor="jukebox-query" className="sr-only">
          Search YouTube by song or artist
        </label>
        <input
          id="jukebox-query"
          type="search"
          placeholder="Song or artist"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!canRequest}
        />
        <button
          className="button dark small"
          disabled={!canRequest || search.pending || query.trim().length < 2}
        >
          <Search size={16} /> Search
        </button>
      </form>
      <div className="jukebox-status" aria-live="polite">
        {!!search.error && <p role="alert">{search.error}</p>}
        {search.pending && <p>Searching YouTube…</p>}
        {!search.pending && search.tracks?.length === 0 && (
          <p>No matching tracks.</p>
        )}
        {!canRequest && (
          <p>
            {connected
              ? "The host paused new requests."
              : "Reconnecting to the table…"}
          </p>
        )}
      </div>
      {!!search.tracks?.length && (
        <ul className="jukebox-list" aria-label="Search results">
          {search.tracks.map((track) => (
            <li key={track.id}>
              <Track track={track} />
              <button
                className="button outline small"
                type="button"
                disabled={!canRequest || queued.has(track.id)}
                aria-label={`Queue ${track.title}`}
                onClick={() =>
                  send({ type: "jukebox-request", trackId: track.id })
                }
              >
                {queued.has(track.id) ? "Queued" : "Queue"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className="jukebox-queue" aria-label="Playback queue">
        <h3>{state.current ? "Now playing" : "Queue"}</h3>
        {state.notice && <p aria-live="polite">{state.notice}</p>}
        {state.current && (
          <div className="jukebox-now">
            <Track track={state.current} requester />
            {isHost && (
              <button
                type="button"
                className="button outline small"
                disabled={!connected}
                onClick={() => control("skip")}
              >
                <SkipForward size={16} /> Skip
              </button>
            )}
          </div>
        )}
        {state.queue.length ? (
          <ol className="jukebox-list" aria-label="Up next">
            {state.queue.map((track) => (
              <li key={track.id}>
                <Track track={track} requester />
                {track.pending &&
                  (isHost ? (
                    <button
                      type="button"
                      className="button outline small"
                      disabled={!connected}
                      onClick={() => control("approve", { trackId: track.id })}
                    >
                      Approve
                    </button>
                  ) : (
                    <small>Pending</small>
                  ))}
                {isHost && (
                  <button
                    type="button"
                    className="icon-button"
                    disabled={!connected}
                    aria-label={`Remove ${track.title}`}
                    onClick={() => control("remove", { trackId: track.id })}
                  >
                    <X size={18} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          !state.current && <p>No songs queued.</p>
        )}
        {isHost && (state.current || state.queue.length > 0) && (
          <button
            type="button"
            className="text-button jukebox-clear"
            disabled={!connected}
            onClick={() => control("clear")}
          >
            Stop and clear queue
          </button>
        )}
      </section>
    </dialog>
  );
}
