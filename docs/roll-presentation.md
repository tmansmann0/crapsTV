# Camera shots and chip contacts

Auto opens on a wide lobby view and moves into a close, near-top-down betting view during play. At a 16:9 aspect ratio its eye is about 8.8 scene units above the felt. The betting bed fills the view, so some outer trays may sit outside the frame. Each authoritative throw selects one of four felt-level rigs **inside** the cushion corners: X ±5.0, Y 0.38, Z ±2.3. The recorded trajectory determines the corner, and that choice stays fixed throughout the throw, including on late joins. A small vertical drift and slow lens change accompany tracking of the dice midpoint. Both dice remain framed; the renderer has verified an actual eye position of [-5.0, 0.387, 2.3].

At the recorded settle time, the view cuts above the dice for 1.6 seconds to show their upper faces, with padding for the actual TV interface panels. A one-second wider breather is allowed when enough betting time remains, then the view returns overhead for betting. Explicit Table/Room views, manual orbit's pause, and reduced motion take priority. These camera decisions do not change the shared dice timeline.

Review captures: [felt-level throw](screenshots/throw-felt-level.png) · [close overhead betting view](screenshots/betting-close-overhead.png).

Strong direct hits can disturb the top few modeled wager chips. Physical contact records are checked for height, speed, and approach direction to reject glancing, slow, airborne, and late contacts. At most two stacks and three top chips per stack receive the visible response. Their lower stack and the felt remain collision supports, and displacement, lift, and speed are bounded. Chips recover gently to their betting layout.

The authoritative simulation includes solid cylinders for visible wager stacks and a dynamic ON/OFF puck, so dice cannot pass through them. The puck's poses are recorded alongside the dice and replayed on the TV; its last physical position persists until a point change calls for dealer repositioning. Both upper faces are read from the final physical dice orientations.

Launch positions clear nearby stacks and the puck before simulation begins. The phone and TV aiming previews use the same clearance calculation; an existing wager cannot spawn inside a die and eject it on the first physics step.

Top-chip movement remains a bounded presentation layer driven by actual stack-contact records. Recorded dice drive kinematic colliders and selected top chips are dynamic Cannon bodies, followed by gentle layout recovery. This layer does not recompute the dice outcome or alter the ledger. Banks and dealer inventory in raised trays remain outside the dice's reachable bed.

Compact is the default TV interface size; Large is available in Settings. Label placement reserves projected footprints for bank chips, wagers, transfers, dealer inventory, and the moving puck, keeping the physical pieces visible. The labels and TV HUD render at native UI resolution independently of 3D scaling.

Dollar cards appear between rounds, once the camera and settlement have settled. They hide during throws, result shots, camera movement, and settlement transfers. Ordinary new-bet transfers keep existing values fixed until the chips arrive. Flying chip captions are omitted.

TV Settings offers **Labels: Smooth / Stable / Hidden**. Smooth is the default and eases cards into new clear positions; a relocation that would cross chips, the puck, the HUD, or another card fades between safe locations. Stable favors retained positions with a deadband against tiny camera changes. Hidden suppresses dollar cards. This choice is local to the display and persists across reloads.

See [betting windows](betting-window.md) for the host-enforced interval that gives players time to bet between throws.
