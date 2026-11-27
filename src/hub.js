import * as game from "./game.js";
import { CHANCE_DIE_FRAME_MS } from "./house-rule-dice-motion.js";
import { HOUSE_RULE_INTRO_MS, HOUSE_RULE_REVEAL_MS } from "./house-rules.js";
import { planBotActions } from "./bot-strategies.js";
import { DEFAULT_BOT_ROLL_DELAY_SECONDS } from "./betting-window.js";
import { captureRoomSave } from "./room-save.js";
import { restoreJukeboxSettings } from "./jukebox-settings.js";

const HOUSE_RULE_ROLL_TIMEOUT_MS = 6500;

/** Same room authority for the Node server and the optional browser-hosted WebRTC room. */
export class RoomHub {
  constructor(
    code,
    {
      rollDelay = 2500,
      timers = {},
      saveStore = null,
      restored = null,
      jukebox = null,
    } = {},
  ) {
    this.saveStore = saveStore;
    this.jukebox = jukebox;
    this.state = restored?.state ?? this.newState(code);
    if (jukebox) {
      if (this.state.jukeboxSettings)
        jukebox.settings = restoreJukeboxSettings(this.state.jukeboxSettings);
      jukebox.onBalance = (playerId, amount) =>
        game.adjustSongChips(this.state, playerId, amount);
      jukebox.onChange = (balanceChanged) => {
        if (balanceChanged && !this.closed) this.broadcast();
        for (const id of this.clients.keys()) this.sendJukebox(id);
      };
    }
    if (saveStore) this.state.saveSessionAvailable = true;
    this.bettingRemainingMs = restored?.bettingRemainingMs ?? 0;
    this.clients = new Map();
    this.tokens = new Map(restored?.tokens);
    this.rollDelay = rollDelay;
    this.timer = null;
    this.houseRuleThrow = null;
    this.botTimer = null;
    this.botWindows = new Map();
    this.botTurn = null;
    this.closed = false;
    this.setTimer = timers.setTimeout ?? globalThis.setTimeout;
    this.clearTimer = timers.clearTimeout ?? globalThis.clearTimeout;
    if (restored) this.restoreBotDecisions(restored.completedBots);
  }
  newState(code) {
    const state = game.createState(code);
    if (this.saveStore) state.saveSessionAvailable = true;
    return state;
  }
  connect(id, send, { localDisplay = false } = {}) {
    this.clients.set(id, {
      send,
      playerId: null,
      localDisplay,
      window: Date.now(),
      count: 0,
    });
    send({
      type: "state",
      state: game.snapshot(this.state),
      sentAt: Date.now(),
    });
    this.sendJukebox(id);
  }
  sendJukebox(id) {
    if (!this.jukebox) return;
    const playerId = this.clients.get(id)?.playerId;
    const joined = this.state.players.some(
      (player) => player.id === playerId && !player.left && !player.bot,
    );
    this.send(id, {
      type: "jukebox-state",
      jukebox: this.jukebox.snapshot(joined, id),
    });
  }
  async receiveJukebox(id, message) {
    const room = this.state;
    const playerId = this.clients.get(id)?.playerId;
    const player = room.players.find(
      (seat) => seat.id === playerId && !seat.left && !seat.bot,
    );
    const stillJoined = () =>
      this.state === room &&
      !room.pausedAt &&
      room.status !== "ended" &&
      this.clients.get(id)?.playerId === playerId &&
      player &&
      !player.left;
    try {
      if (!this.jukebox) throw Error("The desktop jukebox is unavailable.");
      if (!stillJoined()) throw Error("Join an open table to use the jukebox.");
      if (message.type === "jukebox-search") {
        const tracks = await this.jukebox.search(
          player,
          message.query,
          stillJoined,
        );
        if (tracks) {
          this.send(id, { type: "jukebox-results", tracks });
        }
      } else if (message.type === "jukebox-request") {
        this.jukebox.request(
          player,
          message.trackId,
          playerId === room.adminId,
          message.cost,
        );
      } else {
        if (playerId !== room.adminId)
          throw Error("Only the table host can manage the jukebox.");
        this.jukebox.control(message);
      }
    } catch (error) {
      if (this.state === room)
        this.send(id, {
          type: "jukebox-error",
          operation: message.type,
          message: error.message,
        });
    }
  }
  send(id, message) {
    try {
      this.clients.get(id)?.send(message);
    } catch {
      /* disconnected transport is cleaned up by its owner */
    }
  }
  broadcast() {
    game.resolvePendingBotDrinks(this.state);
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
    if (client?.videoReady) this.updateJukeboxDisplay();
    if (
      client?.playerId &&
      ![...this.clients.values()].some((c) => c.playerId === client.playerId)
    ) {
      game.changeConnection(this.state, client.playerId, false);
      this.broadcast();
    }
  }
  updateJukeboxDisplay() {
    const display = [...this.clients].find(([, client]) => client.videoReady);
    this.jukebox?.setVideoDisplay(display?.[0] ?? null);
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
      if (type === "jukebox-display" || type === "jukebox-video") {
        if (!c.localDisplay || !this.jukebox) return;
        if (type === "jukebox-display" && typeof message.ready === "boolean") {
          c.videoReady = message.ready;
          this.updateJukeboxDisplay();
        } else if (type === "jukebox-video") {
          this.jukebox.reportVideo(id, message.attempt, message.status);
        }
        return;
      }
      if (
        type === "jukebox-search" ||
        type === "jukebox-request" ||
        type === "jukebox-control"
      ) {
        void this.receiveJukebox(id, message);
        return;
      }
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
        if (s.players.some((p) => p.id === c.playerId && !p.left && !p.bot)) {
          this.send(id, {
            type: "welcome",
            playerId: c.playerId,
            token: [...this.tokens].find(([, v]) => v === c.playerId)?.[0],
          });
          this.sendJukebox(id);
          return;
        }
        let pid =
          typeof message.token === "string"
            ? this.tokens.get(message.token)
            : null;
        if (pid && s.players.some((p) => p.id === pid && !p.left && !p.bot)) {
          c.playerId = pid;
          game.changeConnection(s, pid, true);
          this.send(id, {
            type: "welcome",
            playerId: pid,
            token: message.token,
          });
        } else {
          if (message.reclaim === true)
            throw Error(
              "That reconnect code did not match a seat at this table.",
            );
          if (s.pausedAt)
            throw Error(
              "This table is saved. Wait for the host to resume play.",
            );
          const p = game.join(s, message.name);
          const token = game.uid();
          this.tokens.set(token, p.id);
          c.playerId = p.id;
          this.send(id, { type: "welcome", playerId: p.id, token });
        }
        this.sendJukebox(id);
      } else if (type === "watch") {
        /* The display is a spectator and never claims the first admin seat. */
      } else {
        const pid = c.playerId;
        if (!pid) throw Error("Join the table first.");
        if (type === "save-session") this.saveSession(pid);
        else if (type === "resume-session") this.resumeSession(pid);
        else if (s.pausedAt)
          throw Error("The table is saved. The host can resume play.");
        else if (type === "configure")
          game.configure(s, pid, message.config || {});
        else if (type === "start") {
          if (message.config) game.configure(s, pid, message.config);
          game.start(s, pid);
        } else if (type === "teach") game.setTeach(s, pid, message.value);
        else if (type === "house-rule")
          game.setHouseRule(
            s,
            pid,
            message.rule,
            message.value ?? message.enabled,
          );
        else if (type === "house-rule-offer")
          game.setHouseRuleOffer(s, pid, message.rule, message.terms);
        else if (type === "buy-house-rule")
          game.buyHouseRule(s, pid, message.rule, message.quote);
        else if (type === "roll-house-rule") {
          this.throwHouseRuleDie(pid, message.promptId, message.die);
          return;
        } else if (type === "pass-dice") game.passDice(s, pid);
        else if (type === "cooldown")
          game.setRollCooldown(s, pid, message.seconds, message.pointSeconds);
        else if (type === "bot-delay")
          game.setBotRollDelay(s, pid, message.seconds);
        else if (type === "add-bot") game.addBot(s, pid, message);
        else if (type === "update-bot")
          game.updateBot(s, pid, message.playerId, message);
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
        else if (type === "adjust-bankroll")
          game.adjustBankroll(s, pid, message.playerId, message.amount);
        else if (type === "drinking-rules")
          game.setDrinkingRules(s, pid, message.rules);
        else if (type === "drink-request")
          game.requestDrink(s, pid, {
            kind: message.kind,
            unit: message.unit,
            quantity: message.quantity,
            to: message.to ?? null,
          });
        else if (type === "drink-response")
          game.respondToDrink(s, pid, message.requestId, message.response);
        else if (type === "leave") {
          game.leave(s, pid);
          this.jukebox?.removePlayer(pid);
        } else if (type === "end") {
          game.end(s, pid);
          this.jukebox?.reset();
        } else if (type === "transfer") game.transfer(s, pid, message.playerId);
        else if (type === "aim") {
          if (!game.setAim(s, pid, message.aim)) return;
        } else if (type === "roll") {
          this.beginRoll(pid, message.gesture);
        } else if (type === "reset") {
          if (pid !== s.adminId || s.status !== "ended")
            throw Error("Only the host can open a new table after the recap.");
          this.state = this.newState(s.code);
          this.botWindows.clear();
          this.botTurn = null;
          this.tokens.clear();
          for (const client of this.clients.values()) client.playerId = null;
          for (const clientId of this.clients.keys())
            this.send(clientId, { type: "reset" });
          this.jukebox?.reset();
        } else throw Error("Unknown table action.");
      }
      this.broadcast();
    } catch (error) {
      // Preparation is ephemeral; a stale preview must never look like a failed wager.
      if (message?.type === "bet-preview") return;
      this.send(id, { type: "error", message: error.message });
    }
  }
  requireSaveHost(id) {
    const s = this.state;
    if (
      s.adminId !== id ||
      !s.players.some((p) => p.id === id && !p.left && !p.bot && p.connected)
    )
      throw Error("Only the table host can do that.");
    if (!this.saveStore)
      throw Error("This host does not support saving tables.");
  }
  completedBotDecisions() {
    const key = this.botWindowKey();
    return [...this.botWindows]
      .filter(([, entry]) => entry.key === key && entry.done)
      .map(([id]) => id);
  }
  restoreBotDecisions(ids) {
    const key = this.botWindowKey();
    const bots = new Set(
      this.state.players.filter((p) => p.bot && !p.left).map((p) => p.id),
    );
    this.botWindows.clear();
    for (const id of ids)
      if (bots.has(id)) this.botWindows.set(id, { key, done: true, at: 0 });
  }
  saveSession(id) {
    this.requireSaveHost(id);
    const s = this.state;
    if (s.pausedAt) return;
    if (s.status === "ended") throw Error("This table has already closed.");
    if (s.rolling) throw Error("Wait for the dice to land before saving.");
    const save = captureRoomSave(s, this.tokens, this.completedBotDecisions());
    if (this.jukebox) {
      save.state.jukeboxSettings = { ...this.jukebox.settings };
      for (const track of this.jukebox.queue)
        game.adjustSongChips(save.state, track.requesterId, track.cost);
    }
    try {
      this.saveStore.write(save);
    } catch {
      throw Error(
        "The table could not be saved. Check the host’s storage and try again.",
      );
    }
    this.state = save.state;
    this.bettingRemainingMs = save.bettingRemainingMs;
    this.jukebox?.reset({ refund: false, restoreDefaults: false });
  }
  resumeSession(id) {
    this.requireSaveHost(id);
    const s = this.state;
    if (!s.pausedAt) return;
    try {
      this.saveStore.remove();
    } catch {
      throw Error(
        "The table could not be resumed. Check the host’s storage and try again.",
      );
    }
    const now = Date.now();
    const completed = this.completedBotDecisions();
    if (Number.isFinite(s.bettingOpenedAt))
      s.bettingOpenedAt += Math.max(0, now - s.pausedAt);
    if (s.status === "playing") s.nextRollAt = now + this.bettingRemainingMs;
    delete s.pausedAt;
    this.bettingRemainingMs = 0;
    this.restoreBotDecisions(completed);
  }
  beginRoll(playerId, gesture) {
    const state = this.state;
    const flight = game.beginRoll(state, playerId, gesture, {
      duration: this.rollDelay,
    });
    const startFlight = () => {
      const now = Date.now();
      flight.settledAt += now - flight.startAt;
      flight.startAt = now;
      state.throw = flight;
      this.timer = this.setTimer(() => {
        this.timer = null;
        if (
          this.closed ||
          this.state !== state ||
          !state.rolling ||
          state.throw?.id !== flight.id
        )
          return;
        const chanceRolls = new Map();
        const settle = () => {
          game.finishRoll(state, undefined, { chanceRolls });
          this.broadcast();
        };
        if (state.config.houseRules?.announce) {
          game.finishRoll(game.snapshot(state), undefined, {
            chanceRolls,
            preview: true,
          });
        }
        if (chanceRolls.size)
          this.offerHouseRuleRoll([...chanceRolls.values()], settle);
        else settle();
      }, this.rollDelay);
    };
    if (flight.houseRuleAttempt) {
      state.throw = null;
      this.offerHouseRuleRoll([flight.houseRuleAttempt], () => {
        startFlight();
        this.broadcast();
      });
    } else startFlight();
  }
  offerHouseRuleRoll(attempts, done) {
    const state = this.state;
    const id = game.uid();
    let index = 0;
    let roller;
    const setPrompt = (phase, extra) => {
      const attempt = attempts[index];
      const { dice, roll, hit, ...details } = attempt;
      const second = phase.startsWith("second-");
      const revealed = phase === "revealed";
      const [firstHop, secondHop] = game.houseRuleHops(attempt);
      state.houseRulePrompt = {
        ...details,
        id: `${id}:${index}`,
        phase,
        rollerId: roller?.id,
        rollerName: roller?.name,
        poses: [
          firstHop.frames.at(second || revealed ? -1 : 0),
          secondHop.frames.at(revealed ? -1 : 0),
        ],
        ...((second || revealed) && { firstDie: dice[0] }),
        ...(revealed && { dice, roll, hit }),
        ...extra,
      };
      this.broadcast();
    };
    const advance = (fn, delay) => {
      this.timer = this.setTimer(() => {
        this.timer = null;
        if (!this.closed && this.state === state && state.rolling) fn();
      }, delay);
    };
    const reveal = () => {
      setPrompt("revealed");
      advance(() => {
        if (++index < attempts.length) start();
        else {
          delete state.houseRulePrompt;
          done();
        }
      }, HOUSE_RULE_REVEAL_MS);
    };
    const waitForThrow = (die) => {
      const name = die === 1 ? "first" : "second";
      const launch = () => {
        this.houseRuleThrow = null;
        const { frames, contacts } = game.houseRuleHops(attempts[index])[
          die - 1
        ];
        const duration = (frames.length - 1) * CHANCE_DIE_FRAME_MS;
        setPrompt(`${name}-rolling`, {
          flight: { die, startAt: Date.now(), frames, contacts },
        });
        advance(die === 1 ? () => waitForThrow(2) : reveal, duration);
      };
      const available = roller?.connected && !roller.left;
      this.houseRuleThrow = available ? launch : null;
      advance(launch, available ? HOUSE_RULE_ROLL_TIMEOUT_MS : 450);
      setPrompt(`${name}-ready`, available ? { throwDie: die } : undefined);
    };
    const start = () => {
      const people = state.players.filter(
        (p) => !p.left && !p.bot && p.connected,
      );
      const random = people.length
        ? crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
        : 0;
      roller = people[Math.floor(random * people.length)];
      setPrompt("entering");
      advance(() => waitForThrow(1), HOUSE_RULE_INTRO_MS);
    };
    start();
  }
  throwHouseRuleDie(playerId, promptId, die) {
    const prompt = this.state.houseRulePrompt;
    if (!prompt || prompt.id !== promptId) return;
    if (prompt.rollerId !== playerId)
      throw Error("Only the selected player can throw these dice.");
    // A repeated tap for the first die cannot launch the second one.
    if (!this.houseRuleThrow || prompt.throwDie !== die) return;
    this.clearTimer(this.timer);
    this.houseRuleThrow();
  }
  botsCanAct() {
    return (
      !this.closed &&
      !this.state.pausedAt &&
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
          else if (action.type === "bot-drink")
            game.simulateBotDrink(s, bot.id, action.unit, action.quantity);
          else if (action.type === "drink-offer")
            game.requestDrink(s, bot.id, { ...action, kind: "offer" });
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
    this.houseRuleThrow = null;
    this.botWindows.clear();
    this.botTurn = null;
    this.state.botRollAt = null;
    this.clients.clear();
    return this.jukebox?.close();
  }
}
