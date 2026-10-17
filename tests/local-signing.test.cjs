const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  parseIdentities,
  selectIdentity,
  validatePin,
  verifySignature,
  verifyCertificate,
} = require('../scripts/local-signing.cjs');
const hash = 'A'.repeat(40);
const certificate = { hash, name: 'Apple Development: Test Developer (TEAMTEST)' };
test('accepts only valid Apple application signing identities', () => {
  assert.deepEqual(
    parseIdentities(`  1) ${hash} "${certificate.name}"\n  2) ${'B'.repeat(40)} "unrelated certificate"`),
    [certificate],
  );
  assert.deepEqual(selectIdentity([certificate]), certificate);
});
test('no certificate never falls back to ad-hoc signing', () => {
  assert.throws(() => selectIdentity([]), /Ad-hoc signing is intentionally refused/);
  assert.throws(() => selectIdentity([], undefined, hash), /unavailable or expired/);
});
test('refuses ambiguous identities and unintentional certificate rotation', () => {
  const other = { ...certificate, hash: 'B'.repeat(40) };
  assert.throws(() => selectIdentity([certificate, other]), /Multiple/);
  assert.throws(() => selectIdentity([certificate, other], other.hash, hash), /differs/);
  assert.equal(selectIdentity([certificate, other], undefined, hash), certificate);
});
test('keeps version, bundle ID and installation path consistent', () => {
  const pkg = { version: '1.3.2', build: { appId: 'com.cuecard.desktop' } };
  const pin = {
    version: pkg.version,
    bundleId: pkg.build.appId,
    installPath: '/test/Applications/CueCard.app',
  };
  assert.doesNotThrow(() => validatePin(pin, pkg, pin.installPath));
  assert.throws(() => validatePin(pin, { ...pkg, version: '2.0.0' }, pin.installPath), /version/);
  assert.throws(() => validatePin(pin, pkg, '/another/CueCard.app'), /install path/);
});
test('built signature must have a Team ID and not be ad-hoc', () => {
  assert.throws(() => verifySignature('Signature=adhoc\nTeamIdentifier=not set'), /no stable/);
  assert.throws(() => verifySignature('Identifier=com.cuecard.desktop'), /no stable/);
  assert.doesNotThrow(() => verifySignature('Authority=Apple Development: Test\nTeamIdentifier=TEAMTEST01'));
});
test('app and helper leaf certificates must match the pinned fingerprint', () => {
  const der = Buffer.from('synthetic certificate bytes');
  const fingerprint = createHash('sha1').update(der).digest('hex');
  assert.doesNotThrow(() => verifyCertificate(der, fingerprint));
  assert.throws(() => verifyCertificate(der, 'F'.repeat(40)), /different certificate/);
});
