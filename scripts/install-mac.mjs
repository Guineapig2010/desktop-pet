// Builds "Albuquerque Buddy.app" for this Mac and puts it in your Applications folder.
//   npm run install-app
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('This installer is for macOS. Use `npm start` on other systems.');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
console.log(`Building Albuquerque Buddy.app for ${arch}… (about a minute)`);
execFileSync('npm', ['run', 'package:mac', '--', `--arch=${arch}`], { cwd: root, stdio: 'inherit' });
const built = path.join(root, 'dist', `Albuquerque Buddy-darwin-${arch}`, 'Albuquerque Buddy.app');
if (!fs.existsSync(built)) {
  console.error(`Build output not found: ${built}`);
  process.exit(1);
}

// quit a running copy first
try {
  execFileSync('osascript', ['-e', 'tell application "Albuquerque Buddy" to quit'], { stdio: 'ignore' });
} catch {
  /* not running */
}
let dest = '/Applications/Albuquerque Buddy.app';
try {
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync('ditto', [built, dest]);
} catch {
  dest = path.join(os.homedir(), 'Applications', 'Albuquerque Buddy.app');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync('ditto', [built, dest]);
}
console.log(`\n✅ Installed: ${dest}`);
console.log('Opening it now. Next time, open "Albuquerque Buddy" from Launchpad, Spotlight (⌘ Space) or your Applications folder.');
execFileSync('open', [dest]);
