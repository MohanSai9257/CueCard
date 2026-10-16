const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

class SecureStore {
  constructor(file, encryption = safeStorage) {
    this.file = file;
    this.encryption = encryption;
    this.queue = Promise.resolve();
    this.cache = null;
  }
  available() {
    return (
      this.encryption.isEncryptionAvailable() &&
      !(process.platform === 'linux' && this.encryption.getSelectedStorageBackend() === 'basic_text')
    );
  }
  async read() {
    if (!this.available())
      throw new Error(
        'Secure storage is locked or unavailable. Unlock your system keychain and reopen CueCard.',
      );
    try {
      if (this.cache !== null) return structuredClone(this.cache);
      this.cache = JSON.parse(this.encryption.decryptString(await fs.readFile(this.file)));
      return structuredClone(this.cache);
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Saved data could not be unlocked. Your encrypted file has been preserved.', {
        cause: error,
      });
    }
  }
  update(change) {
    const operation = this.queue.then(async () => {
      const data = await this.read();
      const result = await change(data);
      const encrypted = this.encryption.encryptString(JSON.stringify(data));
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = this.file + '.tmp';
      await fs.writeFile(temporary, encrypted, { mode: 0o600 });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.file);
      this.cache = data;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async snapshot() {
    await this.queue;
    return this.read();
  }
}
module.exports = { SecureStore };
