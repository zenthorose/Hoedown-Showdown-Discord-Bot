const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

test('every renderer DOM ID reference exists in the desktop page', async () => {
  const [renderer, html] = await Promise.all([
    fs.readFile(path.join(__dirname, 'renderer.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8')
  ]);
  const pageIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const rendererIds = new Set(
    [...renderer.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)]
      .map((match) => match[1])
  );
  const missingIds = [...rendererIds].filter((id) => !pageIds.has(id));

  assert.deepEqual(missingIds, []);
});
