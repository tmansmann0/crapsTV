import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Music2,
  Search,
  SkipForward,
  X,
} from "lucide-react";
import { money } from "./game.js";
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
  bank,
  playing,
  inline = false,
  send,
  onClose,
}) {
  const dialog = useRef(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!inline) dialog.current.showModal();
  }, [inline]);
  const queued = new Set([
    state.current?.id,
    ...state.queue.map((track) => track.id),
  ]);
  const control = (action, payload) =>
    send({ type: "jukebox-control", action, ...payload });
  const canRequest = connected && state.mode !== "off";
  const canQueue =
    canRequest && (state.cost === 0 || (playing && bank >= state.cost));
  const content = (
    <>
      <header className="jukebox-heading">
        <Music2 size={23} aria-hidden="true" />
        <h2 id="jukebox-title">Music requests</h2>
        {!inline && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close music requests"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        )}
      </header>
      <p className="jukebox-price">
        {state.cost
          ? `${money(state.cost)} in chips per song`
          : "Free requests"}{" "}
        · Up to {state.limit} queued per player
      </p>
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
        {canRequest && !canQueue && (
          <p>
            {playing
              ? "You need more available chips to queue a song."
              : "Songs can be purchased once the table opens."}
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
                disabled={!canQueue || queued.has(track.id)}
                aria-label={`Queue ${track.title}`}
                onClick={() =>
                  send({
                    type: "jukebox-request",
                    trackId: track.id,
                    cost: state.cost,
                  })
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
            {state.queue.map((track, index) => (
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
                  <span className="jukebox-order">
                    <button
                      type="button"
                      className="icon-button"
                      disabled={!connected || index === 0}
                      aria-label={`Move ${track.title} up`}
                      onClick={() => control("move-up", { trackId: track.id })}
                    >
                      <ArrowUp size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={!connected || index === state.queue.length - 1}
                      aria-label={`Move ${track.title} down`}
                      onClick={() =>
                        control("move-down", { trackId: track.id })
                      }
                    >
                      <ArrowDown size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={!connected}
                      aria-label={`Remove ${track.title}`}
                      onClick={() => control("remove", { trackId: track.id })}
                    >
                      <X size={18} />
                    </button>
                  </span>
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
    </>
  );
  if (inline)
    return (
      <section className="jukebox-panel" aria-labelledby="jukebox-title">
        {content}
      </section>
    );
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
      {content}
    </dialog>
  );
}
