# TV opening validation

The TV opening runs for 30 seconds after the critical scene assets are ready.
It starts behind black, fades into the table, demonstrates two physical throws
and their chip settlements, then fades the ordinary TV controls in during the
last 1.8 seconds. Escape skips the local opening. A room already playing goes
straight to its real game.

The demonstration owns separate game snapshots. Its players, wagers, dice,
chip transfers and balances never enter the room authority. The example throws
are chosen from naturally settled physical takes; their recorded orientations
remain unchanged after landing. Reduced motion holds a static camera while
retaining the physical throws, settlements and full duration.

Run the pure checks with:

```sh
node --test tests/startup.test.js
```

They compare every demonstration dice frame with the authoritative Cannon
simulation, independently settle the example wagers through the game ledger,
check preserved transfer sources, seek frozen snapshots in arbitrary order,
and check timing, reduced motion and graphics calibration. A subprocess also
exercises an HTTP LAN environment where `crypto.randomUUID` is unavailable.

After building the application, run the real renderer check with:

```sh
node tests/startup.browser.mjs
```

Run GPU checks one at a time. This script starts and closes its own server on
an unused ephemeral port with mDNS disabled; it never joins an existing room.
It delays both the walnut albedo and a dice wear map, releases the walnut first,
and verifies the actual canvas pixels stay black until the dice map is ready.
It then observes the complete opening on a real clock. Telemetry is sampled immediately after the application frame with the same requestAnimationFrame timestamp, so slow software draws cannot make stale DOM values look like a shortened opening. It checks both
throws, winning and losing chip transfers, UI fade timing, Escape, an already
playing room, live-game Graphics Retest with the UI visible and no demo, and
the unchanged authority ledger. Screenshots and sampled
telemetry are saved as `artifacts/startup-*.png` and `artifacts/startup-qa.json`.
Set `STARTUP_TEST_DEV=1` to exercise current sources through Vite instead of the
production build. CI uses an 800×500 viewport and keeps both black-pixel proofs;
other screenshots are optional there (`STARTUP_CAPTURE=1`). Local GPU runs use
1280×800 and retain all screenshots.

Automatic graphics candidates ramp resolution, texture limits and model detail.
Measurements choose a sustainable candidate at the requested frame budget;
explicit FPS, resolution, antialiasing, model and texture choices still take
precedence when the final graphics configuration is resolved.

Automatic resource changes wait for static landed-dice shots. The demonstration
derives those windows from its actual physics and payout timestamps; the
current takes switch at about 9.5, 21.9 and 28.7 seconds. Each camera is already
stationary for at least 300 ms before texture uploads, framebuffer resizing or
model/FPS changes begin. Payout transfers do not overlap those holds. Ending at
30 seconds retains the selected settings rather than applying them again.
Skipping a visible opening also retains its current quality.

Live Retest keeps the current quality during aiming, throws and payout
animations. It advances one probe at a time after a safe hold and sufficient
samples; waiting for a real round can extend the retest beyond 30 seconds. It
never delays a player's next roll or changes the ledger. Run
`npm run test:startup-retest` for an isolated real-authority airborne test.

The [recorded hold proof](benchmarks/startup-quality-holds.json) checks actual
framebuffer/texture/FPS changes against camera position, target, FOV and dice
poses sampled 250 ms before and 150 ms after each change. The measured opening
was 30.015 seconds with both black asset gates intact.
