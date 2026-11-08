# Optimized table 0.11.0 snapshot

Preserved before the padded crown curvature refinement. These are the exact
runtime GLB, editable Blender source, and corresponding statistics from commit
`51797fd`. `manifest.json` records their SHA-256 hashes.

From the project root, rollback only the optimized variant with:

```sh
cp assets/source/legacy/0.11.0/table-player-rails-optimized.glb public/assets/table-player-rails-optimized.glb
cp assets/source/legacy/0.11.0/table-player-rails-optimized.blend assets/source/table-player-rails-optimized.blend
cp assets/source/legacy/0.11.0/table-player-rails-optimized-stats.json public/assets/table-player-rails-optimized-stats.json
```

Reapply the rounded crown without rebuilding other components:

```sh
blender --background --python scripts/refine-padded-crown.py
```

The original table and legacy player-table models remain in their original
locations and are independently protected by the optimization statistics.
