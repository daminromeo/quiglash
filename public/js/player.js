/* Phone client. One <section id="view"> re-rendered per phase. */
(() => {
  const socket = io();
  const view = document.getElementById('view');
  const toastEl = document.getElementById('toast');

  const el = (tag, props = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid) node.append(kid);
    return node;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  let toastTimer;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  };

  const SAVE = 'quiglash-player';
  const saved = () => { try { return JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch { return null; } };
  const save = (v) => localStorage.setItem(SAVE, JSON.stringify(v));

  let state = null;
  let draft = '';
  let lastRound = -2;

  const params = new URLSearchParams(location.search);
  const codeFromUrl = (params.get('code') || '').toUpperCase();
  const nameFromUrl = (params.get('name') || '').trim();
  let autoTried = false;

  /* ---------- connection ---------- */
  socket.on('connect', () => {
    const s = saved();
    if (s && s.code && s.playerId) {
      socket.emit('player:rejoin', s, (res) => {
        if (!res || res.error) { localStorage.removeItem(SAVE); renderJoin(); }
      });
    } else {
      renderJoin();
    }
  });

  socket.on('disconnect', () => toast('Reconnecting…'));
  socket.on('state', (s) => { state = s; render(); });

  /* ---------- join ---------- */
  function renderJoin(err) {
    state = null;
    clear(view);
    const s = saved() || {};
    const codeInput = el('input', {
      type: 'text', class: 'code-input', maxlength: '4',
      placeholder: '––––', value: codeFromUrl || s.code || '',
      autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    });
    const nameInput = el('input', {
      type: 'text', maxlength: '18', placeholder: 'Your name',
      value: nameFromUrl || s.name || '', autocomplete: 'given-name',
    });

    const go = () => {
      const code = codeInput.value.trim().toUpperCase();
      const name = nameInput.value.trim();
      if (!code || !name) return toast('Room code and name, please!');
      socket.emit('player:join', { code, name }, (res) => {
        if (res && res.error) return renderJoin(res.error);
        save({ code: res.code, playerId: res.playerId, name: res.name });
      });
    };

    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

    // Pre-filled invite link (/?code=ABCD&name=Ashley) drops you straight in.
    if (!err && !autoTried && codeFromUrl && nameFromUrl) { autoTried = true; setTimeout(go, 60); }

    view.append(el('div', { class: 'card' },
      el('label', { class: 'field' }, el('span', { text: 'Room code' }), codeInput),
      el('label', { class: 'field' }, el('span', { text: 'Your name' }), nameInput),
      el('button', { class: 'btn-primary', onclick: go }, el('span', { text: 'Join the party' })),
      err ? el('p', { class: 'status', style: 'color:var(--dusty)', text: err }) : null
    ));
    document.getElementById('footerNote').textContent = 'Look at the big screen for the code';
    if (codeFromUrl && !nameInput.value) setTimeout(() => nameInput.focus(), 250);
  }

  /* ---------- render ---------- */
  function render() {
    if (!state) return;
    const cfg = state.config || {};
    document.getElementById('brandTitle').textContent = cfg.gameTitle || 'Quiglash';
    document.getElementById('brandSub').textContent = state.you.name
      ? `${state.you.name}${state.you.isJudge ? ' 👑' : ''}`
      : cfg.tagline || '';
    document.getElementById('footerNote').textContent = `Room ${state.code}`;

    if (state.round !== lastRound) { draft = ''; lastRound = state.round; }

    clear(view);
    ({
      lobby: pLobby,
      question: pQuestion,
      reveal: pWatch,
      judging: pJudging,
      scored: pScored,
      final: pFinal,
    }[state.phase] || pLobby)();
  }

  /* ---------- phases ---------- */
  function pLobby() {
    view.append(el('div', { class: 'card' },
      el('p', { class: 'status', text: state.you.isJudge
        ? "You're the judge — you'll pick the winning answers."
        : "You're in! Waiting for the bride to start…" }),
      el('div', { class: 'pill-row' },
        state.players.map((p) => el('span', {
          class: `mini-pill ${p.isJudge ? 'done' : ''}`,
          text: p.isJudge ? `👑 ${p.name}` : p.name,
        }))
      )
    ));
    view.append(el('button', {
      class: 'btn-secondary', style: 'margin-top:14px',
      onclick: () => { localStorage.removeItem(SAVE); location.href = '/'; },
    }, el('span', { text: 'Leave' })));
  }

  function pQuestion() {
    const q = state.question || {};
    const card = el('div', { class: 'card' }, el('div', { class: 'p-question', text: q.text || '' }));
    if (q.media && q.media.src) {
      const m = q.media.type === 'video'
        ? el('video', { src: q.media.src, controls: '', playsinline: '' })
        : el('img', { src: q.media.src, alt: '' });
      card.append(el('div', { class: 'p-media' }, m));
    }
    view.append(card);

    if (!state.you.answering) {
      view.append(el('div', { class: 'card', style: 'margin-top:14px' },
        el('p', { class: 'status', text: "You're judging this one — sit back while they sweat." }),
        el('div', { class: 'pill-row' }, state.players.filter((p) => p.answering).map((p) =>
          el('span', { class: `mini-pill ${p.answered ? 'done' : ''}`, text: p.answered ? `${p.name} ✓` : p.name })))
      ));
      return;
    }

    if (state.you.submitted) {
      view.append(el('div', { class: 'card', style: 'margin-top:14px' },
        el('p', { class: 'you-scored script', text: 'Locked in!' }),
        el('p', { class: 'status', text: `“${state.you.answerText}”` }),
        el('div', { class: 'pill-row' }, state.players.filter((p) => p.answering).map((p) =>
          el('span', { class: `mini-pill ${p.answered ? 'done' : ''}`, text: p.answered ? `${p.name} ✓` : p.name })))
      ));
      return;
    }

    const max = state.config.maxAnswerLength || 180;
    const ta = el('textarea', { maxlength: String(max), placeholder: 'Make them laugh…' });
    ta.value = draft;
    const counter = el('div', { class: 'counter', text: `${max - draft.length}` });
    ta.addEventListener('input', () => {
      draft = ta.value;
      counter.textContent = String(max - ta.value.length);
    });

    const submit = () => {
      const text = ta.value.trim();
      if (!text) return toast('Type something first!');
      socket.emit('player:answer', { text }, (res) => {
        if (res && res.error) toast(res.error);
        else { draft = ''; toast('Sent!'); }
      });
    };

    view.append(el('div', { class: 'card', style: 'margin-top:14px' },
      ta, counter,
      el('button', { class: 'btn-primary', style: 'margin-top:10px', onclick: submit },
        el('span', { text: 'Submit answer' }))
    ));
    setTimeout(() => ta.focus(), 120);
  }

  function pWatch() {
    view.append(el('div', { class: 'card' },
      el('p', { class: 'you-scored script', text: 'Eyes on the screen' }),
      el('p', { class: 'status', text: `${state.judgeName || 'The judge'} is reading the answers out loud.` })
    ));
  }

  function pJudging() {
    if (!state.you.isJudge) {
      view.append(el('div', { class: 'card' },
        el('p', { class: 'you-scored script', text: 'Fingers crossed' }),
        el('p', { class: 'status', text: `${state.judgeName || 'The judge'} is deciding…` })
      ));
      return;
    }
    const card = el('div', { class: 'card' },
      state.question ? el('div', {
        class: 'p-question',
        style: 'font-size:1.15rem;opacity:.75;margin-bottom:6px',
        text: state.question.text,
      }) : null,
      el('p', { class: 'status', style: 'margin-top:0', text: state.awaiting === 'runnerUp'
        ? 'Now pick the runner-up' : 'Pick the best answer' })
    );
    state.answers.forEach((a, i) => {
      card.append(el('button', {
        class: `judge-choice ${a.award ? 'taken' : ''}`,
        disabled: a.award ? 'disabled' : null,
        onclick: () => socket.emit('judge:award', { answerId: a.id, kind: state.awaiting || 'best' }),
      }, el('span', { class: 'num', text: `${i + 1}.` }), el('span', { text: a.text || '' })));
    });
    if (state.awaiting === 'runnerUp') {
      card.append(el('button', { class: 'btn-secondary', onclick: () => socket.emit('judge:skipRunnerUp') },
        el('span', { text: 'Skip runner-up' })));
    }
    view.append(card);
  }

  function pScored() {
    const mine = state.answers.find((a) => a.author === state.you.name);
    const winner = state.answers.find((a) => a.award === 'best');
    view.append(el('div', { class: 'card' },
      el('p', { class: 'you-scored script', text: mine && mine.award === 'best' ? 'You won that one! 🎉' : 'Round over' }),
      winner ? el('p', { class: 'status', text: `Best answer: “${winner.text}” — ${winner.author}` }) : null,
      scoreList()
    ));
  }

  function pFinal() {
    const ranked = state.players.slice().sort((a, b) => b.score - a.score);
    const won = ranked[0] && ranked[0].name === state.you.name;
    view.append(el('div', { class: 'card' },
      el('p', { class: 'you-scored script', text: won ? 'You won! 👑' : `${ranked[0] ? ranked[0].name : 'Nobody'} wins!` }),
      scoreList()
    ));
  }

  function scoreList() {
    const wrap = el('div', { class: 'score-list', style: 'margin-top:12px' });
    state.players
      .filter((p) => p.answering || p.score > 0)
      .forEach((p, i) => wrap.append(el('div', { class: `row ${p.name === state.you.name ? 'me' : ''}` },
        el('span', { text: i === 0 ? '👑' : String(i + 1) }),
        el('span', { text: p.name }),
        el('span', { text: p.score.toLocaleString() })
      )));
    return wrap;
  }
})();
