import { crashFingerprint } from './fingerprint.js';
import { submitCrashReport } from './github.js';
import { checkIpRateLimit } from './rate-limit.js';
import { sanitizeCrashPayload } from './sanitize.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

function maxPayloadBytes(env) {
  const value = Number(env.CRASH_MAX_PAYLOAD_BYTES);
  return Number.isFinite(value) && value > 1024 ? value : 24576;
}

async function readBoundedJson(request, env) {
  const limit = maxPayloadBytes(env);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(length) && length > limit) {
    throw new Error('Crash report payload is too large');
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel().catch(() => {});
      throw new Error('Crash report payload is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

async function handleReport(request, env) {
  if (String(env.CRASH_REPORTS_ENABLED || 'false') !== 'true') {
    return json({ error: 'Crash reporting disabled' }, 503);
  }

  const limited = await checkIpRateLimit(request, env);
  if (!limited.ok) {
    const headers = limited.retryAfter ? { 'Retry-After': String(limited.retryAfter) } : {};
    return json({ error: limited.error }, limited.status || 429, headers);
  }

  let payload;
  try {
    payload = await readBoundedJson(request, env);
  } catch {
    return json({ error: 'Invalid crash report payload' }, 400);
  }

  let sanitized;
  try {
    sanitized = sanitizeCrashPayload(payload, env);
  } catch (error) {
    return json({ error: error.message || 'Crash report rejected' }, 400);
  }

  const fingerprint = await crashFingerprint(sanitized);
  try {
    const result = await submitCrashReport(env, sanitized, fingerprint);
    return json({
      ok: true,
      reportId: sanitized.report.id,
      fingerprint,
      ...result
    });
  } catch (error) {
    console.error(JSON.stringify({
      scope: 'crash-relay',
      event: 'github-submit-failed',
      fingerprint,
      error: error?.message || String(error)
    }));
    return json({ error: 'Unable to submit crash report', fingerprint }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'ascii-vj-crash-relay' });
    }
    if (request.method === 'POST' && url.pathname === '/v1/reports') {
      return handleReport(request, env);
    }
    return json({ error: 'Not found' }, 404);
  }
};
