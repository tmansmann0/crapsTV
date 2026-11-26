import DrinkIcon from "./DrinkIcon.jsx";
import { drinkOfferLimit, money } from "./game.js";
import {
  DEFAULT_DRINKING_RULES,
  drinkDescription,
  drinkPrice,
  drinkUnits,
  drinkVerificationBot,
} from "./drinking-mode.js";
import "./drinks-panel.css";

function DrinkForm({
  kind,
  rules,
  player,
  peers,
  automaticTopUps,
  pending,
  locked,
  send,
  draft = {},
  updateDraft,
}) {
  const { unit: selectedUnit = "sip", quantity = "1", recipient = "" } = draft;
  const isOffer = kind === "offer";
  const to = peers.find((p) => p.id === recipient)?.id ?? peers[0]?.id;
  const units = drinkUnits(rules);
  const unit =
    units.find((option) => option.id === selectedUnit)?.id ?? units[0].id;
  const price = drinkPrice(rules, unit, kind);
  const count = unit === "finish" ? 1 : Number(quantity);
  const max = isOffer ? drinkOfferLimit(player, price) : undefined;
  const amount = count * price;
  const valid =
    Number.isSafeInteger(count) &&
    count > 0 &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    (!isOffer || count <= max);
  const disabled = locked || !!pending || !peers.length;
  const title = isOffer ? "Send a drink" : "Add chips";

  return (
    <section className="pg-drink-card">
      <div className="pg-drink-title">
        <DrinkIcon name={isOffer ? "offer" : "credit"} size={28} />
        <div>
          <h3>{title}</h3>
          <p>
            {isOffer
              ? "Use available chips to send a drink."
              : automaticTopUps
                ? "Log a drink after taking it to add chips automatically."
                : "Log a drink after taking it. Another player verifies the top-up."}
          </p>
        </div>
      </div>
      {pending ? (
        <div className="pg-drink-pending">
          <div>
            <strong>{money(pending.amount)} in chips</strong>
            <p>
              {isOffer
                ? "Sent · awaiting completion"
                : "Waiting for verification"}
              {" · "}
              {drinkDescription(pending.unit, pending.quantity)}
            </p>
          </div>
          {!isOffer && (
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                send({
                  type: "drink-response",
                  requestId: pending.id,
                  response: "cancel",
                })
              }
            >
              Cancel top-up
            </button>
          )}
        </div>
      ) : (
        <form
          className="pg-drink-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !valid) return;
            send({
              type: "drink-request",
              kind,
              unit,
              quantity: count,
              ...(isOffer && { to }),
            });
          }}
        >
          {isOffer && (
            <label className="pg-drink-person">
              To
              <select
                value={to ?? ""}
                disabled={!peers.length}
                onChange={(event) =>
                  updateDraft({ recipient: event.target.value })
                }
              >
                {!peers.length && (
                  <option value="">No other players online</option>
                )}
                {peers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="pg-drink-fields">
            <label>
              Drink
              <select
                value={unit}
                aria-label="Drink"
                onChange={(event) => updateDraft({ unit: event.target.value })}
              >
                {units.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} · {money(drinkPrice(rules, option.id, kind))}
                  </option>
                ))}
              </select>
            </label>
            {unit !== "finish" && (
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  max={max > 0 ? max : undefined}
                  step="1"
                  inputMode="numeric"
                  required
                  value={quantity}
                  onChange={(event) =>
                    updateDraft({ quantity: event.target.value })
                  }
                />
              </label>
            )}
          </div>
          {isOffer && rules.offerMarkup > 0 && (
            <p>Prices include the host’s {rules.offerMarkup}% markup.</p>
          )}
          {isOffer && count > max && (
            <p>
              {max
                ? `Your chips cover up to ${drinkDescription(unit, max)}.`
                : "You don’t have enough available chips for this option."}
            </p>
          )}
          <button className="pg-drink-primary" disabled={disabled || !valid}>
            {isOffer
              ? "Send a drink"
              : automaticTopUps
                ? "Add chips"
                : "Request verification"}
            {valid && (
              <span>
                {isOffer ? "−" : "+"}
                {money(amount)}
              </span>
            )}
          </button>
        </form>
      )}
    </section>
  );
}

export default function DrinksPanel({
  state,
  player,
  connected,
  send,
  drafts,
  setDrafts,
}) {
  const rules = state.config.drinkingRules ?? DEFAULT_DRINKING_RULES;
  const peers = state.players.filter(
    (p) => p.id !== player.id && !p.left && p.connected,
  );
  const automaticTopUps = !!drinkVerificationBot(peers);
  const requests = state.drinkRequests ?? [];
  const locked = !connected || state.rolling;
  const incoming = requests.filter(
    (request) =>
      request.from !== player.id &&
      (request.kind === "credit" || request.to === player.id),
  );
  return (
    <div className="pg-drinks">
      <header className="pg-drink-hero">
        <div>
          <h2>Drinks</h2>
          <p>Complete the drinks sent to you.</p>
        </div>
        <span className="pg-drink-emblem">
          <DrinkIcon name="mode" size={40} />
        </span>
        <dl>
          <div>
            <dt>Verified top-ups</dt>
            <dd>{money(player.buyIn)}</dd>
          </div>
          <div>
            <dt>Available chips</dt>
            <dd>{money(player.bank)}</dd>
          </div>
        </dl>
      </header>
      {state.rolling && (
        <p className="pg-drink-notice">
          You can edit your drink while the dice roll. Submit or verify when the
          dice land.
        </p>
      )}
      {!peers.length && (
        <p className="pg-drink-notice">
          Top-ups need another connected player or a bot.
        </p>
      )}
      {incoming.length > 0 && (
        <section className="pg-drink-card" aria-label="Incoming requests">
          <div className="pg-drink-title">
            <DrinkIcon name="verify" size={28} />
            <div>
              <h3>For you</h3>
              {incoming.some((request) => request.kind === "credit") && (
                <p>Approve a top-up only if you witnessed it.</p>
              )}
            </div>
          </div>
          {incoming.map((request) => {
            const sender = state.players.find((p) => p.id === request.from);
            const isCredit = request.kind === "credit";
            const canVerify = !isCredit || sender?.connected;
            const reply = (response) =>
              send({ type: "drink-response", requestId: request.id, response });
            return (
              <div className="pg-drink-incoming" key={request.id}>
                <strong>
                  {sender?.name} · {isCredit ? "Top-up" : "Required drink"}
                </strong>
                <p>
                  {drinkDescription(request.unit, request.quantity)}
                  {isCredit && ` · ${money(request.amount)} in chips`}
                </p>
                {!canVerify && <p>Waiting for the sender to reconnect.</p>}
                <div>
                  <button
                    type="button"
                    className="pg-drink-primary"
                    disabled={locked || !canVerify}
                    onClick={() => reply(isCredit ? "accept" : "complete")}
                  >
                    {isCredit ? "Verify top-up" : "Mark drink complete"}
                  </button>
                  {isCredit && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => reply("decline")}
                    >
                      Decline top-up
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {["credit", "offer"].map((kind) => (
        <DrinkForm
          key={kind}
          kind={kind}
          rules={rules}
          player={player}
          peers={peers}
          automaticTopUps={automaticTopUps}
          locked={locked}
          send={send}
          draft={drafts[kind]}
          updateDraft={(change) =>
            setDrafts((current) => ({
              ...current,
              [kind]: { ...current[kind], ...change },
            }))
          }
          pending={requests.find(
            (request) => request.from === player.id && request.kind === kind,
          )}
        />
      ))}
    </div>
  );
}
