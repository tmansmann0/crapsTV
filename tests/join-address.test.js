import test from "node:test";
import assert from "node:assert/strict";
import { fitJoinAddress, JOIN_CARD } from "../src/tv-layout.js";

const measure = (text, size) => text.length * size * 0.55;
test("join addresses retain ports and public paths, without query/hash or ellipsis", () => {
  for (const url of [
    "http://crapstv-play.local:3005/join?code=RNHK35",
    "http://192.168.100.250:65535/?room=RNHK35",
    "https://tylermansmann.github.io/crapsTV/?room=RNHK35",
    "https://games.example.com/a-long-public-base/crapsTV/?room=RNHK35#join",
    "http://[2001:db8:85a3::8a2e:370:7334]:3005/?room=RNHK35",
  ]) {
    const result = fitJoinAddress(url, measure);
    const expected = new URL(url);
    assert.equal(
      result.lines.join(""),
      `${expected.host}${expected.pathname === "/" ? "" : expected.pathname}`,
    );
    assert(result.lines.length <= 2);
    assert(!result.lines.some((line) => line.includes("…")));
    for (const line of result.lines)
      assert(measure(line, result.size) <= JOIN_CARD.addressWidth + 0.001);
  }
});

test("ordinary local host and port stay on one line; all URL text stays clear of QR", () => {
  const result = fitJoinAddress(
    "http://crapstv-play.local:3005/?room=RNHK35",
    measure,
  );
  assert.equal(result.lines[0], "crapstv-play.local:3005");
  assert(JOIN_CARD.addressX + JOIN_CARD.addressWidth < JOIN_CARD.qr.x);
  assert(JOIN_CARD.addressBaselines[1] + 12 <= 210);
});
