# Phone controls and shared throws

The `PhoneGame.jsx` interface and its stylesheet were authored through the Claude desktop app, then integrated and browser-tested in this project.

The phone controller uses a compact betting layout, a chip tray, wager views, a tutorial, and a 3D dice view. Chip thumbnails are rendered from the same original `chip.glb` used on the TV. A bundle is a local selection until placed: dragging or tapping it onto a wager sends the total through the existing authoritative bet validation. Teaching overlays are off for new tables; the tutorial remains available independently.

The current shooter can drag upward over the dice to throw, or use the accessible Roll button. Horizontal movement chooses direction and the upward swipe sets strength. Aim is sent at most ten times per second. Only the current shooter or admin can aim/roll, and no new gestures are accepted while a throw is underway. Colors and finishes remain the shooter's choices.

The room authority securely seeds initial orientation, velocity, and spin, then runs a fixed-step Cannon simulation until both dice sleep flat. The upper physical faces determine the result. It serializes the physical poses and an unchanged final hold, then broadcasts one start timestamp; it never rotates landed dice to a separately selected outcome. Both the phone and TV sample this same timeline rather than simulating independently. A short clock ping exchange estimates the authority offset using the lowest round-trip time. Reconnecting, delayed, or low-frame-rate clients seek to the correct shared pose. Network latency can still produce a small difference in when a newly released throw is first received.

The TV follows the flight, then frames the landing, before returning to the selected camera mode. Reduced-motion mode keeps the selected camera instead of using cinematic camera travel. Actual bets and payouts resolve at the end of the authoritative timeline; the phone's visual result summary shows the settled dice and the player's net result.

The table now uses continuous macro UVs for walnut and leather, plus a separate surface-detail UV channel for subtle wear normal and roughness maps. Wager chips sit entirely above the felt and use the same modeled chip as the dealer rack.

Phone chip thumbnails are pre-rendered from the GLB. Software GPU renderers use a lower internal pixel ratio, fewer frames, and no real-time shadow map; the mesh geometry and synchronized trajectory stay the same. Hardware GPUs keep full-resolution rendering and soft shadows.

## Showing a settled roll

The mobile Roll view is a dice close-up with a dark background. It uses the same physical timeline as the TV and frames both dice. After an unchanged 500ms landing hold, the phone returns to Play. It does not switch the resting dice to a different face or show an incomplete imitation of the TV table.

Winning chips then appear at the matching betting area. The label separates profit from a returned stake; standing place/hardway bets show profit while the stake stays on the table. After a short explanation hold, the chips travel to Bank and its displayed amount updates on arrival. This is presentation only: the server ledger remains authoritative. Historical results and reconnect snapshots do not replay credits. Reduced-motion mode shows the explanation without the flight.

The Play board now reserves one fixed feedback area for quick amounts, validation and confirmation. The compact result strip and re-up controls retain their layout space. Browser measurements at 390×844 and 375×640 found zero change in the board's top or height across 15 interaction states, compared with roughly 45–50px of movement before.

## Animated Learn

Learn is a separate, lazily loaded visual guide. It shows one short concept at a time: Pass line, the point, taking odds, Place bets, Field, Hardways, and Don’t Pass in classic mode. Chips, dice and the puck animate between explicit steps; the captions explain where the stake and profit go. Play/Pause, Replay and step controls keep the pace optional. A local Classic/Crapless selector changes only the examples, never the live room.

The lessons use literal example IDs and read payout definitions from the same catalogue as play. They do not call game actions, create a new room, or need secure-context UUID APIs. Browser checks freeze the supplied game state and verify it remains unchanged through every lesson and mode. Reduced motion disables movement and automatic playback while retaining manual steps.
