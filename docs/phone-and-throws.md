# Phone controls and shared throws

The `PhoneGame.jsx` interface and its stylesheet were authored through the Claude desktop app, then integrated and browser-tested in this project.

The phone controller uses a compact betting layout, a chip tray, wager views, a tutorial, and a 3D dice view. Chip thumbnails are rendered from the same original `chip.glb` used on the TV. A bundle is a local selection until placed: dragging or tapping it onto a wager sends the total through the existing authoritative bet validation. Teaching overlays are off for new tables; the tutorial remains available independently.

The current shooter can drag upward over the dice to throw, or use the accessible Roll button. Horizontal movement chooses direction and the upward swipe sets strength. Aim is sent at most ten times per second. Only the current shooter or admin can aim/roll, and no new gestures are accepted while a throw is underway. Colors and finishes remain the shooter's choices.

The room authority generates a throw once, using a fixed-step Cannon simulation and a cryptographically selected game result. It serializes 151 poses for the two dice, including the final face orientation, and broadcasts one start timestamp. Both the phone and TV sample this same timeline rather than simulating independently. A short clock ping exchange estimates the authority offset using the lowest round-trip time. Reconnecting, delayed, or low-frame-rate clients seek to the correct shared pose. Network latency can still produce a small difference in when a newly released throw is first received.

The TV follows the flight, then frames the landing, before returning to the selected camera mode. Reduced-motion mode keeps the selected camera instead of using cinematic camera travel. Actual bets and payouts resolve at the end of the authoritative timeline; the phone's visual result summary shows the settled dice and the player's net result.

The table now uses continuous macro UVs for walnut and leather, plus a separate surface-detail UV channel for subtle wear normal and roughness maps. Wager chips sit entirely above the felt and use the same modeled chip as the dealer rack.

Phone chip thumbnails are pre-rendered from the GLB. Software GPU renderers use a lower internal pixel ratio, fewer frames, and no real-time shadow map; the mesh geometry and synchronized trajectory stay the same. Hardware GPUs keep full-resolution rendering and soft shadows.
