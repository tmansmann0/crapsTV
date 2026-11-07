import * as game from "./game.js";

/** Same room authority for the Node server and the optional browser-hosted WebRTC room. */
export class RoomHub {
  constructor(code, { rollDelay = 1700 } = {}) {
    this.state = game.createState(code);
    this.clients = new Map();
    this.tokens = new Map();
    this.rollDelay = rollDelay;
    this.timer = null;
  }
  connect(id, send) {
    this.clients.set(id, {
      send,
      playerId: null,
      window: Date.now(),
      count: 0,
    });
    send({ type: "state", state: game.snapshot(this.state) });
  }
  send(id, message) {
    try {
      this.clients.get(id)?.send(message);
    } catch {
      /* disconnected transport is cleaned up by its owner */
    }
  }
  broadcast() {
    const message = { type: "state", state: game.snapshot(this.state) };
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
        else if (type === "dice")
          game.setDiceAppearance(s, pid, message.appearance);
        else if (type === "display")
          game.setDisplaySettings(s, pid, message.settings);
        else if (type === "bet")
          game.place(s, pid, message.betId, message.amount);
        else if (type === "remove") game.remove(s, pid, message.betId);
        else if (type === "reup") game.reup(s, pid);
        else if (type === "leave") game.leave(s, pid);
        else if (type === "end") game.end(s, pid);
        else if (type === "transfer") game.transfer(s, pid, message.playerId);
        else if (type === "roll") {
          game.beginRoll(s, pid);
          this.timer = setTimeout(() => {
            try {
              game.finishRoll(this.state);
              this.broadcast();
            } finally {
              this.timer = null;
            }
          }, this.rollDelay);
        } else if (type === "reset") {
          if (pid !== s.adminId || s.status !== "ended")
            throw Error("Only the host can open a new table after the recap.");
          this.state = game.createState(s.code);
          this.tokens.clear();
          for (const client of this.clients.values()) client.playerId = null;
          for (const clientId of this.clients.keys())
            this.send(clientId, { type: "reset" });
        } else throw Error("Unknown table action.");
      }
      this.broadcast();
    } catch (error) {
      this.send(id, { type: "error", message: error.message });
    }
  }
  close() {
    clearTimeout(this.timer);
    this.clients.clear();
  }
}
