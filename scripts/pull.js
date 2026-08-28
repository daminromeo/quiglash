/**
 * Pull everything from the live game back into this repo, so it survives a restart:
 *
 *   npm run pull -- https://your-app.onrender.com
 *
 * Hosted free tiers wipe their filesystem whenever the app restarts. Anything
 * committed here is permanent; anything only on the live site is not. This
 * fetches the questions and party settings AND downloads every photo and video
 * they point at, then tells you what to commit.
 */
const fs = require('fs');
const path = require('path');

const raw = process.argv[2];
if (!raw) {
  console.error('Usage: npm run pull -- https://your-app.onrender.com');
  process.exit(1);
}
const base = raw.replace(/\/+$/, '');
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const assetDir = path.join(root, 'public', 'assets');

const mediaSources = (questions, config) => {
  const all = questions.map((q) => q.media).concat([config.intro && config.intro.media]);
  return [...new Set(
    all.filter((m) => m && typeof m.src === 'string' && m.src.startsWith('/assets/'))
       .map((m) => m.src)
  )];
};

(async () => {
  console.log(`Pulling from ${base}\n`);

  let payload;
  try {
    const res = await fetch(`${base}/api/questions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    console.error(`Could not reach ${base} — ${err.message}`);
    console.error('Is the URL right, and is the app awake? (A sleeping free instance takes ~50s.)');
    process.exit(1);
  }

  const { questions = [], config = {} } = payload;
  if (!Array.isArray(questions) || !questions.length) {
    console.error('That site returned no questions — nothing to pull.');
    process.exit(1);
  }

  fs.writeFileSync(path.join(dataDir, 'questions.json'), JSON.stringify(questions, null, 2) + '\n');
  console.log(`✓ data/questions.json — ${questions.length} questions`);
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  console.log('✓ data/config.json');

  const sources = mediaSources(questions, config);
  if (!sources.length) {
    console.log('\nNo photos or videos to download.');
  } else {
    fs.mkdirSync(assetDir, { recursive: true });
    let fetched = 0;
    for (const src of sources) {
      const name = path.basename(src);
      const dest = path.join(assetDir, name);
      try {
        const res = await fetch(`${base}${src}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const unchanged = fs.existsSync(dest) && fs.statSync(dest).size === bytes.length;
        fs.writeFileSync(dest, bytes);
        fetched++;
        const kb = (bytes.length / 1024).toFixed(0);
        console.log(`${unchanged ? '·' : '✓'} public/assets/${name} (${kb} KB)${unchanged ? ' — already had it' : ''}`);
      } catch (err) {
        console.log(`❌ public/assets/${name} — ${err.message}`);
        console.log('   That question points at a file the live site no longer has.');
      }
    }
    console.log(`\n${fetched} of ${sources.length} media files downloaded.`);
  }

  console.log('\nNow make it permanent:');
  console.log('  git add -A && git commit -m "questions and media from the live game" && git push');
})();
