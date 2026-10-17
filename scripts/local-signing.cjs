const path = require('node:path');
const { createHash } = require('node:crypto');

function parseIdentities(output) {
  return [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/gm)]
    .map(([, hash, name]) => ({ hash: hash.toUpperCase(), name }))
    .filter((item) => /^(Apple Development|Mac Developer|Developer ID Application):/.test(item.name));
}

function selectIdentity(identities, requestedHash, pinnedHash) {
  const requested = requestedHash?.toUpperCase();
  const pinned = pinnedHash?.toUpperCase();
  if (requested && pinned && requested !== pinned)
    throw new Error(
      'The selected certificate differs from the pinned certificate. Do not rotate signing identities unintentionally.',
    );
  const hash = requested || pinned;
  if (hash) {
    const found = identities.find((item) => item.hash === hash);
    if (!found)
      throw new Error(
        'The pinned signing certificate and private key are unavailable or expired. Restore them in Keychain; no app was replaced.',
      );
    return found;
  }
  if (!identities.length)
    throw new Error(
      'No stable Apple signing certificate is installed. In Xcode → Settings → Accounts, sign into your Apple Account, select your team → Manage Certificates → + → Apple Development. Then retry. Ad-hoc signing is intentionally refused.',
    );
  if (identities.length !== 1)
    throw new Error(
      'Multiple signing certificates are available. Set CUECARD_SIGN_IDENTITY to the chosen certificate SHA-1 fingerprint; it will be pinned for later builds.',
    );
  return identities[0];
}

function validatePin(pin, pkg, installPath) {
  if (!pin) return;
  if (
    pin.bundleId !== pkg.build.appId ||
    pin.version !== pkg.version ||
    path.resolve(pin.installPath) !== path.resolve(installPath)
  )
    throw new Error(
      'The app version, bundle ID or install path changed from the pinned local build. Restore those values before rebuilding.',
    );
}

function verifySignature(details) {
  if (/Signature=adhoc/.test(details) || !/^TeamIdentifier=[A-Z0-9]{10}$/m.test(details))
    throw new Error('The built app has no stable Apple signing identity. Installation refused.');
}

function verifyCertificate(certificate, expectedHash) {
  const actual = createHash('sha1').update(certificate).digest('hex').toUpperCase();
  if (actual !== expectedHash.toUpperCase())
    throw new Error('The built app was signed with a different certificate. Installation refused.');
}

module.exports = { parseIdentities, selectIdentity, validatePin, verifySignature, verifyCertificate };
