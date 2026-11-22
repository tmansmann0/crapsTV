# Betting window

New tables give players 15 seconds to place bets before a come-out or point-on roll. The host can set each window independently from 0 to 60 seconds in setup or Host controls. Zero allows immediate throws. Bets, take-downs, and dice appearance choices remain available during the window.

The authority chooses `config.rollCooldownSeconds` when the puck is off and `config.pointRollCooldownSeconds` when a point is on. Saved tables with one delay use it for both phases. The authority rejects aim and roll commands before its clock reaches `nextRollAt`. Local WebSocket and online WebRTC rooms use the same `RoomHub` and rules. Reconnecting or changing shooters preserves the deadline.

Changing the duration during betting recalculates the deadline from the current window's original opening time. Shortening it can make the dice ready immediately; increasing it can extend that window. Changing it while dice are rolling takes effect when they settle. Invalid values and changes from players other than the host are rejected.

Phones send `{type: "cooldown", seconds: 15, pointSeconds: 8}` for live updates. Setup sends both fields in `config`. An older client can send only `seconds` to set both windows. The shared countdown uses the server clock offset and updates locally between network broadcasts.

Tests cover the default and exact unlock boundary, open betting during the wait, post-settlement windows, live changes, zero, invalid inputs, unauthorized changes, reconnects, forged timestamps, and clock offsets. The party browser test checks the real default countdown and disabled-to-ready throw button before explicitly choosing zero for its remaining immediate-roll scenarios.
