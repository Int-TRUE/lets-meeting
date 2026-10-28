import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from '@playwright/test';
const httpMode = process.env.SELFHOST_TEST_HTTP === '1';

const database = process.env.POSTGRES_TEST_URL;
if (!database || !['localhost', '127.0.0.1'].includes(new URL(database).hostname))
  throw new Error('An isolated local POSTGRES_TEST_URL is required');
const schema = 'butler_test_' + randomUUID().replaceAll('-', '');
const sql = new pg.Pool({ connectionString: database });
const posts = [];
let dialog;
const bot = 'b'.repeat(26),
  channel = 'c'.repeat(26),
  creator = 't'.repeat(26),
  attendee = 's'.repeat(26);
const mm = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  let value;
  if (req.url === '/api/v4/system/ping') value = { status: 'OK' };
  else if (req.url === '/api/v4/channels/direct') value = { id: channel };
  else if (req.url === '/api/v4/posts' && req.method === 'POST') {
    value = {
      ...body,
      id: String(posts.length + 1).padStart(26, 'p'),
      user_id: bot,
      channel_id: channel,
    };
    posts.push(value);
  } else if (req.url.startsWith('/api/v4/posts/'))
    value = posts.find((p) => p.id === req.url.split('/').at(-1));
  else if (req.url === '/api/v4/actions/dialogs/open') {
    dialog = body;
    value = {};
  } else if (req.url.startsWith('/api/v4/users/')) {
    const id = req.url.split('/').at(-1);
    value = { id: id === 'me' ? bot : id, delete_at: 0 };
  }
  res
    .writeHead(value ? 200 : 404, { 'content-type': 'application/json' })
    .end(JSON.stringify(value ?? {}));
});
await new Promise((r) => mm.listen(0, '127.0.0.1', r));
const env = {
  ...process.env,
  DATABASE_URL: database,
  SELFHOST_SCHEMA: schema,
  PUBLIC_ORIGIN: httpMode ? 'http://100.123.150.118:8088' : 'https://validation.ts.net',
  ROBOT_BUTLER_HTTP_ORIGIN: httpMode ? 'http://100.123.150.118:8088' : '',
  PORT: '18088',
  MATTERMOST_ENABLED: 'true',
  MATTERMOST_URL: `http://127.0.0.1:${mm.address().port}`,
  MATTERMOST_BOT_ID: bot,
  MATTERMOST_BOT_TOKEN: 'test-only',
  MATTERMOST_USER_MAP: JSON.stringify({ taeheon: creator, sujin: attendee }),
  MATTERMOST_INTERACTION_SECRET: 'a'.repeat(64),
};
let child;
let logs = '';
function start() {
  child = spawn(process.execPath, ['build/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => (logs += b));
  child.stderr.on('data', (b) => (logs += b));
  return child;
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGTERM');
    await done;
  }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await delay(250);
  }
  throw new Error('Standalone smoke timeout');
}
async function ready() {
  await until(async () => {
    if (child.exitCode !== null) throw new Error('Server exited: ' + logs);
    return fetch('http://127.0.0.1:18088/healthz')
      .then((r) => r.ok)
      .catch(() => false);
  });
}
async function api(method, args) {
  const r = await fetch('http://127.0.0.1:18088/api/demo/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: env.PUBLIC_ORIGIN },
    body: JSON.stringify(args),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).result;
}
async function action(path, body) {
  const r = await fetch('http://127.0.0.1:8066' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
try {
  start();
  await ready();
  const directory = await (await fetch('http://127.0.0.1:18088/api/demo/directory')).json();
  assert.equal(directory.people.length, 4);
  assert.match(await (await fetch('http://127.0.0.1:18088/login')).text(), /<div id="root">/);
  for (const method of ['meetingDelivery', 'adminLogs'])
    assert.equal(
      (
        await fetch('http://127.0.0.1:18088/api/demo/' + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '["taeheon"]',
        })
      ).status,
      404,
    );
  if (httpMode) {
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== env.PUBLIC_ORIGIN) return route.abort();
        const response = await route.fetch({
          url: 'http://127.0.0.1:18088' + url.pathname + url.search,
        });
        await route.fulfill({ response });
      });
      await page.goto(env.PUBLIC_ORIGIN + '/login');
      assert.equal(await page.evaluate(() => isSecureContext), false);
      assert.equal(await page.evaluate(() => typeof crypto.randomUUID), 'undefined');
      await page.getByRole('button', { name: '태평양으로 시작' }).click();
      await page.getByRole('link', { name: '토픽 만들기', exact: true }).first().click();
      await page.getByLabel(/^주제명/).fill('HTTP browser topic');
      await page
        .getByLabel(/^한줄 설명/)
        .fill('Insecure context ID and real database verification');
      await page.getByRole('button', { name: '토픽 만들기', exact: true }).click();
      await page.getByRole('heading', { name: 'HTTP browser topic', exact: true }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'HTTP browser topic', exact: true }).waitFor();
      assert.deepEqual(errors, []);
      assert.equal(
        (
          await fetch('http://127.0.0.1:18088/api/demo/createTopic', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'http://100.100.100.100:8088' },
            body: '[]',
          })
        ).status,
        403,
      );
    } finally {
      await browser.close();
    }
  }
  const topic = await api('createTopic', [
    'taeheon',
    { title: 'Standalone test', description: 'Isolated test', managerIds: ['sujin'] },
    randomUUID(),
  ]);
  const nextDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const meeting = await api('createMeeting', [
    'taeheon',
    {
      topicId: topic,
      title: 'Direct delivery',
      description: 'Test',
      roomId: directory.rooms[0].id,
      start: nextDate + 'T10:00:00+09:00',
      end: nextDate + 'T11:00:00+09:00',
      participantIds: ['sujin'],
      material: 'none',
      attachments: [],
      reminderMinutes: [],
    },
    randomUUID(),
  ]);
  await until(() => posts.length === 2);
  assert.ok(posts.every((p) => p.props.attachments.at(-1).text.includes(env.PUBLIC_ORIGIN)));
  const startTime = new Date(Date.now() - 30000).toISOString(),
    endTime = new Date(Date.now() + 240000).toISOString();
  await sql.query(`UPDATE "${schema}".meetings SET data=data || $2::jsonb WHERE id=$1`, [
    meeting,
    JSON.stringify({ start: startTime, end: endTime }),
  ]);
  // External SQL changes bypass application write events. Restart to reload
  // deadlines, as required by the event-driven scheduler's operating contract.
  await stop();
  start();
  await ready();
  await until(() =>
    posts.some((p) =>
      p.props.attachments?.some((a) => a.actions?.some((a) => a.id === 'attendees')),
    ),
  );
  const prompt = posts.find((p) =>
    p.props.attachments?.some((a) => a.actions?.some((a) => a.id === 'attendees')),
  );
  const ticket = prompt.props.attachments.at(-1).actions[0].integration.context.ticket;
  const wrong = await action('/action', {
    user_id: attendee,
    channel_id: channel,
    post_id: prompt.id,
    context: { ticket },
    trigger_id: 'test',
  });
  assert.ok(wrong.ephemeral_text);
  assert.equal(dialog, undefined);
  await action('/action', {
    user_id: creator,
    channel_id: channel,
    post_id: prompt.id,
    context: { ticket },
    trigger_id: 'test',
  });
  assert.equal(dialog.dialog.callback_id, 'robotbutlerlate');
  const submission = {
    user_id: creator,
    channel_id: channel,
    callback_id: 'robotbutlerlate',
    state: dialog.dialog.state,
    submission: { attendees: ['sujin'] },
  };
  await action('/dialog', submission);
  await action('/dialog', submission);
  await until(() =>
    posts.some((p) => p.props.attachments?.some((a) => a.actions?.some((a) => a.id === 'reply'))),
  );
  const late = posts.find((p) =>
    p.props.attachments?.some((a) => a.actions?.some((a) => a.id === 'reply')),
  );
  const reply = late.props.attachments.at(-1).actions[0].integration.context.ticket;
  await action('/action', {
    user_id: attendee,
    channel_id: channel,
    post_id: late.id,
    context: { ticket: reply, selected_option: '0' },
  });
  await until(() => posts.some((p) => p.message?.includes('참가자의 응답')));
  const count = posts.length;
  await stop();
  start();
  await ready();
  await delay(5500);
  assert.equal(posts.length, count);
  await stop();
  await sql.query(`UPDATE "${schema}".metadata SET value='old-version' WHERE key='seed-version'`);
  start();
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.equal((await sql.query(`SELECT count(*)::int n FROM "${schema}".meetings`)).rows[0].n, 1);
  console.log(
    'PASS: standalone HTTP/API/PostgreSQL, direct DM, timed prompts, signed callbacks, recipient validation, duplicate clicks, restart, and reset protection.',
  );
} finally {
  await stop();
  await new Promise((r) => mm.close(r));
  if (schema.startsWith('butler_test_'))
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await sql.end();
}
