const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const root = context.packager.projectDir;
  const arch = context.arch === 3 ? 'arm64' : 'x86_64';
  execFileSync(
    'xcrun',
    [
      'swiftc',
      path.join(root, 'scripts/system-audio.swift'),
      '-O',
      '-target',
      `${arch}-apple-macos14.2`,
      '-o',
      path.join(root, `assets/system-audio-${arch}`),
    ],
    { stdio: 'inherit' },
  );
};
