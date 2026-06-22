import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');

const runtimeAssets = [
  ['codec.js', 'codec.js'],
  ['media', 'media'],
  ['assets/fonts', 'assets/fonts'],
  ['renderers/gpu/assets', 'renderers/gpu/assets']
];
const excludedRuntimeAssets = new Set([
  'media/point-click-test2.mp4'
]);

function runtimeAssetRel(sourcePath) {
  return path.relative(root, sourcePath).split(path.sep).join('/');
}

async function exists(sourcePath) {
  try {
    await stat(sourcePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

await mkdir(dist, { recursive: true });

for (const [from, to] of runtimeAssets) {
  const sourcePath = path.join(root, from);
  if (!(await exists(sourcePath))) continue;

  const targetPath = path.join(dist, to);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    filter: (source) => !excludedRuntimeAssets.has(runtimeAssetRel(source))
  });
  console.log(`copied ${from} -> dist/${to}`);
}
