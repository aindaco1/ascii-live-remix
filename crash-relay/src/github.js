import { createAppAuth } from '@octokit/auth-app';
import { crashGroupingSummary } from './fingerprint.js';
import { checkDailyIssueLimit, shouldUpdateIssue } from './rate-limit.js';

const GITHUB_API_VERSION = '2022-11-28';

function repoConfig(env) {
  return {
    owner: String(env.GITHUB_OWNER || 'aindaco1'),
    repo: String(env.GITHUB_REPO || 'ascii-vj-remix')
  };
}

function labels(env) {
  return String(env.CRASH_LABELS || 'crash,automated-report,needs-triage')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

async function installationToken(env) {
  for (const key of ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY']) {
    if (!env[key]) throw new Error(`${key} is not configured`);
  }
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    installationId: env.GITHUB_APP_INSTALLATION_ID,
    privateKey: normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY)
  });
  const result = await auth({ type: 'installation' });
  return result.token;
}

async function githubRequest(env, path, options = {}) {
  const token = await installationToken(env);
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ascii-vj-crash-relay',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || `GitHub API error ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function stateMarker(state) {
  return `<!-- crash-report-state:${btoa(JSON.stringify(state))} -->`;
}

function fingerprintMarker(fingerprint) {
  return `<!-- crash-fingerprint:${fingerprint} -->`;
}

function parseState(body, fingerprint) {
  const marker = String(body || '').match(/<!-- crash-report-state:([A-Za-z0-9+/=]+) -->/);
  if (!marker) {
    return {
      fingerprint,
      count: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: null,
      versions: {},
      platforms: {},
      grouping: null
    };
  }
  try {
    return {
      fingerprint,
      count: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: null,
      versions: {},
      platforms: {},
      grouping: null,
      ...JSON.parse(atob(marker[1]))
    };
  } catch {
    return {
      fingerprint,
      count: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: null,
      versions: {},
      platforms: {},
      grouping: null
    };
  }
}

function summarizeContext(context = {}) {
  const rows = [];
  for (const key of ['surface', 'command', 'backend', 'sourceMode', 'mediaType', 'nativeOutputActive', 'errorCode', 'code', 'statusCode']) {
    const value = context[key];
    if (value === undefined || value === null || value === '') continue;
    rows.push(`- ${key}: \`${String(value).slice(0, 160)}\``);
  }
  return rows.length ? rows.join('\n') : '- none';
}

function countRows(map = {}) {
  return Object.entries(map || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `- ${key}: ${count}`)
    .join('\n') || '- none';
}

function summarizeGrouping(grouping = {}) {
  const rows = [];
  for (const key of [
    'basis',
    'kind',
    'surface',
    'platform',
    'command',
    'backend',
    'sourceMode',
    'mediaType',
    'nativeOutputActive',
    'errorCode',
    'stackFrame',
    'message'
  ]) {
    const value = grouping?.[key];
    if (value === undefined || value === null || value === '') continue;
    rows.push(`- ${key}: \`${String(value).slice(0, 240)}\``);
  }
  return rows.length ? rows.join('\n') : '- none';
}

function issueTitle(sanitized, fingerprint) {
  const message = sanitized.report.message.replace(/\s+/g, ' ').slice(0, 82);
  return `[Crash ${fingerprint}] ${message || sanitized.report.kind}`;
}

function issueBody(sanitized, fingerprint, state) {
  const app = sanitized.app;
  const report = sanitized.report;
  const versions = Object.entries(state.versions || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([version, count]) => `- ${version}: ${count}`)
    .join('\n') || '- none';
  const platforms = countRows(state.platforms);
  const stack = report.stack ? `\n\`\`\`text\n${report.stack}\n\`\`\`` : '\n_No stack captured._';

  return `${fingerprintMarker(fingerprint)}
${stateMarker(state)}

## Summary

- Fingerprint: \`${fingerprint}\`
- Kind: \`${report.kind}\`
- Surface: \`${report.surface}\`
- Count: \`${state.count}\`
- First seen: \`${state.firstSeen}\`
- Last seen: \`${state.lastSeen}\`

## Grouping

${summarizeGrouping(state.grouping)}

## Latest Report

- App: \`${app.name}\`
- Version: \`${app.version}\`
- Identifier: \`${app.identifier}\`
- Channel: \`${app.channel}\`
- Build: \`${app.buildProfile}\`
- OS: \`${app.os}\`
- Arch: \`${app.arch}\`
- Captured: \`${report.capturedAt}\`

## Message

\`\`\`text
${report.message}
\`\`\`

## Context

${summarizeContext(report.context)}

## Versions

${versions}

## Platforms

${platforms}

## Stack
${stack}
`;
}

function platformKey(sanitized) {
  return [sanitized?.app?.os || 'unknown', sanitized?.app?.arch || 'unknown']
    .map((part) => String(part || 'unknown').slice(0, 80))
    .join('/');
}

function incrementCount(map, key) {
  const out = { ...(map || {}) };
  const boundedKey = String(key || 'unknown').slice(0, 160);
  out[boundedKey] = Number(out[boundedKey] || 0) + 1;
  return out;
}

function updateAggregateState(state, sanitized, fingerprint, now) {
  state.fingerprint = fingerprint;
  state.grouping = crashGroupingSummary(sanitized);
  state.count = Number(state.count || 0) + 1;
  state.lastSeen = now;
  state.versions = incrementCount(state.versions, sanitized.app.version);
  state.platforms = incrementCount(state.platforms, platformKey(sanitized));
  return state;
}

async function findIndexedIssue(env, fingerprint) {
  if (!env.CRASH_INDEX) return null;
  const indexed = await env.CRASH_INDEX.get(`fp:${fingerprint}`, { type: 'json' }).catch(() => null);
  if (!indexed?.number) return null;
  return Number(indexed.number);
}

async function indexIssue(env, fingerprint, issue) {
  if (!env.CRASH_INDEX || !issue?.number) return;
  await env.CRASH_INDEX.put(`fp:${fingerprint}`, JSON.stringify({
    number: issue.number,
    url: issue.html_url || '',
    updatedAt: new Date().toISOString()
  }));
}

async function searchIssue(env, fingerprint) {
  const { owner, repo } = repoConfig(env);
  const q = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open in:body ${fingerprint}`);
  const data = await githubRequest(env, `/search/issues?q=${q}&per_page=5`, { method: 'GET' });
  const item = (data.items || []).find((issue) => {
    return String(issue.title || '').includes(fingerprint) || String(issue.body || '').includes(fingerprint);
  }) || data.items?.[0];
  return item?.number ? Number(item.number) : null;
}

async function getIssue(env, number) {
  const { owner, repo } = repoConfig(env);
  return githubRequest(env, `/repos/${owner}/${repo}/issues/${number}`, { method: 'GET' });
}

async function createIssue(env, sanitized, fingerprint, state) {
  const allowed = await checkDailyIssueLimit(env);
  if (!allowed.ok) {
    return {
      action: 'limited',
      fingerprint,
      status: allowed.status,
      error: allowed.error
    };
  }
  const { owner, repo } = repoConfig(env);
  const body = {
    title: issueTitle(sanitized, fingerprint),
    body: issueBody(sanitized, fingerprint, state),
    labels: labels(env)
  };
  let issue;
  try {
    issue = await githubRequest(env, `/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (!body.labels.length) throw error;
    issue = await githubRequest(env, `/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: body.title, body: body.body })
    });
  }
  await indexIssue(env, fingerprint, issue);
  return {
    action: 'created',
    fingerprint,
    issueNumber: issue.number,
    issueUrl: issue.html_url
  };
}

async function updateIssue(env, number, sanitized, fingerprint, state) {
  if (!await shouldUpdateIssue(env, fingerprint)) {
    return {
      action: 'aggregated',
      fingerprint,
      issueNumber: number
    };
  }
  const { owner, repo } = repoConfig(env);
  const issue = await githubRequest(env, `/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({
      body: issueBody(sanitized, fingerprint, state)
    })
  });
  await indexIssue(env, fingerprint, issue);
  return {
    action: 'updated',
    fingerprint,
    issueNumber: issue.number,
    issueUrl: issue.html_url
  };
}

export async function submitCrashReport(env, sanitized, fingerprint) {
  const now = new Date().toISOString();
  let issueNumber = await findIndexedIssue(env, fingerprint);
  if (!issueNumber) issueNumber = await searchIssue(env, fingerprint);

  if (issueNumber) {
    const issue = await getIssue(env, issueNumber);
    const state = parseState(issue.body, fingerprint);
    return updateIssue(env, issueNumber, sanitized, fingerprint, updateAggregateState(state, sanitized, fingerprint, now));
  }

  const state = updateAggregateState({
    fingerprint,
    count: 0,
    firstSeen: now,
    lastSeen: null,
    versions: {},
    platforms: {},
    grouping: null
  }, sanitized, fingerprint, now);
  return createIssue(env, sanitized, fingerprint, state);
}

export { fingerprintMarker, issueBody, issueTitle, parseState, stateMarker };
