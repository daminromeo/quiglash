/**
 * Quiglash — a Quiplash-style party game for Megan's bachelorette.
 *
 * One process serves three surfaces:
 *   /        players (phones)
 *   /host    the big screen
 *   /edit    the question editor
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const DATA_DIR = path.join(__dirname, 'data');
const ASSET_DIR = path.join(__dirname, 'public', 'assets');
const PORT = Number(process.env.PORT) || 3000;

/* ------------------------------------------------------------------ data -- */

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch (err) {
    console.error(`[data] could not read ${file}:`, err.message);
    return fallback;
  }
};

const loadConfig = () => ({
  brideName: 'Megan',
  location: 'North Carolina',
  gameTitle: 'Quiglash',
  tagline: '',
  hashtag: '',
  judgeAnswersToo: false,
  pointsForBest: 1000,
  pointsForRunnerUp: 500,
  enableRunnerUp: true,
  answerTimeLimitSeconds: 0,
  maxAnswerLength: 180,
  questionsPerGame: 0,
  shuffleQuestions: false,
  ...readJson('config.json', {}),
});

const loadQuestions = () => readJson('questions.json', []);

/** Swap {bride} / {location} tokens so the question bank stays reusable. */
const fillTokens = (text, config) =>
  String(text || '')
    .replace(/\{bride\}/gi, config.brideName)
    .replace(/\{location\}/gi, config.location);

/* ----------------------------------------------------------------- rooms -- */

const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — reads badly on a TV

const makeCode = () => {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
};

const id = () => crypto.randomBytes(9).toString('base64url');

function createRoom() {
  const config = loadConfig();
  const bank = loadQuestions();
  let order = bank.map((_, i) => i);
  if (config.shuffleQuestions) order = shuffle(order);
  if (config.questionsPerGame > 0) order = order.slice(0, config.questionsPerGame);

  const room = {
    code: makeCode(),
    createdAt: Date.now(),
    config,
    bank,
    order,
    hostSockets: new Set(),
    players: new Map(),
    judgeId: null,
    phase: 'lobby', // lobby | question | reveal | judging | scored | final
    round: -1,
    answers: new Map(), // answerId -> { id, playerId, text, revealed, award }
    awaiting: null, // 'best' | 'runnerUp'
    deadline: null,
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const currentQuestion = (room) => {
  if (room.round < 0 || room.round >= room.order.length) return null;
  const q = room.bank[room.order[room.round]];
  if (!q) return null;
  return { id: q.id, text: fillTokens(q.text, room.config), media: q.media || null };
};

/** Everyone who is expected to type an answer this round. */
const answerers = (room) =>
  [...room.players.values()].filter(
    (p) => p.id !== room.judgeId || room.config.judgeAnswersToo
  );

const allAnswersIn = (room) => {
  const expected = answerers(room).filter((p) => p.connected);
  return expected.length > 0 && expected.every((p) => room.submittedThisRound?.has(p.id));
};

/* ----------------------------------------------------------- state views -- */

function viewFor(room, role, playerId) {
  const q = currentQuestion(room);
  const showText = room.phase !== 'question';
  const showAuthors = room.phase === 'scored' || room.phase === 'final';

  const answers = [...room.answers.values()].map((a) => ({
    id: a.id,
    text: showText && a.revealed ? a.text : null,
    revealed: a.revealed,
    award: a.award || null,
    author: showAuthors ? room.players.get(a.playerId)?.name || 'Ghost' : null,
  }));

  const players = [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      isJudge: p.id === room.judgeId,
      answered: !!room.submittedThisRound?.has(p.id),
      answering: p.id !== room.judgeId || room.config.judgeAnswersToo,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const me = playerId ? room.players.get(playerId) : null;
  const myAnswer = me
    ? [...room.answers.values()].find((a) => a.playerId === me.id)
    : null;

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    totalRounds: room.order.length,
    config: room.config,
    question: q,
    players,
    answers,
    revealedCount: answers.filter((a) => a.revealed).length,
    awaiting: room.awaiting,
    deadline: room.deadline,
    judgeName: room.players.get(room.judgeId)?.name || null,
    allIn: allAnswersIn(room),
    you: {
      role,
      id: me?.id || null,
      name: me?.name || null,
      isJudge: !!me && me.id === room.judgeId,
      answering: me ? me.id !== room.judgeId || room.config.judgeAnswersToo : false,
      submitted: !!myAnswer,
      answerText: myAnswer?.text || '',
    },
  };
}

function broadcast(room) {
  for (const sid of room.hostSockets) {
    io.to(sid).emit('state', viewFor(room, 'host', null));
  }
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('state', viewFor(room, 'player', p.id));
  }
}

/* ------------------------------------------------------------ game flow -- */

function startRound(room, index) {
  clearTimeout(room.timer);
  room.round = index;
  room.answers = new Map();
  room.submittedThisRound = new Set();
  room.awaiting = null;
  room.deadline = null;

  if (room.round >= room.order.length) {
    room.phase = 'final';
    broadcast(room);
    return;
  }

  room.phase = 'question';
  const limit = Number(room.config.answerTimeLimitSeconds) || 0;
  if (limit > 0) {
    room.deadline = Date.now() + limit * 1000;
    room.timer = setTimeout(() => {
      if (room.phase === 'question') toReveal(room);
    }, limit * 1000 + 500);
  }
  broadcast(room);
}

function toReveal(room) {
  clearTimeout(room.timer);
  room.deadline = null;
  if (room.answers.size === 0) {
    // Nothing to read — skip straight past this one.
    room.phase = 'scored';
    broadcast(room);
    return;
  }
  // Shuffle so reading order never gives away who wrote what.
  const shuffled = shuffle([...room.answers.values()]);
  room.answers = new Map(shuffled.map((a) => [a.id, a]));
  room.phase = 'reveal';
  broadcast(room);
}

function award(room, answerId, kind) {
  const answer = room.answers.get(answerId);
  if (!answer || answer.award) return;
  const player = room.players.get(answer.playerId);
  const points =
    kind === 'best'
      ? Number(room.config.pointsForBest) || 1000
      : Number(room.config.pointsForRunnerUp) || 500;
  answer.award = kind;
  if (player) player.score += points;

  const canRunnerUp =
    kind === 'best' &&
    room.config.enableRunnerUp &&
    [...room.answers.values()].filter((a) => !a.award).length > 0;

  if (canRunnerUp) {
    room.awaiting = 'runnerUp';
  } else {
    room.awaiting = null;
    room.phase = 'scored';
  }
  broadcast(room);
}

/* -------------------------------------------------------------- express -- */

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/edit', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'edit.html')));

app.get('/api/questions', (_req, res) =>
  res.json({ config: loadConfig(), questions: loadQuestions() })
);

app.post('/api/questions', (req, res) => {
  const { questions, config } = req.body || {};
  if (!Array.isArray(questions)) return res.status(400).json({ error: 'questions must be an array' });
  const clean = questions
    .filter((q) => q && String(q.text || '').trim())
    .map((q, i) => ({
      id: q.id || `q${i + 1}`,
      text: String(q.text).trim(),
      media: q.media && q.media.src ? { type: q.media.type || 'image', src: q.media.src } : null,
    }));
  fs.writeFileSync(path.join(DATA_DIR, 'questions.json'), JSON.stringify(clean, null, 2));
  if (config && typeof config === 'object') {
    fs.writeFileSync(
      path.join(DATA_DIR, 'config.json'),
      JSON.stringify({ ...loadConfig(), ...config }, null, 2)
    );
  }
  res.json({ ok: true, count: clean.length });
});

/** Raw-body upload so we don't need a multipart dependency. */
app.post('/api/upload', express.raw({ type: '*/*', limit: '80mb' }), (req, res) => {
  const raw = String(req.query.name || 'upload');
  const ext = (path.extname(raw) || '').toLowerCase().slice(0, 6);
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov', '.m4v'];
  if (!allowed.includes(ext)) return res.status(400).json({ error: `unsupported file type ${ext}` });
  const safe = `${Date.now()}-${path.basename(raw, ext).replace(/[^a-z0-9-_]/gi, '_').slice(0, 40)}${ext}`;
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSET_DIR, safe), req.body);
  res.json({ src: `/assets/${safe}`, type: ['.mp4', '.webm', '.mov', '.m4v'].includes(ext) ? 'video' : 'image' });
});

/* --------------------------------------------------------------- sockets -- */

const findRoom = (code) => rooms.get(String(code || '').toUpperCase().trim());

io.on('connection', (socket) => {
  let joined = null; // { code, role, playerId }

  const room = () => (joined ? rooms.get(joined.code) : null);
  const isHost = () => joined?.role === 'host';
  const isJudge = () => {
    const r = room();
    return isHost() || (r && joined.playerId && joined.playerId === r.judgeId);
  };

  socket.on('host:create', async (_payload, ack) => {
    const r = createRoom();
    joined = { code: r.code, role: 'host', playerId: null };
    r.hostSockets.add(socket.id);
    socket.join(r.code);
    ack?.({ code: r.code, ...(await joinInfo(r.code, socket)) });
    broadcast(r);
  });

  socket.on('host:reclaim', async ({ code } = {}, ack) => {
    const r = findRoom(code);
    if (!r) return ack?.({ error: 'That game is over — start a new one.' });
    joined = { code: r.code, role: 'host', playerId: null };
    r.hostSockets.add(socket.id);
    socket.join(r.code);
    ack?.({ code: r.code, ...(await joinInfo(r.code, socket)) });
    broadcast(r);
  });

  socket.on('player:join', ({ code, name } = {}, ack) => {
    const r = findRoom(code);
    if (!r) return ack?.({ error: 'No game with that code. Check the screen!' });
    const clean = String(name || '').trim().slice(0, 18);
    if (!clean) return ack?.({ error: 'Enter a name first.' });
    const taken = [...r.players.values()].find(
      (p) => p.name.toLowerCase() === clean.toLowerCase()
    );
    if (taken && taken.connected) {
      return ack?.({ error: 'Someone already grabbed that name.' });
    }
    if (taken) {
      // Same name, but that phone dropped off — hand the identity (and score) back.
      taken.socketId = socket.id;
      taken.connected = true;
      joined = { code: r.code, role: 'player', playerId: taken.id };
      socket.join(r.code);
      ack?.({ code: r.code, playerId: taken.id, name: taken.name });
      broadcast(r);
      return;
    }

    const player = {
      id: id(),
      name: clean,
      score: 0,
      socketId: socket.id,
      connected: true,
    };
    r.players.set(player.id, player);
    // The bride judges by default — crown her automatically on name match.
    if (!r.judgeId && clean.toLowerCase() === String(r.config.brideName).toLowerCase()) {
      r.judgeId = player.id;
    }
    joined = { code: r.code, role: 'player', playerId: player.id };
    socket.join(r.code);
    ack?.({ code: r.code, playerId: player.id, name: player.name });
    broadcast(r);
  });

  socket.on('player:rejoin', ({ code, playerId } = {}, ack) => {
    const r = findRoom(code);
    const p = r?.players.get(playerId);
    if (!r || !p) return ack?.({ error: 'stale' });
    p.socketId = socket.id;
    p.connected = true;
    joined = { code: r.code, role: 'player', playerId: p.id };
    socket.join(r.code);
    ack?.({ code: r.code, playerId: p.id, name: p.name });
    broadcast(r);
  });

  socket.on('player:answer', ({ text } = {}, ack) => {
    const r = room();
    if (!r || r.phase !== 'question' || !joined?.playerId) return ack?.({ error: 'Too late!' });
    const p = r.players.get(joined.playerId);
    if (!p) return ack?.({ error: 'Not in this game.' });
    if (p.id === r.judgeId && !r.config.judgeAnswersToo) {
      return ack?.({ error: 'You are the judge — sit this one out.' });
    }
    const clean = String(text || '').trim().slice(0, Number(r.config.maxAnswerLength) || 180);
    if (!clean) return ack?.({ error: 'Type something!' });

    const existing = [...r.answers.values()].find((a) => a.playerId === p.id);
    if (existing) {
      existing.text = clean;
    } else {
      const aid = id();
      r.answers.set(aid, { id: aid, playerId: p.id, text: clean, revealed: false, award: null });
    }
    r.submittedThisRound.add(p.id);
    ack?.({ ok: true });
    if (allAnswersIn(r)) toReveal(r);
    else broadcast(r);
  });

  /* ---- host / judge controls ---- */

  socket.on('host:setJudge', ({ playerId } = {}) => {
    const r = room();
    if (!r || !isHost()) return;
    r.judgeId = r.players.has(playerId) ? playerId : null;
    broadcast(r);
  });

  socket.on('host:kick', ({ playerId } = {}) => {
    const r = room();
    if (!r || !isHost()) return;
    r.players.delete(playerId);
    if (r.judgeId === playerId) r.judgeId = null;
    broadcast(r);
  });

  socket.on('host:start', () => {
    const r = room();
    if (!r || !isHost()) return;
    if (r.players.size === 0) return;
    startRound(r, 0);
  });

  socket.on('host:forceReveal', () => {
    const r = room();
    if (r && isHost() && r.phase === 'question') toReveal(r);
  });

  socket.on('host:revealNext', () => {
    const r = room();
    if (!r || !isHost() || r.phase !== 'reveal') return;
    const next = [...r.answers.values()].find((a) => !a.revealed);
    if (next) next.revealed = true;
    if (![...r.answers.values()].some((a) => !a.revealed)) {
      r.phase = 'judging';
      r.awaiting = 'best';
    }
    broadcast(r);
  });

  socket.on('host:revealAll', () => {
    const r = room();
    if (!r || !isHost() || r.phase !== 'reveal') return;
    for (const a of r.answers.values()) a.revealed = true;
    r.phase = 'judging';
    r.awaiting = 'best';
    broadcast(r);
  });

  socket.on('judge:award', ({ answerId, kind } = {}) => {
    const r = room();
    if (!r || !isJudge() || r.phase !== 'judging') return;
    if (kind !== 'best' && kind !== 'runnerUp') return;
    if (r.awaiting !== kind) return;
    award(r, answerId, kind);
  });

  socket.on('judge:skipRunnerUp', () => {
    const r = room();
    if (!r || !isJudge() || r.awaiting !== 'runnerUp') return;
    r.awaiting = null;
    r.phase = 'scored';
    broadcast(r);
  });

  socket.on('host:next', () => {
    const r = room();
    if (!r || !isHost()) return;
    startRound(r, r.round + 1);
  });

  socket.on('host:skipQuestion', () => {
    const r = room();
    if (!r || !isHost()) return;
    startRound(r, r.round + 1);
  });

  socket.on('host:restart', () => {
    const r = room();
    if (!r || !isHost()) return;
    for (const p of r.players.values()) p.score = 0;
    r.config = loadConfig();
    r.bank = loadQuestions();
    r.order = r.bank.map((_, i) => i);
    if (r.config.shuffleQuestions) r.order = shuffle(r.order);
    if (r.config.questionsPerGame > 0) r.order = r.order.slice(0, r.config.questionsPerGame);
    r.phase = 'lobby';
    r.round = -1;
    r.answers = new Map();
    r.submittedThisRound = new Set();
    broadcast(r);
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    r.hostSockets.delete(socket.id);
    if (joined?.playerId) {
      const p = r.players.get(joined.playerId);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        p.socketId = null;
      }
    }
    broadcast(r);
  });
});

/* ------------------------------------------------------- join URL + QR -- */

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function baseUrl(socket) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');

  // Deployed: trust the address the big screen was actually opened on, so the QR
  // points at the public hostname without anyone configuring anything.
  const headers = socket?.handshake?.headers || {};
  const host = headers['x-forwarded-host'] || headers.host;
  if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)) {
    const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
    return `${proto}://${host}`;
  }
  // Local: localhost is useless on a phone, so hand out the laptop's Wi-Fi address.
  return `http://${lanAddress()}:${PORT}`;
}

async function joinInfo(code, socket) {
  const joinUrl = `${baseUrl(socket)}/?code=${code}`;
  const qr = await QRCode.toDataURL(joinUrl, {
    margin: 1,
    width: 620,
    color: { dark: '#3f2b3c', light: '#fdf7f4' },
  });
  return { joinUrl, qr };
}

/* Sweep abandoned rooms so a long-running deploy doesn't leak memory. */
setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [code, r] of rooms) {
    const live = r.hostSockets.size > 0 || [...r.players.values()].some((p) => p.connected);
    if (!live && r.createdAt < cutoff) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  const local = process.env.PUBLIC_URL
    ? process.env.PUBLIC_URL.replace(/\/$/, '')
    : `http://${lanAddress()}:${PORT}`;
  console.log('');
  console.log('  💍  Quiglash is live');
  console.log(`  📺  Big screen : ${local}/host`);
  console.log(`  📱  Players    : ${local}/`);
  console.log(`  ✏️   Editor     : ${local}/edit`);
  console.log('');
});
