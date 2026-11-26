import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Disc3,
  ListMusic,
  Music2,
  Search,
  SlidersHorizontal,
  SkipForward,
  X,
} from "lucide-react";
import { money } from "./game.js";
import "./jukebox.css";

const REQUEST_MODES = {
  open: "Automatic",
  approval: "Host approval",
  off: "Paused",
};

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
        <span className="jukebox-mark">
          <Music2 size={20} aria-hidden="true" />
        </span>
        <div>
          <h2 id="jukebox-title">Music requests</h2>
          <p className="jukebox-price">
            {state.cost
              ? `${money(state.cost)} in chips per song`
              : "Free requests"}
            {" · "}Up to {state.limit} queued per player
          </p>
        </div>
        {!inline && (
          <button
            type="button"
            className="jukebox-icon"
            aria-label="Close music requests"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        )}
      </header>
      <form
        className="jukebox-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRequest && !search.pending && query.trim().length >= 2)
            send({ type: "jukebox-search", query });
        }}
      >
        <label className="jukebox-field">
          <Search size={19} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search YouTube by song or artist"
            placeholder="Song or artist"
            value={query}
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => setQuery(event.target.value)}
            disabled={!canRequest}
          />
        </label>
        <button
          type="submit"
          className="jukebox-button jukebox-search-button"
          disabled={!canRequest || search.pending || query.trim().length < 2}
        >
          Search
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
      {state.current && (
        <section className="jukebox-now" aria-labelledby="jukebox-playing">
          <span className="jukebox-disc">
            <Disc3 size={23} aria-hidden="true" />
          </span>
          <div>
            <h3 id="jukebox-playing">Now playing</h3>
            <Track track={state.current} requester />
          </div>
          {isHost && (
            <button
              type="button"
              className="jukebox-button jukebox-skip"
              disabled={!connected}
              onClick={() => control("skip")}
            >
              <SkipForward size={16} aria-hidden="true" /> Skip
            </button>
          )}
        </section>
      )}
      {!!search.tracks?.length && (
        <section className="jukebox-section" aria-labelledby="jukebox-results">
          <h3 id="jukebox-results">Search results</h3>
          <ul
            className="jukebox-list jukebox-results"
            aria-label="Search results"
          >
            {search.tracks.map((track) => (
              <li key={track.id}>
                <Track track={track} />
                <button
                  className="jukebox-button"
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
        </section>
      )}
      <section className="jukebox-section" aria-label="Playback queue">
        <header className="jukebox-section-heading">
          <h3>Queue</h3>
          <span>
            {state.queue.length} {state.queue.length === 1 ? "song" : "songs"}
          </span>
        </header>
        {state.notice && (
          <p className="jukebox-feedback" aria-live="polite">
            {state.notice}
          </p>
        )}
        {state.queue.length ? (
          <ol className="jukebox-list" aria-label="Up next">
            {state.queue.map((track, index) => (
              <li
                key={track.id}
                className={isHost ? "jukebox-managed" : undefined}
              >
                <Track track={track} requester />
                {track.pending && !isHost && (
                  <small className="jukebox-pending">Pending</small>
                )}
                {isHost && (
                  <div className="jukebox-order">
                    {track.pending && (
                      <button
                        type="button"
                        className="jukebox-button"
                        disabled={!connected}
                        onClick={() =>
                          control("approve", { trackId: track.id })
                        }
                      >
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      className="jukebox-icon"
                      disabled={!connected || index === 0}
                      aria-label={`Move ${track.title} up`}
                      onClick={() => control("move-up", { trackId: track.id })}
                    >
                      <ArrowUp size={18} />
                    </button>
                    <button
                      type="button"
                      className="jukebox-icon"
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
                      className="jukebox-icon"
                      disabled={!connected}
                      aria-label={`Remove ${track.title}`}
                      onClick={() => control("remove", { trackId: track.id })}
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="jukebox-empty">
            <ListMusic size={21} aria-hidden="true" />
            <p>{state.current ? "Nothing up next." : "No songs queued."}</p>
          </div>
        )}
      </section>
      {isHost && (
        <details className="jukebox-management">
          <summary>
            <SlidersHorizontal size={17} aria-hidden="true" />
            <span>Request settings</span>
            <small>{REQUEST_MODES[state.mode]}</small>
            <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <label className="jukebox-mode">
            Request mode
            <select
              aria-label="Request mode"
              value={state.mode}
              disabled={!connected}
              onChange={(event) =>
                control("mode", { mode: event.target.value })
              }
            >
              <option value="open">Queue automatically</option>
              <option value="approval">Host approval</option>
              <option value="off">Pause new requests</option>
            </select>
          </label>
          {(state.current || state.queue.length > 0) && (
            <button
              type="button"
              className="jukebox-button jukebox-clear"
              disabled={!connected}
              onClick={() => control("clear")}
            >
              Stop and clear queue
            </button>
          )}
        </details>
      )}
    </>
  );
  if (inline)
    return (
      <section
        className="jukebox jukebox-panel"
        aria-labelledby="jukebox-title"
      >
        {content}
      </section>
    );
  return (
    <dialog
      ref={dialog}
      className="modal jukebox jukebox-dialog"
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
