import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const scannedExtensions = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest']);
const issues = [];

const forbidden = [
  {
    name: 'remote URL',
    pattern: /https?:\/\/[^\s"'<>]+/gi
  },
  {
    name: 'protocol-relative remote URL',
    pattern: /(^|[^:])(\/\/[a-z0-9.-]+\.[^\s"'<>]+)/gim
  },
  {
    name: 'remote module import',
    pattern: /\bimport\s*(?:\(|[^'"]*from\s*)['"]https?:\/\//gi
  }
];
const allowedNamespaceUrls = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace'
]);
const allowedLocalUrlPrefixes = [
  'http://asset.localhost',
  'https://asset.localhost',
  'http://127.0.0.1',
  'http://localhost',
  'http://ipc.localhost',
  'ws://127.0.0.1',
  'ws://localhost'
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
      await scanFile(fullPath);
    }
  }
}

async function scanFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  const rel = path.relative(root, filePath);

  for (const check of forbidden) {
    check.pattern.lastIndex = 0;
    let match;
    while ((match = check.pattern.exec(text)) !== null) {
      const matchedText = match[2] || match[0];
      const matchedStart = match.index + match[0].indexOf(matchedText);
      if (matchedStart > 0 && text[matchedStart - 1] === '\\') continue;
      if (allowedNamespaceUrls.has(matchedText)) continue;
      if (allowedLocalUrlPrefixes.some((prefix) => matchedText.startsWith(prefix))) continue;

      const line = text.slice(0, match.index).split('\n').length;
      const snippet = text.slice(match.index, match.index + 120).replace(/\s+/g, ' ');
      issues.push(`${rel}:${line}: ${check.name}: ${snippet}`);
    }
  }
}

try {
  await stat(dist);
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error('dist/ does not exist. Run npm run build first.');
    process.exit(1);
  }
  throw error;
}

await walk(dist);

if (issues.length > 0) {
  console.error('Offline bundle check failed. Runtime assets must not reference remote URLs.');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Offline bundle check passed: no remote runtime URLs found in dist/.');
