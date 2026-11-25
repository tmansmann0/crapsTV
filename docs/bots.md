# Bots and host controls

Use **Host controls → Players** to add, edit, or remove named bots between throws.
People and bots share twelve seats. Only people can host or receive host controls.

| Personality | Preference |
| --- | --- |
| Balanced | Mixes line bets, odds, and number bets. |
| Steady | Plays smaller stakes and repeats familiar bets more often. |
| Social | Mixes up its bets and sends drinks more often in Drinking Mode. |
| Wild | Switches bets often and wagers more aggressively. |

Choose a preset, then use **Risk** to tune stake sizes and bankroll exposure,
**Bet variety** to tune how often strategies change, or **Drink generosity** to
tune how often the bot spends its available chips on drink assignments.
The authority runs one bounded plan per bot per betting window. The bot varies
its actions from one roll to the next and uses the same wager rules, payouts,
and physical throws as everyone else.

In **Drinking Mode**, bots start at zero and take simulated drinks at the
configured prices when they need chips. They can send drinks to people and
complete drinks assigned to them. Only people can verify human top-ups.
As a bot drinks, its choices and stake sizes vary more. That effect fades over
subsequent rolls.

**Bot roll delay** defaults to five seconds on top of the current betting
window. The host can change it under **Table**. Bots pause when no human
controller remains connected. A saved room retains its bots, personalities,
and simulated drinking state.

Run `npm run test:bots` and `npm run test:admin-ui` for browser checks.
