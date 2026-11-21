import { useState } from "react";
import { ArrowRight } from "lucide-react";

export function ReconnectSeat({ connected, onReconnect }) {
  const [code, setCode] = useState("");
  return (
    <details className="reconnect-seat">
      <summary>Reconnect a seat</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (connected && code.trim()) onReconnect(code.trim());
        }}
      >
        <label>
          Private reconnect code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={128}
            required
          />
        </label>
        <button
          type="submit"
          className="button outline"
          disabled={!connected || !code.trim()}
        >
          Reconnect
        </button>
      </form>
    </details>
  );
}

export default function SavedTable({
  player,
  isAdmin,
  token,
  connected,
  onResume,
  onReconnect,
}) {
  const [showCode, setShowCode] = useState(false);
  return (
    <main className="phone-page">
      <section className="waiting-card" aria-labelledby="saved-title">
        <h2 id="saved-title">Table saved</h2>
        <p>
          {isAdmin
            ? "Your game is saved. You can close or update CrapsTV and return to this controller."
            : "The host can resume this game. Use the same controller when play resumes."}
        </p>
        {isAdmin && (
          <button
            className="button dark"
            type="button"
            disabled={!connected}
            onClick={onResume}
          >
            Resume table <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {!player && (
          <ReconnectSeat connected={connected} onReconnect={onReconnect} />
        )}
        {player && token && (
          <div className="saved-room-code">
            <button
              type="button"
              className="text-button"
              aria-expanded={showCode}
              onClick={() => setShowCode(!showCode)}
            >
              {showCode ? "Hide reconnect code" : "Show reconnect code"}
            </button>
            {showCode && (
              <>
                <p>
                  Keep this code private. Use it if your controller link changes
                  after the update.
                </p>
                <input
                  readOnly
                  value={token}
                  aria-label="Your private reconnect code"
                  onFocus={(event) => event.target.select()}
                />
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
