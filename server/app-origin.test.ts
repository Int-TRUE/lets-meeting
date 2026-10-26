import { expect, test } from 'vitest';
import { allowedHttpAppOrigin } from './app-origin';
import { mattermostConfig } from './mattermost';
const origin = 'http://100.123.150.118:8088';
test('only an explicitly selected Tailscale HTTP origin is allowed', () => {
  expect(allowedHttpAppOrigin(origin, origin)).toBe(true);
  expect(allowedHttpAppOrigin(origin)).toBe(false);
  for (const value of [
    'http://100.123.150.119:8088',
    'http://100.123.150.118:8089',
    origin + '/path',
    origin + '?x=1',
    origin + '#x',
    'http://user@100.123.150.118:8088',
    'http://example.com',
    'http://192.168.0.1',
    'http://100.128.0.1',
    'http://100.63.0.1',
    'http://0.0.0.0',
  ]) {
    expect(allowedHttpAppOrigin(value, origin)).toBe(false);
  }
  expect(allowedHttpAppOrigin('http://example.com', 'http://example.com')).toBe(false);
});
test('the explicit app HTTP origin does not authorize arbitrary Mattermost HTTP destinations', () => {
  const env = {
    MATTERMOST_ENABLED: 'true',
    MATTERMOST_DOCKER_NETWORK: 'true',
    MATTERMOST_URL: 'http://mattermost:8065',
    ROBOT_BUTLER_URL: origin,
    ROBOT_BUTLER_HTTP_ORIGIN: origin,
    MATTERMOST_BOT_ID: 'b'.repeat(26),
    MATTERMOST_BOT_TOKEN: 'test',
    MATTERMOST_USER_MAP: '{}',
  };
  expect(mattermostConfig(env)?.appUrl).toBe(origin);
  expect(() => mattermostConfig({ ...env, ROBOT_BUTLER_HTTP_ORIGIN: undefined })).toThrow();
  expect(() => mattermostConfig({ ...env, MATTERMOST_URL: origin })).toThrow();
});
