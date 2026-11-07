# Camera shots and chip contacts

Auto opens on a wide lobby view and moves into a close, near-top-down betting view during play. Framing adapts to the display and interface panels to fill the view with the betting bed; some outer trays may sit outside the frame. Each authoritative throw selects one of four felt-level rigs **inside** the cushion corners: X ±5.0, Y 0.38, Z ±2.3. The recorded trajectory determines the corner, and that choice stays fixed throughout the throw, including on late joins. A small vertical drift and slow lens change accompany tracking of the dice midpoint. Both dice remain framed; the renderer has verified an actual eye position of [-5.0, 0.387, 2.3].

At the recorded settle time, the view cuts above the dice for 1.6 seconds to show their upper faces, with padding for the actual TV interface panels. Payout shots then follow the same immutable schedule as the modeled chip transfers. Standout results can receive an individual shot, similar outcomes can share a shot, and grouped views frame the affected part of the table. Balanced rounds may use a wider collective payout. The schedule is deterministic for everyone watching the same round.

The configured cooldown remains fixed. The director fits its shots into the available window and groups remaining payouts rather than extending the wait or racing through every player. The ledger settles immediately; only chip presentation is queued. Reconnecting displays seek to current and future transfers without replaying finished payouts. Once the finite sequence of useful views is complete, the camera rests over the table rather than looping between the same seats.

Normal left-drag orbits. **Shift + left-drag** pans the eye and target together, and the wheel can zoom in close. A manual gesture pauses automatic direction for 15 seconds after release. Explicit Table/Room views and reduced motion take priority. These camera decisions do not change the shared dice timeline.

Review captures: [felt-level throw](screenshots/throw-felt-level.png) · [close overhead betting view](screenshots/betting-close-overhead.png).

Payout direction captures: [standout win](screenshots/payout-hero.png) · [matching pair](screenshots/payout-pair.png) · [player-height view](screenshots/player-eye-view.png). Native 4K functional [QA results](benchmarks/tour-4k.json) verify the same transfer IDs and amounts as the selected shots, unchanged balances, and a held overview after the finite idle sequence. The sampled renderer counters were 59–60 FPS on the tested Mac; these counters are separate from the timed performance benchmarks.

Strong direct hits can disturb the top few modeled wager chips. Physical contact records are checked for height, speed, and approach direction to reject glancing, slow, airborne, and late contacts. At most two stacks and three top chips per stack receive the visible response. Their lower stack and the felt remain collision supports, and displacement, lift, and speed are bounded. Chips recover gently to their betting layout.

The authoritative simulation includes solid cylinders for visible wager stacks and a dynamic ON/OFF puck, so dice cannot pass through them. The puck's poses are recorded alongside the dice and replayed on the TV; its last physical position persists until a point change calls for dealer repositioning. Both upper faces are read from the final physical dice orientations.

Launch positions clear nearby stacks and the puck before simulation begins. The phone and TV aiming previews use the same clearance calculation; an existing wager cannot spawn inside a die and eject it on the first physics step.

Top-chip movement remains a bounded presentation layer driven by actual stack-contact records. Recorded dice drive kinematic colliders and selected top chips are dynamic Cannon bodies, followed by gentle layout recovery. This layer does not recompute the dice outcome or alter the ledger. Banks and dealer inventory in raised trays remain outside the dice's reachable bed.

Compact is the default TV interface size; Large is available in Settings. Label placement reserves projected footprints for bank chips, wagers, transfers, dealer inventory, and the moving puck, keeping the physical pieces visible. The labels and TV HUD render at native UI resolution independently of 3D scaling.

Dollar cards appear between rounds, once the camera and settlement have settled. They hide during throws, result shots, camera movement, and settlement transfers. Ordinary new-bet transfers keep existing values fixed until the chips arrive. Flying chip captions are omitted.

TV Settings offers **Labels: Smooth / Stable / Hidden**. Smooth is the default and eases cards into new clear positions; a relocation that would cross chips, the puck, the HUD, or another card fades between safe locations. Stable favors retained positions with a deadband against tiny camera changes. Hidden suppresses dollar cards. This choice is local to the display and persists across reloads.

See [betting windows](betting-window.md) for the host-enforced interval that gives players time to bet between throws.
