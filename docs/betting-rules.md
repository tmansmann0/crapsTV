# Betting rules and wager IDs

All money is integer cents. Table minimums round up to each wager's legal whole-dollar payout increment. Payouts are profit ratios; resolving bets also return the stake. Standing winners keep their stake on the table.

| Wager ID      | Rule                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buy-N`       | All six classic points, all ten crapless points. True odds less 5% of the stake, charged only on wins. Off on come-out rolls. Winner stays up.        |
| `lay-N`       | Classic only. Seven before N; inverse true odds less 5% of gross winnings, charged only on wins. Always working, including come-out. Winner stays up. |
| `bonus-small` | Collect 2, 3, 4, 5, 6 before any seven; pays 34:1 once and comes down.                                                                                |
| `bonus-tall`  | Collect 8, 9, 10, 11, 12 before any seven; pays 34:1 once and comes down.                                                                             |
| `bonus-all`   | Collect all ten non-seven totals before any seven; pays 175:1 once and comes down.                                                                    |
| `hop-A-B`     | 21 unordered dice pairs, `1 <= A <= B <= 6`. One roll; doubles pay 30:1, mixed pairs 15:1. Other pairs with the same total lose.                      |

Bonus entry is available before the first roll or on the come-out immediately after a seven. Bonuses can be removed before their first roll; they become contracts once rolled. Table-wide `state.bonus.hits` records distinct totals since the last seven, survives made points, snapshots and reconnects, and resets on every seven, including come-out naturals. Each bonus bet carries `started` so take-down validation survives serialization. Catalogue rows expose `targets` and `progress`.

Pass/Come odds are 2:1 on 4/10, 3:2 on 5/9, and 6:5 on 6/8. Don't odds are their reciprocals. Total odds are capped at 5× the base stake on 4/10, 4× on 5/9, and 3× on 6/8. The other Crapless points use 5×. Odds can be taken down independently. A traveled Pass/Come contract stays up until it resolves. During come-out, a player's Pass Line stays up while any of their Buy bets remain on the table. A Don't contract can be taken down with its attached odds.

This game's deliberate house policy excludes opposing Pass/Don't Pass entries, opposing untraveled Come/Don't Come entries, and same-number Lay versus Buy/Place bets. This is not a universal prohibition on casino hedging. Traveled line contracts remain independent, and field, hardway, proposition, different-number and bonus hedges remain available. Catalogue `available` and `unavailableReason`, previews, legal amount choices and authoritative placement share these rules. `betRemovalLock(bet, bets)` gives the reason a wager must stay up.

The default betting window is 15 seconds.

## Primary references

- [Turning Stone casino rules](https://www.turningstone.com/gaming/table-games): Pass/Come/Buy true odds, reciprocal Lay odds, exact-pair Hop definitions.
- [Hollywood Casino Toledo official rack card](https://www.hollywoodcasinotoledo.com/-/media/png/east/hollywood-toledo/pdfs/table-games/craps-rackcard-4x9.pdf): Hop mixed-pair and double payouts; Don't Pass removal.
- [Borgata table games](https://borgata.mgmresorts.com/en/casino/table-games.html): crapless excludes Don't Pass, Don't Come and Lay bets.
- [Colorado Rule 23, Bonus Craps](https://sbg.colorado.gov/sites/sbg/files/Rule23%20050121.pdf): entry timing, qualifying totals, come-out seven losses and 34/175 payout schedule.
- [Hard Rock Bet odds guide](https://www.hardrock.bet/casino/how-to-play-craps/odds/): Buy commissions collected only on wins.
- [The Star official craps guide](https://www.star.com.au/sites/default/files/2024-09/Craps_Game_Guide.pdf): commission basis is Buy stake and Lay winnings. This game's disclosed win-only timing is a house choice; casinos also use upfront commissions.
