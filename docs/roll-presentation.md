# Camera shots and chip contacts

Auto opens on a wide lobby view and moves into a close, near-top-down betting view during play. Framing adapts to the display and interface panels to fill the view with the betting bed; some outer trays may sit outside the frame. Each authoritative throw selects one of four felt-level rigs **inside** the cushion corners at X ±5.0, Y 0.38, Z ±2.3. The recorded trajectory determines the corner, and that choice stays fixed throughout the throw, including on late joins. A gradual lens change keeps both dice framed as the camera follows their midpoint.

At the recorded settle time, the view cuts above the dice for up to 1.6 seconds to show their upper faces, with padding for the actual TV interface panels. If a short configured cooldown requires an earlier payout preparation shot, that shot takes priority once the physical throw has settled. Payout shots follow the same immutable schedule as the modeled chip transfers. Standout results can receive an individual shot, similar outcomes can share a shot, and grouped views frame the affected part of the table. Balanced rounds may use a wider collective payout. The schedule is deterministic for everyone watching the same round.

Each normal 1.8-second settlement slot reserves **450 ms with the camera already parked over the relevant chips**, then plays the 1.15-second transfer. The remaining time holds the result. Short windows group players and reserve a positive setup period first (at most 35% of a short slot), compressing the flight only when it cannot fit. Zero cooldown retains immediate settlement with no promised close-up window. The camera never extends the next-roll deadline.

Individual and related-group payout shots start on the actual source pile bounds, including the original held wager after the ledger has settled. The camera travels from the wager toward the bank or dealer in one move. The lens keeps the flying chips in view while the aim advances toward their landing position. Wider concurrent results use a focused overhead of their current moving chips. The eye lifts smoothly to clear the cushion.

Finite idle visits choose six deterministic shot families: a single-stack bank macro, bank overhead, bank sweep, low bet glide, overhead bet pass, and cross-angle bet sweep. Headings, lateral direction and gentle movement vary with the round and player. Bet passes use positive current wagers; without an active wager, the view visits a real bank rather than an emptied cell. Bank close-ups can isolate the tallest actual stack. Camera bounds use the same seeded chip poses as the renderer, and tall wagers increase both eye height and downward angle so their engraved upper faces remain visible.

The configured cooldown remains fixed. The director fits its shots into the available window and groups remaining payouts. The ledger settles immediately and the modeled chips move on the shared presentation timeline. Reconnecting displays seek to current and future transfers. After the initial idle visits, the camera rests over the table for 45 seconds and then visits up to three active players for three seconds apiece. Visits rotate through the active seats. A committed wager change can prompt a visit after 30 seconds of rest. With only one active player, a committed change is required for another visit. The banner shows the player's bank, current stake, and their last roll's gain or loss when applicable.

Normal left-drag orbits. **Shift + left-drag** pans the eye and target together, and the wheel can zoom in close. A manual gesture pauses automatic direction for 15 seconds after release. Explicit Table/Room views and reduced motion take priority. These camera decisions do not change the shared dice timeline.

Review captures: [felt-level throw](screenshots/throw-felt-level.png) · [close overhead betting view](screenshots/betting-close-overhead.png).

Payout direction captures: [standout win](screenshots/payout-hero.png) · [matching pair](screenshots/payout-pair.png) · [player-height view](screenshots/player-eye-view.png). Native 4K functional [QA results](benchmarks/tour-4k.json) verify the same transfer IDs and amounts as the selected shots, unchanged balances, and a held overview after the finite idle sequence. The sampled renderer counters were 59–60 FPS on the tested Mac; these counters are separate from the timed performance benchmarks.

Strong direct hits can disturb the top few modeled wager chips. Height, speed and approach checks release at most two stacks and three top chips per stack into the authority's dice simulation. Cannon computes the two-way contact impulses; no decorative impulse is added. Their lower stack and the felt remain collision supports. The recorded chip poses play alongside the dice, remain in place through the throw, and reset during the subsequent dealer presentation.

The authoritative simulation includes solid cylinders for visible wager stacks and a dynamic ON/OFF puck, so dice cannot pass through them. The puck's poses are recorded alongside the dice and replayed on the TV; its last physical position persists until a point change calls for dealer repositioning. Both upper faces are read from the final physical dice orientations.

Launch positions clear nearby stacks and the puck before simulation begins. The phone and TV aiming previews use the same clearance calculation; an existing wager cannot spawn inside a die and eject it on the first physics step.

The current physics timeline includes upper-chip tracks from that shared simulation. The client replays those tracks without re-simulating the dice or changing the ledger. A compatibility fallback handles older timelines. Banks and dealer inventory in raised trays remain outside the dice's reachable bed.

Wager placement packs occupied regions across all players and bet types, including shared number boxes and hop propositions. Congested regions shrink their chip footprints only as necessary to retain separation. Flying chips keep their denomination, appearance and wear; conversions travel through the dealer rack before the issued chips depart. Landings use a single approach with a short vertical drop rather than an overshoot and return.

Compact is the default TV interface size; Large is available in Settings. Label placement reserves projected footprints for bank chips, wagers, transfers, dealer inventory, and the moving puck, keeping the physical pieces visible. The labels and TV HUD render at native UI resolution independently of 3D scaling.

Dollar cards appear between rounds, once the camera and settlement have settled. They hide during throws, result shots, camera movement, and settlement transfers. Ordinary new-bet transfers keep existing values fixed until the chips arrive. Flying chip captions are omitted.

TV Settings offers **Labels: Smooth / Stable / Hidden**. Smooth is the default and eases cards into new clear positions; a relocation that would cross chips, the puck, the HUD, or another card fades between safe locations. Stable favors retained positions with a deadband against tiny camera changes. Hidden suppresses dollar cards. This choice is local to the display and persists across reloads.

See [betting windows](betting-window.md) for the host-enforced interval that gives players time to bet between throws.
