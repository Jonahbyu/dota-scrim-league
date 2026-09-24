import { test } from "node:test";
import assert from "node:assert/strict";
import { strengthOfSchedule } from "../public/lib/schedule.js";

const S = (home, away, hs, as) => ({ home, away, home_score: hs, away_score: as });
// A beats everyone 2-0; B and C split; D loses everything.
const series = [
  S(1, 2, 2, 0), S(1, 3, 2, 0), S(1, 4, 2, 0),
  S(2, 3, 1, 1), S(2, 4, 2, 0), S(3, 4, 2, 0),
  S(4, 1, null, null), S(2, 3, null, null),
];
const by = Object.fromEntries(strengthOfSchedule([1, 2, 3, 4], series).map((r) => [r.id, r]));

test("OWP leaves out games against the team itself", () => {
  // D's opponents without their games vs D: A 4-0, B 1-3, C 1-3 → (1 + .25 + .25) / 3
  assert.ok(Math.abs(by[4].owp - 0.5) < 1e-9);
  // A's opponents without A: B 3-1, C 3-1, D 0-4 → (.75 + .75 + 0) / 3
  assert.ok(Math.abs(by[1].owp - 0.5) < 1e-9);
});

test("SOS mixes OWP and OOWP 2:1; playing the top team is a harder schedule", () => {
  for (const r of Object.values(by)) assert.ok(Math.abs(r.sos - (2 * r.owp + r.oowp) / 3) < 1e-9);
  // E only played A (unbeaten), F only played D (winless).
  const more = [...series, S(5, 1, 0, 2), S(6, 4, 2, 0)];
  const r = Object.fromEntries(strengthOfSchedule([1, 2, 3, 4, 5, 6], more).map((x) => [x.id, x]));
  assert.ok(r[5].sos > r[6].sos);
  assert.equal(r[5].owp, 1);
});

test("remaining schedule uses unplayed series and full records", () => {
  assert.deepEqual(by[4].remaining, [1]);
  assert.equal(by[4].remaining_sos, 1); // A is 6-0
  assert.deepEqual(by[2].remaining, [3]);
  assert.equal(by[1].faced.length, 3);
  assert.equal(by[2].faced.find((f) => f.opp === 3).result, "t");
});

test("teams with no games get nulls, not NaN", () => {
  const [r] = strengthOfSchedule([9], series);
  assert.equal(r.owp, null); assert.equal(r.sos, null); assert.equal(r.remaining_sos, null);
});
