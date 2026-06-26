import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIpRateLimit } from '../src/rate-limit.js';

function memoryKv() {
  const data = new Map();
  return {
    async get(key) {
      return data.has(key) ? JSON.parse(data.get(key)) : null;
    },
    async put(key, value) {
      data.set(key, value);
    }
  };
}

test('fails closed without rate-limit storage', async () => {
  const request = new Request('https://crash.dustwave.xyz/v1/reports');
  const result = await checkIpRateLimit(request, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('enforces per-IP limits', async () => {
  const request = new Request('https://crash.dustwave.xyz/v1/reports', {
    headers: { 'CF-Connecting-IP': '203.0.113.10' }
  });
  const env = {
    RATELIMIT: memoryKv(),
    CRASH_IP_LIMIT: '2',
    CRASH_IP_WINDOW_SECONDS: '60'
  };

  assert.equal((await checkIpRateLimit(request, env)).ok, true);
  assert.equal((await checkIpRateLimit(request, env)).ok, true);
  const blocked = await checkIpRateLimit(request, env);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
});
