/* Big-screen client: renders whatever phase the room is in. */
(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const controls = $('controls');
  const hint = $('hint');
  const roundPill = $('roundPill');

  let join = { qr: '', joinUrl: '', code: '' };
  let state = null;
  let lastPhase = null;
  let tick = null;

  /* ---------- tiny DOM helper ---------- */
  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid) node.append(kid);
    return node;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const send = (event, payload) => socket.emit(event, payload || {});

  /* ---------- connect / reclaim ---------- */
  const urlCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  const stored = urlCode || sessionStorage.getItem('quiglash-host-code');

  socket.on('connect', () => {
    if (stored) {
      socket.emit('host:reclaim', { code: stored }, (res) => {
        if (res && !res.error) return adopt(res);
        sessionStorage.removeItem('quiglash-host-code');
        if (!urlCode) socket.emit('host:create', {}, adopt);
      });
    } else {
      socket.emit('host:create', {}, adopt);
    }
  });

  function adopt(res) {
    if (!res || res.error) return;
    join = res;
    sessionStorage.setItem('quiglash-host-code', res.code);
  }

  socket.on('state', (s) => {
    state = s;
    render();
  });

  /* ---------- render ---------- */
  function render() {
    if (!state) return;
    const cfg = state.config || {};
    $('brandTitle').textContent = cfg.gameTitle || 'Quiglash';
    $('brandSub').textContent = cfg.tagline || '';

    if (state.phase !== 'lobby' && state.phase !== 'final' && state.round >= 0) {
      roundPill.classList.remove('hidden');
      roundPill.textContent = `Question ${state.round + 1} of ${state.totalRounds}`;
    } else {
      roundPill.classList.add('hidden');
    }

    clear(stage);
    clear(controls);
    hint.textContent = '';
    if (tick) { clearInterval(tick); tick = null; }
    const active = activeMedia();
    if (mediaKeyOf(active?.owner, active?.media) !== mediaKey) releaseMedia();

    ({
      lobby: renderLobby,
      intro: renderIntro,
      question: renderQuestion,
      reveal: renderReveal,
      judging: renderJudging,
      scored: renderScored,
      final: renderFinal,
    }[state.phase] || renderLobby)();

    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      if (state.phase === 'final') burst(90);
    }
  }

  /* ---------- lobby ---------- */
  function renderLobby() {
    const cfg = state.config;
    const qr = el('div', { class: 'qr-card' },
      join.qr ? el('img', { src: join.qr, alt: 'Scan to join' }) : null,
      el('div', { class: 'url', text: join.joinUrl || '' }),
      el('div', { class: 'code-label', text: 'or enter code' }),
      el('div', { class: 'code', text: state.code })
    );

    const chips = el('div', { class: 'player-grid' },
      state.players.map((p, i) =>
        el('div', {
          class: `player-chip clickable ${p.isJudge ? 'judge' : ''} ${p.connected ? '' : 'offline'}`,
          style: `animation-delay:${i * 0.05}s`,
          title: 'Click to crown the judge',
          onclick: () => send('host:setJudge', { playerId: p.isJudge ? null : p.id }),
        }, el('span', { class: 'dot' }), el('span', { text: p.isJudge ? `👑 ${p.name}` : p.name })
      ))
    );

    const side = el('div', { class: 'lobby-side' },
      el('h2', { class: 'script', text: 'Grab your phone, ladies' }),
      el('p', {
        class: 'how',
        text: `Scan the code, pick a name, and wait for ${cfg.brideName} to start the trouble.`,
      }),
      state.players.length
        ? chips
        : el('p', { class: 'waiting-note', text: 'Waiting for the first player…' }),
      el('div', { class: 'rule', text: state.judgeName ? `${state.judgeName} is judging` : 'tap a name to crown the judge' })
    );

    stage.append(el('div', { class: 'lobby' }, qr, side));

    const canStart = state.players.length > 0 && !!state.judgeName;
    controls.append(
      el('button', {
        class: 'btn', disabled: canStart ? null : 'disabled',
        onclick: () => send('host:start'),
      }, el('span', { text: 'Start the games' })),
      el('button', { class: 'btn ghost', onclick: () => window.open('/edit', '_blank') },
        el('span', { text: 'Edit questions' }))
    );
    hint.textContent = canStart
      ? `${state.players.length} player${state.players.length === 1 ? '' : 's'} in the room`
      : 'Crown a judge (tap her name) to begin';
  }

  /* ---------- intro ---------- */
  function renderIntro() {
    const intro = state.config.intro || {};
    if (intro.heading) {
      stage.append(el('div', { class: 'intro-heading script', text: intro.heading }));
    }
    if (intro.media && intro.media.src) {
      const node = mediaFor('intro', intro.media);
      stage.append(el('div', { class: 'question-media intro-media' }, node));
      if (intro.media.type === 'video') stage.append(mediaControls(node));
    }
    if (intro.message) {
      stage.append(el('div', { class: 'intro-message', text: intro.message }));
    }

    controls.append(
      el('button', { class: 'btn', onclick: () => send('host:next') },
        el('span', { text: 'Start question one' })),
      el('button', { class: 'btn ghost', onclick: () => send('host:restart') },
        el('span', { text: 'Back to lobby' }))
    );
    hint.textContent = `${state.players.length} player${state.players.length === 1 ? '' : 's'} ready`;
  }

  /* ---------- question ---------- */
  function renderQuestion() {
    stage.append(questionBlock());

    const waiting = state.players.filter((p) => p.answering);
    stage.append(
      el('div', { class: 'player-grid', style: 'justify-content:center' },
        waiting.map((p) => el('div', {
          class: `player-chip ${p.answered ? 'answered' : ''} ${p.connected ? '' : 'offline'}`,
        }, el('span', { class: 'dot' }), el('span', { text: p.answered ? `${p.name} ✓` : p.name })))
      )
    );

    const done = waiting.filter((p) => p.answered).length;
    stage.append(el('div', {
      class: 'waiting-note',
      text: done === waiting.length && waiting.length
        ? 'Everyone is in — revealing…'
        : `${done} of ${waiting.length} answers submitted`,
    }));

    if (state.deadline) {
      const t = el('div', { class: 'timer' });
      stage.append(t);
      const paint = () => {
        const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
        t.textContent = `${left}s`;
        t.classList.toggle('urgent', left <= 10);
      };
      paint();
      tick = setInterval(paint, 250);
    }

    controls.append(
      el('button', { class: 'btn ghost', onclick: () => send('host:forceReveal') },
        el('span', { text: "Don't wait — show answers" })),
      el('button', { class: 'btn ghost', onclick: () => send('host:skipQuestion') },
        el('span', { text: 'Skip question' }))
    );
    hint.textContent = 'Answers stay hidden until every phone is in';
  }

  /* ---------- reveal ---------- */
  function renderReveal() {
    stage.append(questionBlock(true));
    stage.append(answerList({ clickable: false }));

    const left = state.answers.filter((a) => !a.revealed).length;
    controls.append(
      el('button', { class: 'btn', onclick: () => send('host:revealNext') },
        el('span', { text: left > 1 ? 'Reveal next answer' : 'Reveal last answer' })),
      el('button', { class: 'btn ghost', onclick: () => send('host:revealAll') },
        el('span', { text: 'Reveal all' }))
    );
    hint.textContent = `${state.judgeName || 'The judge'} reads them aloud — ${state.revealedCount} of ${state.answers.length} revealed`;
  }

  /* ---------- judging ---------- */
  function renderJudging() {
    stage.append(questionBlock(true));
    stage.append(el('div', {
      class: 'judge-callout',
      text: state.awaiting === 'runnerUp'
        ? 'And the runner-up?'
        : `${state.judgeName || 'Judge'}, pick your favorite`,
    }));
    stage.append(answerList({ clickable: true }));

    if (state.awaiting === 'runnerUp') {
      controls.append(el('button', { class: 'btn ghost', onclick: () => send('judge:skipRunnerUp') },
        el('span', { text: 'Skip runner-up' })));
    }
    hint.textContent = 'Tap an answer here, or use the judge’s phone';
  }

  /* ---------- scored ---------- */
  function renderScored() {
    stage.append(questionBlock(true));
    stage.append(answerList({ clickable: false, tight: true }));
    stage.append(scoreboard({ compact: true }));
    const last = state.round + 1 >= state.totalRounds;
    controls.append(
      el('button', { class: 'btn', onclick: () => send('host:next') },
        el('span', { text: last ? 'See the winner' : 'Next question' }))
    );
  }

  /* ---------- final ---------- */
  function renderFinal() {
    const ranked = state.players.slice().sort((a, b) => b.score - a.score);
    const [first, second, third] = ranked;

    stage.append(el('div', { class: 'question-text script', style: 'font-family:var(--script);color:var(--gold-soft)', text: 'And the winner is…' }));

    const place = (p, cls, crown) => p ? el('div', { class: `place ${cls}` },
      el('div', { class: 'crown', text: crown }),
      el('div', { class: 'who', text: p.name }),
      el('div', { class: 'pts', text: `${p.score.toLocaleString()} pts` })
    ) : null;

    stage.append(el('div', { class: 'podium' },
      place(second, 'p2', '🥈'), place(first, 'p1', '👑'), place(third, 'p3', '🥉')
    ));
    if (ranked.length > 3) stage.append(scoreboard({ compact: true, skip: 3 }));

    controls.append(
      el('button', { class: 'btn', onclick: () => send('host:restart') },
        el('span', { text: 'Play again' })),
      el('button', { class: 'btn ghost', onclick: () => burst(80) },
        el('span', { text: 'More petals 🌸' }))
    );
    hint.textContent = state.config.hashtag || '';
  }

  /* ---------- shared pieces ---------- */

  /* The stage is rebuilt on every state update (each submitted answer, each
     reveal).  A video must survive that, or it restarts from zero every time
     somebody hits send — so the element is built once per question and moved,
     never recreated. */
  let mediaNode = null;
  let mediaKey = '';
  let soundBlocked = false;

  /** The media the screen should be showing right now, if any. */
  function activeMedia() {
    if (!state) return null;
    if (state.phase === 'intro') {
      const m = state.config.intro && state.config.intro.media;
      return m && m.src ? { owner: 'intro', media: m } : null;
    }
    const q = state.question;
    return q && q.media && q.media.src ? { owner: q.id, media: q.media } : null;
  }

  function releaseMedia() {
    if (mediaNode && mediaNode.pause) mediaNode.pause();
    mediaNode = null;
    mediaKey = '';
    soundBlocked = false;
  }

  const mediaKeyOf = (owner, media) =>
    media && media.src ? `${owner}|${media.type}|${media.src}` : '';

  function mediaFor(owner, media) {
    const key = mediaKeyOf(owner, media);
    if (key === mediaKey && mediaNode) return mediaNode;
    if (mediaNode && mediaNode.pause) mediaNode.pause();
    mediaKey = key;
    soundBlocked = false;

    if (media.type !== 'video') {
      mediaNode = el('img', { src: media.src, alt: '' });
      return mediaNode;
    }

    const v = el('video', { src: media.src, playsinline: '', preload: 'auto' });
    v.muted = false;
    v.volume = 1;
    mediaNode = v;

    // Play with sound. Browsers only allow that once someone has clicked on the
    // page — which by this point they have ('Start the games' / 'Next question').
    // If it's blocked anyway, fall back to a silent play and offer a tap.
    const started = v.play();
    if (started && started.catch) {
      started.catch(() => {
        v.muted = true;
        soundBlocked = true;
        v.play().catch(() => {});
        render();
      });
    }
    return v;
  }

  function mediaControls(v) {
    const soundBtn = el('button', {
      class: `btn ghost small ${soundBlocked ? 'nudge' : ''}`,
      onclick: () => {
        v.muted = !v.muted;
        if (!v.muted) { soundBlocked = false; v.play().catch(() => {}); }
        render();
      },
    }, el('span', { text: v.muted ? '🔇 Tap for sound' : '🔊 Sound on' }));

    const replay = el('button', {
      class: 'btn ghost small',
      onclick: () => { v.currentTime = 0; v.play().catch(() => {}); },
    }, el('span', { text: '↻ Replay' }));

    return el('div', { class: 'media-controls' }, soundBtn, replay);
  }

  /* recap = the question has already been asked, so text and media both shrink
     to leave the screen to the answers */
  function questionBlock(recap = false) {
    const q = state.question;
    if (!q) return el('div');
    const hasMedia = !!(q.media && q.media.src);
    // A photo or video needs room, so the headline gives some up.
    const smallText = recap || hasMedia;
    const wrap = el('div', {}, el('div', { class: `question-text ${smallText ? 'small' : ''}`, text: q.text }));
    if (hasMedia) {
      const node = mediaFor(q.id, q.media);
      wrap.append(el('div', {
        class: `question-media ${recap ? 'compact' : ''}`,
        style: recap ? 'margin-top:1.2vh' : 'margin-top:1.6vh',
      }, node));
      if (q.media.type === 'video') wrap.append(mediaControls(node));
    }
    return wrap;
  }

  function answerList({ clickable, tight = false }) {
    const list = el('div', { class: `answer-list ${tight ? 'tight' : ''}` });
    state.answers.forEach((a, i) => {
      const awarded = a.award;
      const card = el('div', {
        class: `answer-card ${a.revealed ? '' : 'pending'} ${awarded || ''} ${clickable && awarded ? 'dimmed' : ''}`,
        style: `animation-delay:${i * 0.06}s${clickable && !awarded ? ';cursor:pointer' : ''}`,
        onclick: clickable && !awarded
          ? () => send('judge:award', { answerId: a.id, kind: state.awaiting || 'best' })
          : null,
      },
        el('span', { class: 'marker', text: a.revealed ? String(i + 1) : '·' }),
        el('span', { class: 'body' },
          el('span', { text: a.revealed ? a.text : '• • • • •' }),
          a.author ? el('span', { class: 'author', text: `— ${a.author}` }) : null
        ),
        awarded ? el('span', {
          class: 'ribbon',
          text: awarded === 'best'
            ? `Best · +${(state.config.pointsForBest || 1000).toLocaleString()}`
            : `Runner-up · +${(state.config.pointsForRunnerUp || 500).toLocaleString()}`,
        }) : null
      );
      list.append(card);
    });
    return list;
  }

  function scoreboard({ compact = false, skip = 0 } = {}) {
    const board = el('div', {
      class: `scoreboard ${compact ? 'compact' : ''}`,
      style: 'margin-top:1vh',
    });
    state.players
      .filter((p) => p.answering || p.score > 0)
      .slice(skip)
      .forEach((p, i) => {
        const rank = i + skip;
        board.append(el('div', { class: `score-row ${rank === 0 ? 'leader' : ''}` },
          el('span', { class: 'rank', text: rank === 0 ? '👑' : String(rank + 1) }),
          el('span', { text: p.name }),
          el('span', { class: 'pts', text: p.score.toLocaleString() })
        ));
      });
    return board;
  }

  /* ---------- petals ---------- */
  const PETAL_COLORS = ['#f6d0d4', '#efb9c0', '#f7e3c9', '#e9c7d4', '#fdf0ea'];
  function petal(fast) {
    const p = document.createElement('div');
    p.className = 'petal';
    const size = 8 + Math.random() * 16;
    p.style.width = `${size}px`;
    p.style.height = `${size * 0.8}px`;
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = PETAL_COLORS[(Math.random() * PETAL_COLORS.length) | 0];
    p.style.animationDuration = `${(fast ? 3 : 8) + Math.random() * 7}s`;
    p.style.animationDelay = `${Math.random() * (fast ? 1 : 6)}s`;
    p.style.opacity = String(0.35 + Math.random() * 0.4);
    $('petals').append(p);
    setTimeout(() => p.remove(), 16000);
  }
  const burst = (n) => { for (let i = 0; i < n; i++) petal(true); };
  setInterval(() => petal(false), 900);
  for (let i = 0; i < 14; i++) petal(false);

  /* keyboard: space / → advance the obvious thing */
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    if (!state) return;
    e.preventDefault();
    if (state.phase === 'lobby' && state.judgeName) send('host:start');
    else if (state.phase === 'intro') send('host:next');
    else if (state.phase === 'question') send('host:forceReveal');
    else if (state.phase === 'reveal') send('host:revealNext');
    else if (state.phase === 'scored') send('host:next');
  });
})();
