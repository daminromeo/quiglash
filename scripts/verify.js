/**
 * Pre-party check: does the LIVE site match this repo?
 *
 *   npm run verify -- https://your-app.onrender.com
 *
 * Proves the thing that actually matters: the deployed app was rebuilt from the
 * repo and is serving every question and every video file. If this passes, a
 * restart cannot lose anything.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const raw = process.argv[2];
if (!raw) {
  console.error('Usage: npm run verify -- https://your-app.onrender.com');
  process.exit(1);
}
const base = raw.replace(/\/+$/, '');
const root = path.join(__dirname, '..');
const readLocal = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));

let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failed++; console.log(`  ✗ ${m}`); };
const note = (m) => console.log(`    ${m}`);

const get = async (url, opts = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
};

(async () => {
  console.log(`\nChecking ${base} against this repo\n`);

  /* ---- 1. is the repo itself settled? ---- */
  console.log('Repo');
  try {
    const dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
    dirty ? bad(`uncommitted changes:\n${dirty.split('\n').map((l) => '      ' + l).join('\n')}`)
          : ok('working tree clean');
    execSync('git fetch --quiet', { cwd: root, stdio: 'ignore' });
    const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    const remote = execSync('git rev-parse origin/main', { cwd: root, encoding: 'utf8' }).trim();
    head === remote ? ok('pushed — local matches origin/main')
                    : bad('local and origin/main differ — run: git push');
  } catch (err) {
    bad(`could not read git state: ${err.message}`);
  }

  /* ---- 2. what is the live site serving? ---- */
  console.log('\nLive site');
  let live;
  try {
    const res = await get(`${base}/api/questions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    live = await res.json();
    ok('site is awake and answering');
  } catch (err) {
    bad(`could not reach the site: ${err.message}`);
    note('A sleeping free instance can take ~50s — try once more.');
    process.exit(1);
  }

  const localQ = readLocal('questions.json');
  const localC = readLocal('config.json');

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  same(live.questions, localQ)
    ? ok(`all ${localQ.length} questions match the repo`)
    : bad(`questions differ — live has ${(live.questions || []).length}, repo has ${localQ.length}`);

  const liveIntro = (live.config || {}).intro || {};
  const localIntro = localC.intro || {};
  same(liveIntro, localIntro) ? ok('opening screen matches the repo') : bad('opening screen differs from the repo');

  for (const key of ['brideName', 'tagline', 'answerTimeLimitSeconds', 'shuffleQuestions', 'pointsForBest']) {
    if (!same((live.config || {})[key], localC[key])) {
      bad(`setting "${key}" differs — live ${JSON.stringify((live.config || {})[key])}, repo ${JSON.stringify(localC[key])}`);
    }
  }

  /* ---- 3. is the deployed build the current code? ---- */
  console.log('\nDeployed build');
  const crypto = require('crypto');
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  let stale = 0;
  for (const asset of ['/js/host.js', '/js/player.js', '/css/style.css']) {
    const localPath = path.join(root, 'public', asset);
    try {
      const res = await get(`${base}${asset}`);
      if (!res.ok) { bad(`${asset} — HTTP ${res.status}`); continue; }
      const liveHash = sha(Buffer.from(await res.arrayBuffer()));
      const localHash = sha(fs.readFileSync(localPath));
      if (liveHash === localHash) ok(`${asset} matches the repo`);
      else { bad(`${asset} — live ${liveHash}, repo ${localHash}`); stale++; }
    } catch (err) {
      bad(`${asset} — ${err.message}`);
    }
  }
  if (stale) {
    note('The site is running an older build. Render redeploys a minute or two');
    note('after a push — wait, then run this again.');
  }

  /* ---- 4. can it actually serve the videos? ---- */
  console.log('\nMedia');
  const refs = [...new Set(
    localQ.map((q) => q.media).concat([localIntro.media])
      .filter((m) => m && m.src && m.src.startsWith('/assets/'))
      .map((m) => m.src)
  )];
  if (!refs.length) console.log('  (no photos or videos in this question set)');
  for (const src of refs) {
    const localPath = path.join(root, 'public', src);
    const localSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : null;
    if (localSize === null) { bad(`${src} — missing from this repo entirely`); continue; }
    try {
      const res = await get(`${base}${src}`, { method: 'HEAD' });
      if (!res.ok) { bad(`${src} — live site returns HTTP ${res.status}`); continue; }
      const liveSize = Number(res.headers.get('content-length'));
      const type = res.headers.get('content-type') || '';
      if (liveSize && liveSize !== localSize) bad(`${src} — live ${liveSize} bytes vs repo ${localSize}`);
      else ok(`${src} — ${(localSize / 1024 / 1024).toFixed(1)} MB, ${type}`);
    } catch (err) {
      bad(`${src} — ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  if (failed) {
    console.log(`${failed} problem${failed === 1 ? '' : 's'} found. Fix before the party.`);
    process.exit(1);
  }
  console.log('All good. The live site is serving exactly what this repo holds,');
  console.log('so a restart or redeploy cannot lose your questions or videos.');
  console.log(`\nBig screen:  ${base}/host`);
})();
