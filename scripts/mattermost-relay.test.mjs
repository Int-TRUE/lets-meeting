import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelayWorker, openJournal } from './mattermost-relay.mjs';
const origin = 'https://demo.example',
  config = { baseUrl: 'http://localhost:8065' };
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  const journal = openJournal(join(dir, 'relay.sqlite'));
  t.after(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return journal;
}
const jobFor = (claimId) => ({
  id: 'event',
  event: 'created',
  payload: { title: 'demo' },
  relay: { claimId, expiresAt: Date.now() + 120000 },
});
test('lost ACK is retried from durable receipt without repeating the DM, including after restart', async (t) => {
  const journal = setup(t);
  let sends = 0,
    acks = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith('/ping')) return Response.json({});
    const body = JSON.parse(options.body);
    if (body.action === 'claim') return Response.json({ jobs: [jobFor(body.claimId)] });
    if (++acks === 1) throw new Error('offline');
    return Response.json({ ok: true });
  };
  const options = {
    origin,
    config,
    token: 'secret',
    journal,
    fetcher,
    send: async () => {
      sends++;
      return { result: 'sent', postId: 'p'.repeat(26) };
    },
  };
  await assert.rejects(createRelayWorker(options)());
  assert.equal(journal.get(origin).phase, 'receipt');
  await createRelayWorker(options)();
  assert.equal(sends, 1);
  assert.equal(acks, 2);
  assert.equal(journal.get(origin), undefined);
});
test('interrupted send after restart records unknown and never repeats the DM', async (t) => {
  const journal = setup(t);
  journal.set(origin, { phase: 'sending', claimId: 'claim', job: { id: 'event' } });
  let sends = 0;
  const tick = createRelayWorker({
    origin,
    config,
    token: 'secret',
    journal,
    send: async () => {
      sends++;
    },
    fetcher: async (_url, options) => {
      assert.equal(JSON.parse(options.body).result, 'unknown');
      return Response.json({ ok: true });
    },
  });
  await tick();
  assert.equal(sends, 0);
});
test('offline Mattermost leaves work unclaimed', async (t) => {
  const journal = setup(t);
  let calls = 0;
  const tick = createRelayWorker({
    origin,
    config,
    token: 'secret',
    journal,
    fetcher: async (url) => {
      calls++;
      assert.ok(url.endsWith('/ping'));
      throw new Error('offline');
    },
  });
  await assert.rejects(tick());
  assert.equal(calls, 1);
  assert.equal(journal.get(origin), undefined);
});
test('lost claim response reuses the same durable claim identifier', async (t) => {
  const journal = setup(t);
  let claimId,
    claims = 0,
    sends = 0;
  const tick = createRelayWorker({
    origin,
    config,
    token: 'secret',
    journal,
    send: async () => {
      sends++;
      return { result: 'sent', postId: 'p'.repeat(26) };
    },
    fetcher: async (url, options) => {
      if (url.endsWith('/ping')) return Response.json({});
      const body = JSON.parse(options.body);
      if (body.action === 'ack') return Response.json({ ok: true });
      if (++claims === 1) {
        claimId = body.claimId;
        throw new Error('lost response');
      }
      assert.equal(body.claimId, claimId);
      return Response.json({ jobs: [jobFor(claimId)] });
    },
  });
  await assert.rejects(tick());
  await tick();
  assert.equal(sends, 1);
});
test('expired claim response never sends a DM', async (t) => {
  const journal = setup(t);
  let sends = 0;
  const tick = createRelayWorker({
    origin,
    config,
    token: 'secret',
    journal,
    send: async () => {
      sends++;
    },
    fetcher: async (url, options) => {
      if (url.endsWith('/ping')) return Response.json({});
      const b = JSON.parse(options.body);
      const job = jobFor(b.claimId);
      job.relay.expiresAt = Date.now() - 1;
      return Response.json({ jobs: [job] });
    },
  });
  await tick();
  assert.equal(sends, 0);
  assert.equal(journal.get(origin).outcome.result, 'unknown');
});
