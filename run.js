// run.js
// Node.js 14+
// Usage: node run.js
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const os = require('os');
const path = require('path');

const WALLET = process.env.WALLET || '44ERznPwTmsLqLwwPXkA4W7YX42LeTAPjJ3VYazpKDuEGfZ59LAAdY88RCNMWjU64X5Bva27iWvsS8xQUSbjkKgk1X3td8f';
const POOL_PRIMARY = process.env.POOL_PRIMARY || 'stratum+ssl://gulf.moneroocean.stream:20128';
const POOL_FALLBACK = process.env.POOL_FALLBACK || 'stratum+tcp://gulf.moneroocean.stream:10128';
const POOL_ALT = process.env.POOL_ALT || 'stratum+ssl://eu.moneroocean.stream:20128';

const XMRIG_VERSION = process.env.XMRIG_VERSION || '6.24.0';
const FNAME = `xmrig-${XMRIG_VERSION}-linux-static-x64.tar.gz`;
const URL = `https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VERSION}/${FNAME}`;
const SHA256_EXPECT = process.env.XMRIG_SHA256 || '129cfbfbe4c37a970abab20202639c1481ed0674ff9420d507f6ca4f2ed7796a';

async function download(url, dest) {
  return new Promise((res, rej) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.headers.location) {
        return download(r.headers.location, dest).then(res).catch(rej);
      }
      if (r.statusCode !== 200) return rej(new Error('Download failed: ' + r.statusCode));
      r.pipe(file);
      file.on('finish', () => file.close(res));
    }).on('error', rej);
  });
}

function sha256File(pathname) {
  const hash = crypto.createHash('sha256');
  const s = fs.createReadStream(pathname);
  return new Promise((res, rej) => {
    s.on('data', d => hash.update(d));
    s.on('end', () => res(hash.digest('hex')));
    s.on('error', rej);
  });
}

function findXmrig(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === 'xmrig') return p;
    if (e.isDirectory()) {
      const r = findXmrig(p);
      if (r) return r;
    }
  }
  return null;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miner-'));
  const archive = path.join(tmp, 'xmrig.tgz');
  console.log('Tmp dir:', tmp);
  console.log('Downloading', URL);
  await download(URL, archive);
  console.log('Download complete. Verifying SHA256...');
  const actual = await sha256File(archive);
  if (actual !== SHA256_EXPECT) {
    console.error('SHA256 mismatch!', actual, '!=', SHA256_EXPECT);
    process.exit(1);
  }
  console.log('SHA256 OK. Extracting...');
  // ensure tar available
  const tarCheck = spawnSync('tar', ['--version']);
  if (tarCheck.error) { console.error('tar command not found. Install tar.'); process.exit(1); }
  spawnSync('tar', ['-xzf', archive, '-C', tmp]);
  const xmrig = findXmrig(tmp);
  if (!xmrig) { console.error('xmrig binary not found in archive'); process.exit(1); }
  fs.chmodSync(xmrig, 0o755);
  console.log('Found xmrig:', xmrig);

  // write config.json
  const config = {
    autosave: true,
    cpu: { enabled: true, "huge-pages": true },
    pools: [
      { url: POOL_PRIMARY, user: WALLET, pass: `worker-${Date.now()}`, keepalive: true },
      { url: POOL_FALLBACK, user: WALLET, pass: `worker-${Date.now()}`, keepalive: true },
      { url: POOL_ALT, user: WALLET, pass: `worker-${Date.now()}`, keepalive: true }
    ]
  };
  const cfgPath = path.join(tmp, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
  console.log('Wrote config.json');

  console.log('Starting xmrig (press Ctrl-C to stop)...');
  const child = spawn(xmrig, ['--config=' + cfgPath, '--print-time', '60'], { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.log('xmrig exited with', code);
    try { fs.rmSync(tmp, { recursive: true }); } catch(e){}
    process.exit(code || 0);
  });
})();
