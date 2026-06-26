const DEFAULT_MAX_TEXT = 1000;
const MAX_STACK_LINES = 24;
const MAX_CONTEXT_KEYS = 40;
const MAX_CONTEXT_DEPTH = 4;
const ALLOWED_KINDS = new Set([
  'frontend-error',
  'unhandled-rejection',
  'tauri-command',
  'rust-panic',
  'renderer-error',
  'native-output-error'
]);

const ALLOWED_SURFACES = new Set([
  'frontend',
  'tauri-command',
  'renderer',
  'native-output',
  'startup',
  'panic-hook',
  'unknown'
]);

function boundText(value, max = DEFAULT_MAX_TEXT) {
  return String(value ?? '')
    .replace(/\b(?:asset|file):\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/\bhttps?:\/\/asset\.localhost[^\s"']*/gi, '[redacted-asset-url]')
    .replace(/\bhttps?:\/\/ipc\.localhost[^\s"']*/gi, '[redacted-ipc-url]')
    .replace(/\/Users\/[^\s"']+/g, '[redacted-path]')
    .replace(/\/Volumes\/[^\s"']+/g, '[redacted-path]')
    .replace(/\/private\/[^\s"']+/g, '[redacted-path]')
    .replace(/\/tmp\/[^\s"']+/g, '[redacted-path]')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '[redacted-path]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .slice(0, max);
}

function sanitizeStack(stack) {
  return boundText(stack, 6000)
    .split(/\r?\n/)
    .slice(0, MAX_STACK_LINES)
    .map((line) => boundText(line, 240))
    .join('\n');
}

function sanitizeContextValue(value, depth = 0) {
  if (depth > MAX_CONTEXT_DEPTH) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return boundText(value, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeContextValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    let count = 0;
    for (const [rawKey, rawValue] of Object.entries(value)) {
      if (count >= MAX_CONTEXT_KEYS) break;
      const key = boundText(rawKey, 80).replace(/[^A-Za-z0-9_.:-]/g, '_');
      if (!key) continue;
      if (/token|secret|password|key|cookie|auth/i.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeContextValue(rawValue, depth + 1);
      }
      count += 1;
    }
    return out;
  }
  return String(value);
}

function normalizeKind(kind) {
  const normalized = boundText(kind, 80).toLowerCase();
  return ALLOWED_KINDS.has(normalized) ? normalized : 'frontend-error';
}

function normalizeSurface(surface) {
  const normalized = boundText(surface, 80).toLowerCase();
  return ALLOWED_SURFACES.has(normalized) ? normalized : 'unknown';
}

export function sanitizeCrashPayload(payload, env = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Crash report payload must be an object');
  }

  const app = payload.app && typeof payload.app === 'object' ? payload.app : {};
  const report = payload.report && typeof payload.report === 'object' ? payload.report : payload;
  const identifier = boundText(app.identifier || report.appIdentifier || '', 120);
  const expectedIdentifier = boundText(env.CRASH_ALLOWED_APP_IDENTIFIER || '', 120);
  if (expectedIdentifier && identifier !== expectedIdentifier) {
    throw new Error('Crash report app identifier is not allowed');
  }

  const sanitized = {
    app: {
      name: boundText(app.name || 'ASCII VJ Remix', 120),
      version: boundText(app.version || report.appVersion || 'unknown', 80),
      identifier,
      channel: boundText(app.channel || report.channel || 'production', 80),
      buildProfile: boundText(app.buildProfile || report.buildProfile || 'release', 80),
      os: boundText(app.os || report.os || 'unknown', 80),
      arch: boundText(app.arch || report.arch || 'unknown', 80)
    },
    report: {
      id: boundText(report.id || crypto.randomUUID(), 120),
      kind: normalizeKind(report.kind),
      surface: normalizeSurface(report.surface),
      message: boundText(report.message || 'Crash report', 1000),
      stack: sanitizeStack(report.stack || ''),
      capturedAt: boundText(report.capturedAt || report.timestamp || new Date().toISOString(), 80),
      context: sanitizeContextValue(report.context || {})
    }
  };

  if (!sanitized.report.message.trim()) sanitized.report.message = 'Crash report';
  return sanitized;
}

export { boundText, sanitizeContextValue, sanitizeStack };
