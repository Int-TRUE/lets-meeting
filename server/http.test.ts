import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDemoDatabase } from './database';
import { handleDemoRequest, MAX_API_BYTES } from './http';
let db: ReturnType<typeof openDemoDatabase>;
beforeEach(async () => {
  db = openDemoDatabase(':memory:', 'reference');
  await db.seed();
});
afterEach(() => db.close());
const request = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://demo.example/api/demo/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
test('routes the deployed API to the shared store and disables caching', async () => {
  const directory = await handleDemoRequest(
    new Request('https://demo.example/api/demo?method=directory'),
    async () => db,
  );
  expect(directory.status).toBe(200);
  expect(directory.headers.get('cache-control')).toContain('no-store');
  expect((await directory.json()).people).toHaveLength(15);
  const response = await handleDemoRequest(request('snapshot', ['me']), async () => db);
  const { result } = await response.json();
  expect(result.topics.some((t: { id: string }) => t.id === 'autopay')).toBe(true);
  const file = result.meetings.find((m: { id: string }) => m.id === 'autopay-prov2').attachments[0];
  expect(file.downloadable).toBe(true);
  expect(file.blob).toBeUndefined();
});
test('rejects cross-origin, invalid methods and oversized payloads before DB access', async () => {
  let calls = 0;
  const store = async () => {
    calls++;
    return db;
  };
  expect(
    (
      await handleDemoRequest(
        request('snapshot', ['me'], { origin: 'https://other.example' }),
        store,
      )
    ).status,
  ).toBe(403);
  expect((await handleDemoRequest(request('constructor', ['me']), store)).status).toBe(404);
  expect(
    (await handleDemoRequest(request('snapshot', ['x'.repeat(MAX_API_BYTES)]), store)).status,
  ).toBe(413);
  expect(calls).toBe(0);
});
test('keeps local host restrictions and hides connection credentials on failure', async () => {
  expect((await handleDemoRequest(request('snapshot', ['me']), async () => db, true)).status).toBe(
    403,
  );
  const response = await handleDemoRequest(request('snapshot', ['me']), async () => {
    throw new Error('postgres://secret:password@host/db');
  });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('password');
});
