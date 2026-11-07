# TV opening validation

The TV opening contains 30 seconds of animation after the critical scene assets are ready. Cold graphics uploads can extend its wall-clock duration while a landed-dice result stays still.
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
It holds the selected American-walnut albedo, dice wear map, chip scratch atlas,
packed wool atlas and native vector-board geometry. It releases them in stages
and checks actual black canvas pixels and an untouched opening clock until the
last required asset is ready. The native ink render target is allocated and
drawn before the black gate opens, followed by world shader compilation.
It then observes the complete opening on a real clock. Telemetry is sampled immediately after the application frame with the same requestAnimationFrame timestamp, so slow software draws cannot make stale DOM values look like a shortened opening. It checks both
throws, winning and losing chip transfers, UI fade timing, Escape, an already
playing room, live-game Graphics Retest with the UI visible and no demo, and
the unchanged authority ledger. Screenshots and sampled
telemetry are saved as `artifacts/startup-*.png` and `artifacts/startup-qa.json`.
Set `STARTUP_TEST_DEV=1` to exercise current sources through Vite instead of the
production build. CI uses an 800×500 viewport and keeps all five black-pixel proofs;
other screenshots are optional there (`STARTUP_CAPTURE=1`). Local GPU runs use
1280×800 and retain all screenshots.

Automatic graphics candidates ramp resolution, texture limits and model detail.
Measurements choose a sustainable candidate at the requested frame budget;
explicit FPS, resolution, antialiasing, model and texture choices still take
precedence when the final graphics configuration is resolved.

Automatic resource changes wait for static landed-dice shots. The demonstration
derives those windows from its actual physics and payout timestamps; the
current takes switch at about 9.5, 21.9 and 28.7 seconds of animation content. Each camera is already
stationary for at least 300 ms before texture uploads, framebuffer resizing or
model/FPS changes begin. Payout transfers do not overlap those holds. After a
quality change, the next actual RAF gap accounts for synchronous uploads,
shader work and delayed GPU presentation. Excess time pauses the isolated
animation clock, preserving the rest of the static result hold and every payout
instead of jumping into a transfer halfway through. Ending after all 30 seconds
of content retains the selected settings rather than applying them again.
Skipping a visible opening also retains its current quality.

Sparse RAF scheduling also cannot skip a calibration window. The isolated
content clock stops at each unvisited result shot, supplies at least 300 ms of
actual camera lead, then performs that probe before continuing. Discarded
scheduler time is accounted with resource waits. The final presentation can
only complete on a rendered frame: the browser proof verifies the deadline
crossing bracket and reports its measured terminal frame overshoot separately,
instead of assuming a fixed frame-interval tolerance. Every active sample must
agree with actual RAF time minus accounted waits. A slow frame does not permit
early completion, an unaccounted clock jump, or a missing calibration probe.
Set `STARTUP_SPARSE_RAF=1` for deliberate short/long frame stalls in the browser
proof. This reproduces late recovery gaps without changing product timing.

Live Retest keeps the current quality during aiming, throws and payout
animations. It advances one probe at a time after a safe hold and sufficient
samples; waiting for a real round can extend the retest beyond 30 seconds. It
never delays a player's next roll or changes the ledger. A cold update extends
only its camera recovery hold for at least 700 ms after work completes; a new
aim or throw immediately returns camera ownership to current gameplay. Run
`npm run test:startup-retest` for an isolated real-authority airborne test.
The camera cannot leave recovery before an actual world draw at least 150 ms
after the switch; a throttled RAF callback alone does not count. Its browser
proof requires distinct real dice poses spanning airborne time, rather than a
minimum rendering FPS, and verifies unchanged camera/dice across the hold.

The [recorded hold proof](benchmarks/startup-quality-holds.json) checks actual
framebuffer/texture/FPS changes against camera position, target, FOV and dice
poses sampled 250 ms before and 150 ms after each change. The measured opening
with the selected production materials was 33.682 seconds on the wall clock:
30.016 seconds of content plus 3.666 seconds of measured resource waits. All
three asset-gate screenshots were entirely black. The separate live Retest proof
observed 150 airborne frames without a quality change, then applied its first
probe to resting dice with the camera already still. These are workload/device
measurements, not a fixed loading-time promise.
