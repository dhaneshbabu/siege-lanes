// Copies the built web bundle into the Android app's assets.
import fs from 'node:fs';
const to = 'android/app/src/main/assets/web';
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync('android/app/src/main/assets', { recursive: true });
fs.cpSync('dist', to, { recursive: true });
console.log('copied dist/ ->', to);
