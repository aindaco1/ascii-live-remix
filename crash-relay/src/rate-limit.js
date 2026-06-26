function numberEnv(env, key, fallback) {
  const value = Number(env?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

async function incrementWindow(kv, key, windowSeconds, nowSeconds) {
  const current = await kv.get(key, { type: 'json' }).catch(() => null);
  const reset = Number(current?.reset) > nowSeconds ? Number(current.reset) : nowSeconds + windowSeconds;
  const count = Number(current?.count || 0) + 1;
  await kv.put(key, JSON.stringify({ count, reset }), {
    expirationTtl: Math.max(60, reset - nowSeconds + 30)
  });
  return { count, reset };
}

export async function checkIpRateLimit(request, env) {
  if (!env?.RATELIMIT) {
    return { ok: false, status: 503, error: 'Rate limit storage not configured' };
  }
  const limit = numberEnv(env, 'CRASH_IP_LIMIT', 20);
  const windowSeconds = numberEnv(env, 'CRASH_IP_WINDOW_SECONDS', 3600);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const key = `ip:${clientIp(request)}:${Math.floor(nowSeconds / windowSeconds)}`;
  const record = await incrementWindow(env.RATELIMIT, key, windowSeconds, nowSeconds);
  if (record.count > limit) {
    return {
      ok: false,
      status: 429,
      error: 'Crash report rate limit exceeded',
      retryAfter: Math.max(1, record.reset - nowSeconds)
    };
  }
  return { ok: true };
}

export async function checkDailyIssueLimit(env) {
  if (!env?.RATELIMIT) {
    return { ok: false, status: 503, error: 'Rate limit storage not configured' };
  }
  const limit = numberEnv(env, 'CRASH_NEW_ISSUE_DAILY_LIMIT', 25);
  const day = new Date().toISOString().slice(0, 10);
  const record = await incrementWindow(env.RATELIMIT, `new-issues:${day}`, 36 * 60 * 60, Math.floor(Date.now() / 1000));
  if (record.count > limit) {
    return { ok: false, status: 429, error: 'Daily crash issue creation limit exceeded' };
  }
  return { ok: true };
}

export async function shouldUpdateIssue(env, fingerprint) {
  if (!env?.CRASH_INDEX) return true;
  const cooldownSeconds = numberEnv(env, 'CRASH_UPDATE_COOLDOWN_SECONDS', 900);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const key = `cooldown:${fingerprint}`;
  const current = await env.CRASH_INDEX.get(key, { type: 'json' }).catch(() => null);
  if (Number(current?.lastUpdated || 0) + cooldownSeconds > nowSeconds) return false;
  await env.CRASH_INDEX.put(key, JSON.stringify({ lastUpdated: nowSeconds }), {
    expirationTtl: Math.max(60, cooldownSeconds + 60)
  });
  return true;
}
