# Betting window

New tables give everyone 10 seconds to place bets before the first throw and after each settled roll. The host can choose a whole number from 0 to 60 seconds in setup or Host controls. Zero allows immediate throws. Bets, take-downs, and dice appearance choices remain available during the window.

The room authority stores `config.rollCooldownSeconds`, `bettingOpenedAt`, and `nextRollAt`. It rejects both aim and roll commands before its own clock reaches `nextRollAt`; phone countdowns do not grant permission. Local WebSocket and online WebRTC rooms use the same `RoomHub` and rules. Reconnecting or changing shooters preserves the deadline.

Changing the duration during betting recalculates the deadline from the current window's original opening time. Shortening it can make the dice ready immediately; increasing it can extend that window. Changing it while dice are rolling takes effect when they settle. Invalid values and changes from players other than the host are rejected.

Phones send `{type: "cooldown", seconds: 10}` for live updates. Setup sends `config.rollCooldownSeconds`. The shared countdown helper uses the existing server-clock offset, so devices with different wall clocks show the same remaining time. A local timer updates the display without requiring periodic network broadcasts.

Tests cover the default and exact unlock boundary, open betting during the wait, post-settlement windows, live changes, zero, invalid inputs, unauthorized changes, reconnects, forged timestamps, and clock offsets. The party browser test checks the real default countdown and disabled-to-ready throw button before explicitly choosing zero for its remaining immediate-roll scenarios.
