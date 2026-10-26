import { afterEach, expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createId } from './id';
afterEach(() => vi.unstubAllGlobals());
test('creates UUID v4 IDs without the secure-context-only randomUUID API', () => {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const ids = Array.from({ length: 100 }, createId);
  for (const id of ids)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(ids).size).toBe(ids.length);
});
