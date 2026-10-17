import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import signing from './local-signing.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const installPath = path.join(homedir(), 'Applications', 'CueCard.app');
const pinPath = path.join(root, '.cuecard-signing.json');
const checkOnly = process.argv.includes('--check');
const install = process.argv.includes('--install');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

try {
  if (process.platform !== 'darwin') throw new Error('Local Mac signing must run on macOS.');
  if (pkg.build.appId !== 'com.cuecard.desktop' || pkg.build.productName !== 'CueCard')
    throw new Error('CueCard app identity changed. Refusing to replace the installed app.');
  let pin = null;
  try {
    pin = JSON.parse(await readFile(pinPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  signing.validatePin(pin, pkg, installPath);
  const output = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  const identity = signing.selectIdentity(
    signing.parseIdentities(output),
    process.env.CUECARD_SIGN_IDENTITY,
    pin?.identityHash,
  );
  console.log(
    `Stable certificate available (fingerprint ending ${identity.hash.slice(-8)}). Version ${pkg.version}; bundle ID ${pkg.build.appId}.`,
  );
  if (!checkOnly) {
    if (!pin) {
      pin = { identityHash: identity.hash, bundleId: pkg.build.appId, version: pkg.version, installPath };
      await writeFile(pinPath, JSON.stringify(pin, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    execFileSync(
      path.join(root, 'node_modules', '.bin', 'electron-builder'),
      [
        '--mac',
        'dmg',
        `--${arch}`,
        '--publish',
        'never',
        `--config.mac.identity=${identity.hash}`,
        `--config.mac.type=${identity.name.startsWith('Developer ID Application:') ? 'distribution' : 'development'}`,
        '--config.mac.notarize=false',
        '--config.forceCodeSigning=true',
      ],
      { cwd: root, stdio: 'inherit' },
    );
    const built = path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'CueCard.app');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', built]);
    const signature = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', built], { encoding: 'utf8' });
    if (signature.status !== 0) throw new Error('Could not verify the new app signature.');
    signing.verifySignature(signature.stderr);
    const certificateDirectory = await mkdtemp(path.join(tmpdir(), 'cuecard-signature-'));
    try {
      const helperArch = arch === 'arm64' ? 'arm64' : 'x86_64';
      const helper = path.join(
        built,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'assets',
        `system-audio-${helperArch}`,
      );
      for (const [name, target] of [
        ['app', built],
        ['audio', helper],
      ]) {
        const prefix = path.join(certificateDirectory, name);
        execFileSync('/usr/bin/codesign', ['-d', `--extract-certificates=${prefix}`, target]);
        signing.verifyCertificate(await readFile(prefix + '0'), identity.hash);
      }
    } finally {
      await rm(certificateDirectory, { recursive: true, force: true });
    }
    for (const [field, expected] of [
      ['CFBundleIdentifier', pin.bundleId],
      ['CFBundleShortVersionString', pin.version],
    ]) {
      const actual = execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', `Print :${field}`, path.join(built, 'Contents', 'Info.plist')],
        { encoding: 'utf8' },
      ).trim();
      if (actual !== expected)
        throw new Error(`Built ${field} does not match the pinned app. Installation refused.`);
    }
    if (install) {
      const executable = path.join(installPath, 'Contents', 'MacOS', 'CueCard');
      const processes = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).split('\n');
      const pids = processes
        .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
        .filter((match) => match?.[2] === executable)
        .map((match) => Number(match[1]));
      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      for (let attempt = 0; attempt < 60 && pids.some(alive); attempt++) await pause(100);
      if (pids.some(alive))
        throw new Error(
          'CueCard is still running. Quit it from the horse menu and retry; the old app has not been replaced.',
        );
      await mkdir(path.dirname(installPath), { recursive: true });
      const backup = path.join(homedir(), '.Trash', `CueCard-backup-${Date.now()}.app`);
      const hadOld = await exists(installPath);
      if (hadOld) await rename(installPath, backup);
      try {
        await rename(built, installPath);
      } catch (error) {
        if (hadOld) await rename(backup, installPath);
        throw error;
      }
      console.log(
        `Installed at ${installPath}. ${hadOld ? 'Previous copy is recoverable in Trash. ' : ''}Saved keys and sessions were not modified.`,
      );
    } else
      console.log(
        'Build verified. Use npm run install:local to rebuild and replace the one local installation.',
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
