/**
 * Put an exported backup back into the repo:
 *   npm run restore ~/Downloads/quiglash-backup.json
 * Accepts either the {config, questions} bundle the editor exports, or a bare
 * array of questions.
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run restore -- <path-to-quiglash-backup.json>');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(1);
}

const dataDir = path.join(__dirname, '..', 'data');
const questions = Array.isArray(parsed) ? parsed : parsed.questions;
if (!Array.isArray(questions)) {
  console.error('That file has no questions array in it.');
  process.exit(1);
}

fs.writeFileSync(path.join(dataDir, 'questions.json'), JSON.stringify(questions, null, 2) + '\n');
console.log(`✓ data/questions.json — ${questions.length} questions`);

if (!Array.isArray(parsed) && parsed.config && typeof parsed.config === 'object') {
  const current = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  const merged = { ...current, ...parsed.config };
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(merged, null, 2) + '\n');
  console.log('✓ data/config.json');
}

console.log('\nNow commit the change:  git add data public/assets && git commit -m "update questions"');
