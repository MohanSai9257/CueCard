const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('app controls never create native hover-title tooltips', () => {
  const html = readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /\stitle\s*=/i);
  for (const file of ['renderer.js', 'workspace.js']) {
    const source = readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /\.title\s*=|setAttribute\(\s*['"]title['"]/);
  }
  assert.match(html, /aria-label="Expand CueCard"/);
  assert.match(html, /aria-label="Quit"/);
});
