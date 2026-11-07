# Rules, accounting, and networking

## The ledger

Money is represented as integer cents. Placing a bet transfers its stake from cash to the felt; it does not create a loss yet. Equity is cash plus all live stakes. Winning a closing bet returns stake plus profit; winning a persistent bet pays profit while its stake stays on the felt. Net result is equity minus all buy-ins. A re-up contributes only the amount needed to restore the starting stack. The recap chart records net after every roll and at join, re-up, and cash-out.

The minimum is at least $1. Starting chips are $10–$1,000,000. Bets must be integers, fit the cash balance, and respect a proper denomination. For example, place 6/8 uses $6 increments, place 3/11 uses $4 increments, and a pass-odds bet at point 6 uses $5 increments. Selecting a $5 chip automatically shows the proper $6 wager for place 6; the amount is visible before the click. Odds may be added up to five times the parent stake. Bets never borrow chips.

The base pass/come contract cannot be removed after it travels to a point. Its odds can be removed. Don’t bets and their odds can be taken down. Cashing out intentionally closes the player's entire session and returns all unresolved stakes; closing the table does this for everyone.

## Supported house rules

Classic come-out: pass/come wins on 7 or 11; loses on 2, 3, 12; other totals establish the bet’s point. Don’t pass/don’t come wins on 2/3, loses on 7/11, pushes on 12. Once a point exists, pass/come wins if that point repeats before 7; don’t wins on 7 before the point.

Crapless come-out: only 7 wins immediately, every other total establishes a point. There is no don’t side. Individual come bets retain their own points, independent of the table point.

The shooter continues after a point hit or come-out craps. A seven-out passes the dice to the next connected active player. The admin may roll for the table. The authority locks betting for 1.7 seconds before producing two independent, unbiased cryptographic die values; the meshes animate to match those values.

| Wager | Profit payout | Resolution |
| --- | --- | --- |
| Pass / come | 1:1 | Own point or come-out |
| Don’t pass / don’t come | 1:1 | Reverse of own point; 12 pushes on come-out |
| Pass/come odds | 6 : ways to roll point | Same as parent; true odds |
| Don’t odds | ways to roll point : 6 | Same as parent; true odds |
| Place 4/10 | 9:5 | Number before 7 |
| Place 5/9 | 7:5 | Number before 7 |
| Place 6/8 | 7:6 | Number before 7 |
| Crapless place 2/12 | 11:2 | Number before 7 |
| Crapless place 3/11 | 11:4 | Number before 7 |
| Field | 1:1, 2 pays 2:1, 12 pays 3:1 | Next roll; 2/3/4/9/10/11/12 win |
| Hard 4/10 | 7:1 | Pair before 7 or easy total |
| Hard 6/8 | 9:1 | Pair before 7 or easy total |
| Any 7 | 4:1 | Next roll |
| 2/12 | 30:1 | Next roll |
| 3/11 | 15:1 | Next roll |
| Any craps | 7:1 | Next roll; 2/3/12 win |
| Big 6/8 | 1:1 | Number before 7, always working |

Place and hardway bets stay up on wins, and are off during a table come-out. Come-odds stakes are off on a table come-out; if the parent resolves, its odds stake returns without profit. Don’t-come odds stay working. A normal come contract always works, even during someone else's table come-out. True-odds payouts have zero house edge, but do not erase the edge on the line stake.

Teach-mode probabilities are per full bet decision (including the possibility of a push on a new don’t bet), not a prediction of the next roll. After a point, line probability changes to ways/(ways+6) or its reverse; on a fresh classic pass it is 49.2929%, on a fresh crapless pass 47.3087%. For place bets it is ways/(ways+6); hardways have one winning combination and lose to seven or the easy total. Field has 16 winning combinations out of 36. Payout schedules vary across real casinos; these are this game’s declared rules.

Primary references consulted:

- [Maryland standard craps rules](https://www.mdgaming.com/wp-content/uploads/2026/04/Craps-Standard-Rules-Version-1.5-accessible.pdf)
- [Maryland standard crapless rules](https://www.mdgaming.com/wp-content/uploads/2026/04/Crapless-Craps-Standard-Rules-Version-1.1-accessible.pdf) — includes the selected extreme-number place payouts.
- [Nevada crapless rules](https://www.gaming.nv.gov/siteassets/content/divisions/enforcement/rules-of-play/Crapless_Craps.pdf) — mode differences; its alternative extreme place schedule is **not** this game's schedule.

## Authority and identity

Both transports use the same `RoomHub`. It accepts commands rather than player-supplied states or results. The local authority is Node; online authority is the hosting browser. Incoming actions require a seat established by joining. The hub creates a random reconnect token and sends it only to that connection; public state never includes tokens. A client-supplied player ID cannot take another seat. The code is a party invitation, not a password; anyone with it can observe or join.

Names are rendered as React text, not HTML. SVG exports escape user text. Incoming local socket messages are limited to 8 KB; actions are rate limited. The local server rejects mismatching browser Origin/Host pairs and pings sockets to detect dropped connections. It is not an internet-facing hardened service and should be used on a trusted LAN.

A phone disconnect preserves its seat for reconnection. Explicit cash-out marks it left and produces a recap. If the admin cashes out, authority passes to a remaining player. The admin can also transfer controls manually. Reloading an online **host** destroys its in-memory authority; reloading a phone does not. Last observed state stays visible on a disconnected phone, and closing/cashing out through the controls is the supported way to receive a final recap.

## Online deployment

[PeerJS](https://peerjs.com/server/getting-started) uses its free public signaling server by default. Room IDs have a crapsTV namespace and six random, readable characters. The TV tab accepts WebRTC data connections and runs the same validated game engine. Signaling is not persistent storage and is not a substitute for a TURN relay. Network traversal and service availability can prevent online play; local WebSocket mode avoids this dependency entirely.

The web host is trusted to operate its own game. A person who edits their hosting code could bias their room; there is no third-party fairness certification, anti-cheat attestation, or real money.
