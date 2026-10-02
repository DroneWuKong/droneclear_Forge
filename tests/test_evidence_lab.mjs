import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../forge-source/evidence-lab.html', import.meta.url), 'utf8');
const build = readFileSync(new URL('../build_static.py', import.meta.url), 'utf8');

test('Evidence Lab exposes only aggregate status and preserves review boundaries', () => {
  assert.match(page, /fetch\('\/api\/autonomy\/status'/);
  assert.match(page, /No AI conclusion is written automatically/);
  assert.match(page, /Hardware, installed-device, field, flight, and safety/);
  assert.doesNotMatch(page, /PATTERNS_REVIEW_TOKEN|Authorization: Bearer/);
});

test('Evidence Lab has a clean static production route', () => {
  assert.match(build, /'evidence-lab\.html': 'evidence-lab\/index\.html'/);
});

