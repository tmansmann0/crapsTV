import * as game from "./game.js";
import { planBotActions } from "./bot-strategies.js";
import { DEFAULT_BOT_ROLL_DELAY_SECONDS } from "./betting-window.js";

/** Same room authority for the Node server and the optional browser-hosted WebRTC room. */
export class RoomHub {
  constructor(code, { rollDelay = 2500, timers = {} } = {}) {
    this.state = game.createState(code);
    this.clients = new Map();
    this.tokens = new Map();
    this.rollDelay = rollDelay;
    this.timer = null;
    this.botTimer = null;
    this.botWindows = new Map();
    this.botTurn = null;
    this.closed = false;
    this.setTimer = timers.setTimeout ?? globalThis.setTimeout;
    this.clearTimer = timers.clearTimeout ?? globalThis.clearTimeout;
  }
  connect(id, send) {
    this.clients.set(id, {
      send,
      playerId: null,
      window: Date.now(),
      count: 0,
    });
    send({
      type: "state",
      state: game.snapshot(this.state),
      sentAt: Date.now(),
    });
  }
  send(id, message) {
    try {
      this.clients.get(id)?.send(message);
    } catch {
      /* disconnected transport is cleaned up by its owner */
    }
  }
  broadcast() {
    this.scheduleBots();
    const message = {
      type: "state",
      state: game.snapshot(this.state),
      sentAt: Date.now(),
    };
    for (const id of this.clients.keys()) this.send(id, message);
  }
  disconnect(id) {
    const client = this.clients.get(id);
    this.clients.delete(id);
    if (
      client?.playerId &&
      ![...this.clients.values()].some((c) => c.playerId === client.playerId)
    ) {
      game.changeConnection(this.state, client.playerId, false);
      this.broadcast();
    }
  }
  receive(id, message) {
    const c = this.clients.get(id);
    if (!c) return;
    try {
      if (Date.now() - c.window > 1000) {
        c.window = Date.now();
        c.count = 0;
      }
      if (++c.count > 25) throw Error("Slow down for a moment.");
      if (!message || typeof message !== "object" || Array.isArray(message))
        throw Error("Invalid message.");
      const { type } = message,
        s = this.state;
      if (type === "clock") {
        if (
          typeof message.clientAt !== "number" ||
          !Number.isFinite(message.clientAt)
        )
          throw Error("Invalid clock timestamp.");
        this.send(id, {
          type: "clock",
          clientAt: message.clientAt,
          serverAt: Date.now(),
        });
        return;
      }
      if (type === "join") {
        if (message.code !== s.code)
          throw Error("That room code doesn’t match.");
        if (c.playerId && !s.players.find((p) => p.id === c.playerId)?.left) {
          this.send(id, {
            type: "welcome",
            playerId: c.playerId,
            token: [...this.tokens].find(([, v]) => v === c.playerId)?.[0],
          });
          return;
        }
        let pid =
          typeof message.token === "string"
            ? this.tokens.get(message.token)
            : null;
        if (pid && s.players.some((p) => p.id === pid && !p.left)) {
          c.playerId = pid;
          game.changeConnection(s, pid, true);
          this.send(id, {
            type: "welcome",
            playerId: pid,
            token: message.token,
          });
        } else {
          const p = game.join(s, message.name);
          const token = game.uid();
          this.tokens.set(token, p.id);
          c.playerId = p.id;
          this.send(id, { type: "welcome", playerId: p.id, token });
        }
      } else if (type === "watch") {
        /* The display is a spectator and never claims the first admin seat. */
      } else {
        const pid = c.playerId;
        if (!pid) throw Error("Join the table first.");
        if (type === "configure") game.configure(s, pid, message.config || {});
        else if (type === "start") {
          if (message.config) game.configure(s, pid, message.config);
          game.start(s, pid);
        } else if (type === "teach") game.setTeach(s, pid, message.value);
        else if (type === "cooldown")
          game.setRollCooldown(s, pid, message.seconds);
        else if (type === "bot-delay")
          game.setBotRollDelay(s, pid, message.seconds);
        else if (type === "add-bot")
          game.addBot(s, pid, {
            name: message.name,
            strategy: message.strategy,
            difficulty: message.difficulty,
          });
        else if (type === "remove-bot")
          game.removeBot(s, pid, message.playerId);
        else if (type === "dice")
          game.setDiceAppearance(s, pid, message.appearance);
        else if (type === "display")
          game.setDisplaySettings(s, pid, message.settings);
        else if (type === "bet-preview") {
          if (!game.previewBet(s, pid, message.amount, message.betId ?? null))
            return;
        } else if (type === "bet")
          game.place(s, pid, message.betId, message.amount);
        else if (type === "remove") game.remove(s, pid, message.betId);
        else if (type === "reup") game.reup(s, pid);
        else if (type === "leave") game.leave(s, pid);
        else if (type === "end") game.end(s, pid);
        else if (type === "transfer") game.transfer(s, pid, message.playerId);
        else if (type === "aim") {
          if (!game.setAim(s, pid, message.aim)) return;
        } else if (type === "roll") {
          this.beginRoll(pid, message.gesture);
        } else if (type === "reset") {
          if (pid !== s.adminId || s.status !== "ended")
            throw Error("Only the host can open a new table after the recap.");
          this.state = game.createState(s.code);
          this.botWindows.clear();
          this.botTurn = null;
          this.tokens.clear();
          for (const client of this.clients.values()) client.playerId = null;
          for (const clientId of this.clients.keys())
            this.send(clientId, { type: "reset" });
        } else throw Error("Unknown table action.");
      }
      this.broadcast();
    } catch (error) {
      // Preparation is ephemeral; a stale preview must never look like a failed wager.
      if (message?.type === "bet-preview") return;
      this.send(id, { type: "error", message: error.message });
    }
  }
  beginRoll(playerId, gesture) {
    const state = this.state;
    game.beginRoll(state, playerId, gesture, { duration: this.rollDelay });
    const throwId = state.throw.id;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (
        this.closed ||
        this.state !== state ||
        !state.rolling ||
        state.throw?.id !== throwId
      )
        return;
      game.finishRoll(state);
      this.broadcast();
    }, this.rollDelay);
  }
  botsCanAct() {
    return (
      !this.closed &&
      this.state.status === "playing" &&
      !this.state.rolling &&
      !this.state.aim?.active &&
      this.state.players.some((p) => !p.left && !p.bot && p.connected)
    );
  }
  botWindowKey() {
    const s = this.state;
    return `${s.createdAt}:${s.bettingOpenedAt}:${s.rolls.length}`;
  }
  botRollDeadline(now = Date.now()) {
    const s = this.state,
      shooter = s.players.find((p) => p.id === s.shooterId && !p.left);
    if (!shooter?.bot || !this.botsCanAct()) {
      this.botTurn = null;
      return null;
    }
    const key = `${this.botWindowKey()}:${shooter.id}`;
    if (this.botTurn?.key !== key)
      this.botTurn = { key, enteredAt: now, retryAt: 0 };
    return Math.max(
      Math.max(s.nextRollAt ?? now, this.botTurn.enteredAt) +
        (s.config.botRollDelaySeconds ?? DEFAULT_BOT_ROLL_DELAY_SECONDS) * 1000,
      this.botTurn.retryAt,
    );
  }
  scheduleBots() {
    this.clearTimer(this.botTimer);
    this.botTimer = null;
    const s = this.state;
    s.botRollAt = null;
    const bots = s.players.filter((p) => p.bot && !p.left);
    const ids = new Set(bots.map((p) => p.id));
    for (const id of this.botWindows.keys())
      if (!ids.has(id)) this.botWindows.delete(id);
    if (!this.botsCanAct() || !bots.length) {
      this.botTurn = null;
      return;
    }
    const now = Date.now(),
      key = this.botWindowKey();
    for (const bot of bots)
      if (this.botWindows.get(bot.id)?.key !== key)
        this.botWindows.set(bot.id, {
          key,
          done: false,
          at: now + 350 + bot.seat * 70,
        });
    const pending = [...this.botWindows.values()].filter(
      (entry) => !entry.done,
    );
    let deadline = this.botRollDeadline(now);
    if (deadline !== null) {
      // Every bot gets its bounded betting decision before the automatic toss.
      deadline = Math.max(deadline, ...pending.map((entry) => entry.at));
      s.botRollAt = deadline;
    }
    const next = Math.min(
      deadline ?? Infinity,
      ...pending.map((entry) => entry.at),
    );
    if (!Number.isFinite(next)) return;
    this.botTimer = this.setTimer(
      () => {
        this.botTimer = null;
        this.runBots();
      },
      Math.max(0, next - now),
    );
    this.botTimer?.unref?.();
  }
  runBots() {
    if (!this.botsCanAct()) {
      this.scheduleBots();
      return;
    }
    const now = Date.now(),
      s = this.state,
      key = this.botWindowKey();
    for (const bot of s.players.filter((p) => p.bot && !p.left)) {
      const window = this.botWindows.get(bot.id);
      if (!window || window.key !== key || window.done || window.at > now)
        continue;
      window.done = true;
      // Decisions are event-driven, bounded, and use exactly the same validated
      // ledger operations as phones. Difficulty never chooses or rewrites dice.
      let actions;
      try {
        actions = planBotActions(s, bot.id, { roundKey: key });
      } catch {
        // A strategy failure skips this window instead of taking down a host.
        continue;
      }
      for (const action of actions.slice(0, 12)) {
        try {
          if (action.type === "bet")
            game.place(s, bot.id, action.betId, action.amount);
          else if (action.type === "remove")
            game.remove(s, bot.id, action.betId);
          else if (action.type === "reup") game.reup(s, bot.id);
        } catch {
          /* A current rule/bank change can invalidate a prepared choice. */
        }
      }
    }
    const deadline = this.botRollDeadline(now);
    if (
      deadline !== null &&
      deadline <= now &&
      ![...this.botWindows.values()].some(
        (entry) => entry.key === key && !entry.done,
      )
    ) {
      const hash = [...`${s.shooterId}:${s.rolls.length}`].reduce(
        (n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0,
        0,
      );
      try {
        this.beginRoll(s.shooterId, {
          x: ((hash % 101) / 100 - 0.5) * 1.1,
          power: 0.45 + ((hash >>> 8) % 36) / 100,
        });
      } catch {
        // A genuinely unsettled physical throw may retry, with a bounded pause;
        // no valid face result is ever rejected for a strategy preference.
        this.botTurn.retryAt = now + 1000;
      }
    }
    this.broadcast();
  }
  close() {
    this.closed = true;
    this.clearTimer(this.timer);
    this.clearTimer(this.botTimer);
    this.timer = this.botTimer = null;
    this.botWindows.clear();
    this.botTurn = null;
    this.state.botRollAt = null;
    this.clients.clear();
  }
}
