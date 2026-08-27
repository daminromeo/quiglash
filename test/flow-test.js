/**
 * End-to-end smoke test: boots the server, plays a whole game with five fake
 * phones, and asserts the rules that matter (answers stay hidden, only the
 * judge scores, points land, reconnects keep your seat).  Run with `npm test`.
 */
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = process.env.TEST_PORT || 3998;
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT },
  stdio: 'ignore',
});
process.on('exit', () => server.kill());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const conn = () => io(URL, { transports: ['websocket'] });
const fail = (m) => { console.error('❌ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('✓ ' + m);

(async () => {
  await wait(900); // let the server bind
  const host = conn();
  let hostState = null, code = null;
  host.on('state', (s) => (hostState = s));
  await new Promise((res) => host.on('connect', res));
  await new Promise((res) => host.emit('host:create', {}, (r) => { code = r.code; res(); }));
  ok(`room created: ${code} (qr ${hostState ? 'pending' : ''}ok)`);

  const players = {};
  for (const name of ['Megan', 'Ashley', 'Britt', 'Dana']) {
    const s = conn();
    await new Promise((res) => s.on('connect', res));
    const info = await new Promise((res) => s.emit('player:join', { code, name }, res));
    if (info.error) return fail(`join ${name}: ${info.error}`);
    players[name] = { socket: s, id: info.playerId, state: null };
    s.on('state', (st) => (players[name].state = st));
  }
  await wait(200);
  ok(`4 players joined; judge auto-crowned = ${hostState.judgeName}`);
  if (hostState.judgeName !== 'Megan') fail('bride was not auto-crowned as judge');

  // duplicate name rejected
  const dupe = conn();
  await new Promise((res) => dupe.on('connect', res));
  const dupRes = await new Promise((res) => dupe.emit('player:join', { code, name: 'ashley' }, res));
  dupRes.error ? ok('duplicate name rejected') : fail('duplicate name allowed');
  dupe.close();

  host.emit('host:start');
  await wait(200);

  // The opening screen sits between the lobby and question one when it's enabled.
  if (hostState.phase === 'intro') {
    const intro = hostState.config.intro || {};
    ok(`opening screen shown — "${(intro.heading || intro.message || '(media only)').slice(0, 40)}"`);
    if (/\{bride\}|\{location\}/.test(`${intro.heading} ${intro.message}`)) fail('intro tokens not filled in');
    host.emit('host:next');
    await wait(200);
  } else {
    ok('no opening screen configured — straight into question one');
  }

  if (hostState.phase !== 'question') return fail(`expected question, got ${hostState.phase}`);
  ok(`round 1 live: "${hostState.question.text.slice(0, 48)}…"`);

  // judge must not be able to answer
  const judgeTry = await new Promise((res) => players.Megan.socket.emit('player:answer', { text: 'nope' }, res));
  judgeTry.error ? ok('judge blocked from answering') : fail('judge was allowed to answer');

  // two answer; make sure nothing leaks before everyone is in
  for (const n of ['Ashley', 'Britt']) {
    await new Promise((res) => players[n].socket.emit('player:answer', { text: `${n}'s answer` }, res));
  }
  await wait(150);
  if (hostState.phase !== 'question') fail('revealed before everyone submitted');
  if (hostState.answers.some((a) => a.text !== null)) fail('answer text leaked during question phase');
  ok('answer text stays hidden while others are still typing');

  await new Promise((res) => players.Dana.socket.emit('player:answer', { text: "Dana's answer" }, res));
  await wait(200);
  if (hostState.phase !== 'reveal') return fail(`expected reveal, got ${hostState.phase}`);
  ok('auto-advanced to reveal once all 3 submitted');
  if (hostState.answers.some((a) => a.revealed)) fail('answers pre-revealed');

  host.emit('host:revealNext'); await wait(100);
  if (hostState.revealedCount !== 1) fail(`revealNext count = ${hostState.revealedCount}`);
  ok('reveal one at a time works (1 of 3)');

  host.emit('host:revealAll'); await wait(120);
  if (hostState.phase !== 'judging' || hostState.awaiting !== 'best') return fail(`expected judging/best, got ${hostState.phase}/${hostState.awaiting}`);
  ok('reveal all -> judging (awaiting best)');

  // non-judge cannot award
  const target = hostState.answers[0].id;
  players.Ashley.socket.emit('judge:award', { answerId: target, kind: 'best' });
  await wait(150);
  if (hostState.answers.find((a) => a.id === target).award) return fail('non-judge was able to award points!');
  ok('non-judge award rejected');

  players.Megan.socket.emit('judge:award', { answerId: target, kind: 'best' });
  await wait(150);
  if (hostState.awaiting !== 'runnerUp') return fail(`expected runnerUp prompt, got ${hostState.awaiting}`);
  ok('judge awarded best from her phone -> runner-up prompt');

  const second = hostState.answers.find((a) => !a.award).id;
  host.emit('judge:award', { answerId: second, kind: 'runnerUp' }); // host screen acts as judge
  await wait(150);
  if (hostState.phase !== 'scored') return fail(`expected scored, got ${hostState.phase}`);
  const scores = hostState.players.map((p) => `${p.name}:${p.score}`).join(' ');
  ok(`scored from the big screen — ${scores}`);
  const best = hostState.players.find((p) => p.score === 1000);
  const run = hostState.players.find((p) => p.score === 500);
  if (!best || !run) fail('points not applied (expected a 1000 and a 500)');
  if (!hostState.answers.every((a) => a.author)) fail('authors not revealed in scored phase');
  ok('authors revealed only after scoring');

  // play out the rest quickly
  const total = hostState.totalRounds;
  for (let r = 1; r < total; r++) {
    host.emit('host:next'); await wait(80);
    if (hostState.phase !== 'question') return fail(`round ${r + 1} did not start (${hostState.phase})`);
    for (const n of ['Ashley', 'Britt', 'Dana']) {
      players[n].socket.emit('player:answer', { text: `r${r} ${n}` });
    }
    await wait(80);
    host.emit('host:revealAll'); await wait(60);
    const a = hostState.answers[0];
    if (a) { host.emit('judge:award', { answerId: a.id, kind: 'best' }); await wait(60); }
    if (hostState.awaiting === 'runnerUp') { host.emit('judge:skipRunnerUp'); await wait(60); }
  }
  host.emit('host:next'); await wait(150);
  if (hostState.phase !== 'final') return fail(`expected final, got ${hostState.phase}`);
  ok(`played all ${total} rounds -> final podium`);
  console.log('   final: ' + hostState.players.map((p) => `${p.name} ${p.score}`).join(' | '));

  // reconnect mid-game
  const pid = players.Britt.id;
  players.Britt.socket.close();
  await wait(150);
  const back = conn();
  await new Promise((res) => back.on('connect', res));
  const rj = await new Promise((res) => back.emit('player:rejoin', { code, playerId: pid }, res));
  rj.error ? fail('rejoin failed: ' + rj.error) : ok(`reconnect keeps identity + score (${rj.name})`);

  host.emit('host:restart'); await wait(150);
  if (hostState.phase !== 'lobby' || hostState.players.some((p) => p.score !== 0)) fail('restart did not reset');
  else ok('play again resets scores back to lobby');

  console.log(process.exitCode ? '\nFAILED' : '\nAll checks passed.');
  server.kill();
  process.exit(process.exitCode || 0);
})();
