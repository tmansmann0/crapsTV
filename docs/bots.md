# Bots and host controls

The host can add named bots from **Players → Add bot**, choose a play style and
difficulty, and remove bots between throws. People and bots share twelve seats.
Only people can host or receive host controls.

| Style | Behaviour |
| --- | --- |
| Pass & odds | Uses the pass line and backs established points with odds. |
| Six & eight | Builds place bets on 6 and 8. |
| Iron cross | Combines 5, 6, 8 and the field after a point is established. |
| Press & collect | Varies collecting and pressing within its bankroll budget. |
| Don’t pass | Uses the don't side in classic craps; adapts to pass/odds in crapless. |

Casual, Regular and Advanced change betting complexity and bankroll management.
They use the same dice, payouts and validation as human players. Strategies are
small deterministic plans of at most eight actions, made once per betting window;
they do not run each animation frame or search future outcomes. The same room
authority schedules them in Node and in a browser-hosted online room.

**Bot roll delay** defaults to five extra seconds after the ordinary betting
window. A ten-second betting window plus five-second bot delay means an automatic
bot throw waits fifteen seconds. The host can change both values in **Table**.
The public countdown includes that extra time; human/host manual throw eligibility
still follows the ordinary betting window. Bots pause when no human controller
remains connected, and their pending actions stop when the table closes.

The host panel has **Table**, **Players** and **TV** tabs. Game setup and timing
stay together, bot forms show visual play styles, and advanced graphics live in
the TV section. The same panel works before and during a game. Its design was
reviewed with Claude Desktop, including actual 375px screenshots.

Verification includes real rule simulations across both variants and awkward
minimums, bounded fake-clock scheduling, and an isolated real-phone flow through
named bots, host handoff, a five-second delay, a natural physical throw, bot
removal and closing the table. Run `npm run test:bots` and
`npm run test:admin-ui` for the browser checks.
