const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SecureStore } = require('../secure-store');

// Inject a deterministic cipher for unit tests; packaged smoke tests exercise OS safeStorage.
function encryption() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test',
    encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 173),
    decryptString: (value) =>
      Buffer.from(value)
        .map((byte) => byte ^ 173)
        .toString(),
  };
}
test('vault serializes concurrent writes, persists, and never writes plaintext', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cuecard-unit-vault-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'credentials.enc');
  const store = new SecureStore(file, encryption());
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.update((data) => {
        data[i] = 'private-credential';
      }),
    ),
  );
  assert.equal(Object.keys(await store.snapshot()).length, 12);
  const copy = await store.snapshot();
  copy[0] = 'tampered';
  assert.equal((await store.snapshot())[0], 'private-credential');
  assert.equal((await fs.readFile(file)).includes(Buffer.from('private-credential')), false);
  assert.equal(Object.keys(await new SecureStore(file, encryption()).snapshot()).length, 12);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});
test('unavailable encryption refuses plaintext fallback', async () => {
  const cipher = encryption();
  cipher.isEncryptionAvailable = () => false;
  await assert.rejects(new SecureStore('unused', cipher).snapshot(), /locked or unavailable/);
});
test('failed encryption preserves existing encrypted data', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cuecard-unit-vault-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cipher = encryption();
  const store = new SecureStore(path.join(directory, 'data.enc'), cipher);
  await store.update((data) => {
    data.keep = true;
  });
  cipher.encryptString = () => {
    throw new Error('locked');
  };
  await assert.rejects(
    store.update((data) => {
      data.keep = false;
    }),
    /locked/,
  );
  assert.equal((await store.snapshot()).keep, true);
});
