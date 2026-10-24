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

test('interactive callbacks verify recipient and original bot post before any cloud mutation', async () => {
  const { createInteractionHandler } = await import('./mattermost-interactions.mjs');
  const { signInteraction } = await import('../server/mattermost.ts');
  const config = {
    baseUrl: 'http://mattermost:8065',
    token: 'bot',
    botId: 'b'.repeat(26),
    users: { sujin: 's'.repeat(26) },
    interaction: { url: 'http://relay:8066', secret: 'test-secret' },
  };
  const postId = 'p'.repeat(26),
    channelId = 'c'.repeat(26);
  const value = {
    logId: 'log',
    actor: 'sujin',
    userId: config.users.sujin,
    command: 'options',
    expires: Date.now() + 60000,
  };
  const body = {
    user_id: value.userId,
    post_id: postId,
    channel_id: channelId,
    trigger_id: 'trigger',
    context: { ticket: signInteraction(value, config.interaction.secret) },
  };
  let mutations = 0,
    dialog;
  const handler = createInteractionHandler({
    config,
    rpc: async () => {
      mutations++;
      return {
        participants: [
          { id: 'taeheon', name: '김태헌' },
          { id: 'wooseok', name: '장우석' },
        ],
      };
    },
    fetcher: async (url, init) => {
      if (url.endsWith('/dialogs/open')) {
        dialog = JSON.parse(init.body);
        return Response.json({});
      }
      return Response.json({
        user_id: config.botId,
        channel_id: channelId,
        props: { robot_butler_delivery_id: 'log' },
      });
    },
  });
  await assert.rejects(handler('/action', { ...body, user_id: 'x'.repeat(26) }));
  await assert.rejects(
    handler('/action', { ...body, context: { ticket: body.context.ticket + 'x' } }),
  );
  assert.equal(mutations, 0);
  await handler('/action', body);
  assert.equal(mutations, 1);
  assert.equal(dialog.dialog.elements[0].multiselect, true);
  assert.equal(dialog.dialog.elements[0].options.length, 2);
  const badPost = createInteractionHandler({
    config,
    rpc: async () => {
      throw new Error('must not run');
    },
    fetcher: async () =>
      Response.json({
        user_id: 'other',
        channel_id: channelId,
        props: { robot_butler_delivery_id: 'log' },
      }),
  });
  await assert.rejects(badPost('/action', body));
});

test('relay accepts reminder jobs and acknowledges them', async (t) => {
  const journal = setup(t);
  let sent = 0,
    acknowledged = false;
  const tick = createRelayWorker({
    origin,
    config,
    token: 'secret',
    journal,
    fetcher: async (url, options) => {
      if (url.includes('/system/ping')) return Response.json({});
      const body = JSON.parse(options.body);
      if (body.action === 'claim')
        return Response.json({ jobs: [{ ...jobFor(body.claimId), event: 'reminder' }] });
      acknowledged = true;
      return Response.json({ ok: true });
    },
    send: async (job) => {
      assert.equal(job.event, 'reminder');
      sent++;
      return { result: 'sent', postId: 'p'.repeat(26) };
    },
  });
  await tick();
  assert.equal(sent, 1);
  assert.equal(acknowledged, true);
});
