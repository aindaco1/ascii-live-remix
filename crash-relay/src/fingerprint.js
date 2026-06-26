function normalizeFrameLine(line) {
  return String(line || '')
    .replace(/\b(?:asset|file|https?):\/\/[^\s)]+/gi, '[url]')
    .replace(/\/Users\/[^\s)]+/g, '[path]')
    .replace(/[A-Za-z]:\\[^\s)]+/g, '[path]')
    .replace(/:\d+:\d+/g, ':line:col')
    .replace(/\b0x[0-9a-f]+\b/gi, '0xaddr')
    .replace(/\bv?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/g, 'x.y.z')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function normalizedStack(stack) {
  return String(stack || '')
    .split(/\r?\n/)
    .map(normalizeFrameLine)
    .filter(Boolean)
    .slice(0, 6)
    .join('\n');
}

function normalizeMessage(message) {
  return String(message || '')
    .replace(/\b(?:asset|file|https?):\/\/\S+/gi, '[url]')
    .replace(/\/Users\/\S+/g, '[path]')
    .replace(/[A-Za-z]:\\\S+/g, '[path]')
    .replace(/\b\d+\b/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function normalizeDimension(value) {
  return String(value ?? '')
    .replace(/\b(?:asset|file|https?):\/\/\S+/gi, '[url]')
    .replace(/\/Users\/\S+/g, '[path]')
    .replace(/[A-Za-z]:\\\S+/g, '[path]')
    .replace(/[^A-Za-z0-9_.:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 120);
}

function firstContextValue(context, keys) {
  for (const key of keys) {
    const value = context?.[key];
    if (value === undefined || value === null || value === '') continue;
    return value;
  }
  return '';
}

function topStackFrame(stack) {
  return String(stack || '')
    .split(/\r?\n/)
    .map(normalizeFrameLine)
    .filter((line) => line && /(?:\bat\b|@|\[url\]|\[path\])/.test(line))
    [0] || '';
}

function crashGroupingSummary(sanitized) {
  const app = sanitized?.app || {};
  const report = sanitized?.report || {};
  const context = report.context || {};
  const errorCode = normalizeDimension(firstContextValue(context, [
    'errorCode',
    'code',
    'statusCode',
    'status',
    'errorKind',
    'name'
  ]));
  const command = normalizeDimension(context.command || '');
  const backend = normalizeDimension(context.backend || '');
  const sourceMode = normalizeDimension(context.sourceMode || '');
  const mediaType = normalizeDimension(context.mediaType || '');
  const nativeOutputActive = context.nativeOutputActive === undefined ? '' : String(Boolean(context.nativeOutputActive));
  const platform = [
    normalizeDimension(app.os || ''),
    normalizeDimension(app.arch || '')
  ].filter(Boolean).join('/');
  const frame = topStackFrame(report.stack || '');
  const message = normalizeMessage(report.message || '');
  const basis = errorCode ? 'error-code' : frame ? 'stack-frame' : 'message';

  return {
    basis,
    kind: normalizeDimension(report.kind || ''),
    surface: normalizeDimension(report.surface || ''),
    platform,
    command,
    backend,
    sourceMode,
    mediaType,
    nativeOutputActive,
    errorCode,
    stackFrame: basis === 'stack-frame' ? frame : '',
    message: basis === 'message' ? message : ''
  };
}

function crashGroupingInput(sanitized) {
  const grouping = crashGroupingSummary(sanitized);
  const parts = [
    `kind:${grouping.kind}`,
    `surface:${grouping.surface}`,
    `platform:${grouping.platform}`,
    `command:${grouping.command}`,
    `backend:${grouping.backend}`,
    `source:${grouping.sourceMode}`,
    `media:${grouping.mediaType}`,
    `native:${grouping.nativeOutputActive}`,
    `basis:${grouping.basis}`
  ];
  if (grouping.errorCode) {
    parts.push(`code:${grouping.errorCode}`);
  } else if (grouping.stackFrame) {
    parts.push(`frame:${grouping.stackFrame}`);
  } else {
    parts.push(`message:${grouping.message}`);
  }
  return parts.join('\n');
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function crashFingerprint(sanitized) {
  const input = crashGroupingInput(sanitized);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return hex(digest).slice(0, 20);
}

export {
  crashGroupingInput,
  crashGroupingSummary,
  normalizeDimension,
  normalizeFrameLine,
  normalizeMessage,
  normalizedStack,
  topStackFrame
};
