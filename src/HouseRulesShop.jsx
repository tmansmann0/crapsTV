import { Sparkles } from "lucide-react";
import { money } from "./game.js";
import {
  DEFAULT_HOUSE_RULES,
  HOUSE_RULES,
  activeHouseRulePass,
  formatHouseRulePayout,
  houseRuleOffer,
} from "./house-rules.js";

const describeValue = {
  hardPoint: (value) => `${formatHouseRulePayout(value)} Pass Line payout`,
  hotHand: (value) => `${value}% extra profit`,
  crapsCashback: (value) => `${value}% of your stake back`,
  luckySeven: (value) => `${formatHouseRulePayout(value)} Pass Line payout`,
  tableJackpot: (value) => `${money(value)} jackpot`,
};

export default function HouseRulesShop({
  state,
  player,
  connected,
  rules,
  send,
}) {
  const config = state.config.houseRules;
  return (
    <section className="pg-rule-shop" aria-label="House Rules">
      <h2>
        <Sparkles aria-hidden="true" /> House Rules
      </h2>
      <p>
        Buy personal perks with chips. Each completed table roll counts toward
        their duration.
      </p>
      <ul>
        {rules.map((rule) => {
          const { label, detail, setting } = HOUSE_RULES[rule];
          const offer = houseRuleOffer(config, rule);
          const pass = activeHouseRulePass(player, rule, state.rolls.length);
          const terms = pass ?? offer;
          const remaining = pass
            ? pass.expiresAfterRoll - state.rolls.length
            : offer.rolls;
          const value =
            pass?.value ??
            (setting
              ? (config?.[setting] ?? DEFAULT_HOUSE_RULES[setting])
              : undefined);
          return (
            <li key={rule} className="pg-rule-shop-card">
              <h3>{label}</h3>
              <p>
                {rule === "secondWind"
                  ? "When you shoot, an initial 7 can be rerolled once."
                  : detail}
              </p>
              {describeValue[rule] && (
                <strong>{describeValue[rule](value)}</strong>
              )}
              <dl>
                <div>
                  <dt>Trigger chance</dt>
                  <dd>{terms.chance}%</dd>
                </div>
                <div>
                  <dt>{pass ? "Rolls left" : "Duration"}</dt>
                  <dd>
                    {remaining} {remaining === 1 ? "roll" : "rolls"}
                  </dd>
                </div>
              </dl>
              {pass ? (
                <strong className="pg-rule-active">Active</strong>
              ) : (
                <button
                  type="button"
                  className="button"
                  aria-label={`Buy ${label} for ${money(offer.price)} in chips`}
                  disabled={
                    !connected ||
                    state.rolling ||
                    !!state.pausedAt ||
                    player.bank < offer.price
                  }
                  onClick={() =>
                    send({
                      type: "buy-house-rule",
                      rule,
                      quote: {
                        ...offer,
                        value,
                        completedRolls: state.rolls.length,
                      },
                    })
                  }
                >
                  {player.bank < offer.price
                    ? `Need ${money(offer.price)} in chips`
                    : `Buy for ${money(offer.price)}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
