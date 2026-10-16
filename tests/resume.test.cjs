const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseResume, checkDocxSize } = require('../resume-parser');
const fixtures = require('./document-fixtures.cjs');

for (const extension of ['pdf', 'docx']) {
  test(`worker extracts readable ${extension.toUpperCase()} résumé text`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cuecard-unit-document-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, `resume.${extension}`);
    await fs.writeFile(file, fixtures[extension]());
    const result = await parseResume(file);
    assert.equal(result.name, `resume.${extension}`);
    assert.match(result.text, /Test Candidate Backend Engineer/);
  });
}

test('rejects corrupt and oversized ZIP metadata before decompression', () => {
  assert.throws(() => checkDocxSize(Buffer.from('bad')), /valid DOCX/);
  const buffer = Buffer.alloc(68);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt32LE(30 * 1024 * 1024, 24);
  buffer.writeUInt32LE(0x06054b50, 46);
  buffer.writeUInt16LE(1, 56);
  assert.throws(() => checkDocxSize(buffer), /too large/);
});
test('worker rejects invalid documents and enforces its timeout', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cuecard-unit-resume-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'invalid.docx');
  await fs.writeFile(file, 'not a document');
  await assert.rejects(parseResume(file), /valid DOCX/);
  await assert.rejects(parseResume(file, 1), /too long/);
});
