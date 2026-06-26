import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  charsetChars,
  glyphForLuma,
  processCanvasColorLegacy,
  processGpuCellColor,
  processStreamColorLegacy,
  shaderHash
} from '../renderers/shared/render-math.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const vectors = JSON.parse(await readFile(path.join(root, 'renderers/shared/render-math-vectors.json'), 'utf8'));

for (const vector of vectors.gpu) {
  const actual = processGpuCellColor(...vector.rgb, vector.params);
  assert.deepEqual(actual, vector.expected, `GPU vector failed: ${vector.name}`);
}

for (const vector of vectors.canvasLegacy) {
  const actual = processCanvasColorLegacy(...vector.rgb, vector.params);
  assert.deepEqual(actual, vector.expected, `Canvas legacy vector failed: ${vector.name}`);
  assert.deepEqual(
    processStreamColorLegacy(...vector.rgb, vector.params),
    vector.expected,
    `Stream legacy vector failed: ${vector.name}`
  );
}

assert.equal(charsetChars({ charset: 'blocks' }), ' ░▒▓█');
assert.equal(charsetChars({ charset: 'asciline' }), ' .:-=+*#%@');
assert.equal(glyphForLuma(255, { charset: 'asciline' }), '@');
assert.ok(shaderHash(1, 2) >= 0 && shaderHash(1, 2) < 1);

console.log('Renderer math vector checks passed.');
