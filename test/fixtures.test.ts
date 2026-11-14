import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chainHash, ed25519Verify, GENESIS_HASH } from "../src/shared/canonical.ts";
import type { AuditEvent } from "../src/shared/types.ts";
import { buildFixtureEvents, FIXTURE_GATE_PUBLIC_KEY } from "./fixtures/make-events.ts";

const events: AuditEvent[] = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"));

test("events.json matches its generator", () => {
  assert.deepEqual(events, buildFixtureEvents());
});

test("fixture events form a valid signed chain from genesis", () => {
  let prevHash = GENESIS_HASH;
  events.forEach((event, index) => {
    const { _id, hash, gateSig, ...body } = event;
    assert.equal(event.seq, index + 1);
    assert.equal(_id, event.seq);
    assert.equal(event.prevHash, prevHash);
    assert.equal(hash, chainHash(prevHash, body), `hash of seq ${event.seq}`);
    assert.equal(ed25519Verify(FIXTURE_GATE_PUBLIC_KEY, hash, gateSig), true, `signature of seq ${event.seq}`);
    prevHash = hash;
  });
});

test("fixtures cover every event type and at least 8 reason codes", () => {
  const types = new Set(events.map((e) => e.type));
  assert.deepEqual([...types].sort(), ["CHILD_ISSUED", "DECISION", "EXECUTION", "REVOKED", "WARRANT_APPROVED", "WARRANT_CREATED"]);
  const reasons = new Set(events.flatMap((e) => (e.reasonCode ? [e.reasonCode] : [])));
  assert.ok(reasons.size >= 8, `only ${reasons.size} reason codes`);
  assert.deepEqual(new Set(events.flatMap((e) => (e.outcome ? [e.outcome] : []))), new Set(["executed", "rejected", "unknown"]));
});

test("denied payloads are stored as field names and sizes only", () => {
  const memo = events.find((e) => e.reasonCode === "FIELD_CONSTRAINT")!;
  assert.equal(memo.action!.fieldSizes.memo, 5002);
  assert.ok(JSON.stringify(memo).length < 2000);
});
