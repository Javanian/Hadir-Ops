const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(rootEnv)) {
  const content = fs.readFileSync(rootEnv, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (trimmed.startsWith('EXPO_PUBLIC_')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = value;
      console.log(`[start.js] ${key}=${value}`);
    }
  });
}

// Auto-set Metro host from EXPO_PUBLIC_API_BASE_URL if it's a specific IP
const apiBase = process.env['EXPO_PUBLIC_API_BASE_URL'];
if (apiBase && apiBase !== 'auto') {
  const hostMatch = apiBase.match(/^(?:https?:\/\/)?([^\/:]+)/);
  if (hostMatch) {
    process.env['REACT_NATIVE_PACKAGER_HOSTNAME'] = hostMatch[1];
    console.log(`[start.js] REACT_NATIVE_PACKAGER_HOSTNAME=${hostMatch[1]}`);
  }
}

const args = process.argv.slice(2);
console.log(`[start.js] npx expo ${args.join(' ')}`);

const expo = spawn('npx', ['expo', ...args], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env },
});

expo.on('close', (code) => process.exit(code));
