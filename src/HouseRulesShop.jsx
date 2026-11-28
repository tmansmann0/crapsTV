import {
  Clover,
  Coins,
  Dices,
  Flame,
  Hourglass,
  Repeat2,
  Sparkles,
  Trophy,
  Wind,
} from "lucide-react";
import { money } from "./game.js";
import {
  DEFAULT_HOUSE_RULES,
  HOUSE_RULES,
  describeHouseRuleTarget,
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

const ruleIcons = {
  secondWind: Wind,
  hardPoint: Dices,
  hotHand: Flame,
  crapsCashback: Coins,
  luckySeven: Clover,
  passTheDice: Repeat2,
  tableJackpot: Trophy,
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
    <section
      className="pg-rule-shop"
      aria-labelledby="pg-rule-shop-title"
      tabIndex={0}
    >
      <header className="pg-rule-shop-heading">
        <h2 id="pg-rule-shop-title">
          <Sparkles size={22} aria-hidden="true" /> House Rules
        </h2>
        <p>
          Buy upgrades for the whole table. Each lasts for a set number of
          rolls.
        </p>
      </header>
      <ul>
        {rules.map(({ rule, pass }) => {
          const { label, detail, setting } = HOUSE_RULES[rule];
          const Icon = ruleIcons[rule] ?? Sparkles;
          const offer = houseRuleOffer(config, rule);
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
            <li
              key={rule}
              className={`pg-rule-shop-card${pass ? " is-active" : ""}`}
            >
              <div className="pg-rule-card-heading">
                <span className="pg-rule-icon">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <h3>{label}</h3>
                {pass && <span className="pg-rule-active">Active</span>}
              </div>
              <p>{detail}</p>
              {describeValue[rule] && (
                <strong className="pg-rule-value">
                  {describeValue[rule](value)}
                </strong>
              )}
              <dl>
                <div>
                  <dt>
                    <Dices size={13} aria-hidden="true" /> Trigger total
                  </dt>
                  <dd>{describeHouseRuleTarget(terms.target)}</dd>
                </div>
                <div>
                  <dt>
                    <Hourglass size={13} aria-hidden="true" />
                    {pass ? "Rolls left" : "Duration"}
                  </dt>
                  <dd>
                    {remaining} {remaining === 1 ? "roll" : "rolls"}
                  </dd>
                </div>
              </dl>
              {!pass && (
                <button
                  type="button"
                  className="button pg-rule-buy"
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
