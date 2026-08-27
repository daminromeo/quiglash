/* Question editor — reads/writes data/questions.json + data/config.json */
(() => {
  const $ = (id) => document.getElementById(id);
  const list = $('list'), cfgBox = $('cfg'), fileInput = $('fileInput');
  let questions = [], config = {}, uploadTarget = null;

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid) n.append(kid);
    return n;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const msg = (t, color = 'var(--sage)') => {
    $('msg').textContent = t; $('msg').style.color = color;
    setTimeout(() => { $('msg').textContent = ''; }, 3000);
  };

  const CFG_FIELDS = [
    { key: 'brideName', label: 'Bride’s name', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'gameTitle', label: 'Game title', type: 'text' },
    { key: 'tagline', label: 'Tagline (big screen)', type: 'text' },
    { key: 'hashtag', label: 'Hashtag', type: 'text' },
    { key: 'pointsForBest', label: 'Points — best answer', type: 'number' },
    { key: 'pointsForRunnerUp', label: 'Points — runner-up', type: 'number' },
    { key: 'answerTimeLimitSeconds', label: 'Answer timer (0 = none)', type: 'number' },
    { key: 'maxAnswerLength', label: 'Max answer length', type: 'number' },
    { key: 'questionsPerGame', label: 'Questions per game (0 = all)', type: 'number' },
    { key: 'enableRunnerUp', label: 'Award a runner-up too', type: 'bool' },
    { key: 'judgeAnswersToo', label: 'Judge also writes answers', type: 'bool' },
    { key: 'shuffleQuestions', label: 'Shuffle question order', type: 'bool' },
  ];

  function renderConfig() {
    clear(cfgBox);
    for (const f of CFG_FIELDS) {
      if (f.type === 'bool') {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!config[f.key];
        cb.addEventListener('change', () => { config[f.key] = cb.checked; });
        cfgBox.append(el('label', { class: 'check' }, cb, el('span', { text: f.label })));
      } else {
        const input = el('input', { type: 'text', value: config[f.key] ?? '' });
        input.addEventListener('input', () => {
          config[f.key] = f.type === 'number' ? Number(input.value) || 0 : input.value;
        });
        cfgBox.append(el('label', { class: 'field' }, el('span', { text: f.label }), input));
      }
    }
  }

  function renderIntroEditor() {
    const box = $('introBox');
    clear(box);
    config.intro = config.intro || { enabled: false, heading: '', message: '', media: null };
    const intro = config.intro;

    const on = el('input', { type: 'checkbox' });
    on.checked = !!intro.enabled;
    on.addEventListener('change', () => { intro.enabled = on.checked; renderIntroEditor(); });
    box.append(el('label', { class: 'check', style: 'margin-bottom:16px' }, on,
      el('span', { text: 'Show an opening screen before question one' })));

    if (!intro.enabled) return;

    const heading = el('input', { type: 'text', value: intro.heading || '', placeholder: 'Welcome to the weekend' });
    heading.addEventListener('input', () => { intro.heading = heading.value; });
    box.append(el('label', { class: 'field' }, el('span', { text: 'Heading' }), heading));

    const message = el('textarea', { placeholder: 'Say hello, explain the rules, set the tone…' });
    message.value = intro.message || '';
    message.addEventListener('input', () => { intro.message = message.value; });
    box.append(el('label', { class: 'field' }, el('span', { text: 'Message' }), message));

    box.append(el('div', { class: 'q-tools' },
      el('button', { class: 'tool', onclick: () => { uploadTarget = intro; fileInput.click(); } },
        el('span', { text: intro.media ? 'Replace video' : '+ Video / photo' })),
      intro.media ? el('button', { class: 'tool danger', onclick: () => { intro.media = null; renderIntroEditor(); } },
        el('span', { text: 'Remove' })) : null
    ));

    if (intro.media && intro.media.src) {
      const preview = intro.media.type === 'video'
        ? el('video', { src: intro.media.src, controls: '', playsinline: '' })
        : el('img', { src: intro.media.src, alt: '' });
      box.append(el('div', { class: 'thumb' }, preview, el('code', { text: intro.media.src })));
    }
  }

  const renderAll = () => { renderConfig(); renderIntroEditor(); renderQuestions(); };

  function renderQuestions() {
    clear(list);
    $('count').textContent = String(questions.length);
    questions.forEach((q, i) => {
      const ta = el('textarea', { placeholder: 'Ask something ridiculous…' });
      ta.value = q.text || '';
      ta.addEventListener('input', () => { q.text = ta.value; });

      const tools = el('div', { class: 'q-tools' },
        el('button', { class: 'tool', onclick: () => { uploadTarget = q; fileInput.click(); } },
          el('span', { text: q.media ? 'Replace media' : '+ Photo / video' })),
        q.media ? el('button', { class: 'tool', onclick: () => { q.media = null; renderQuestions(); } },
          el('span', { text: 'Remove media' })) : null,
        el('button', { class: 'tool', disabled: i === 0 ? 'disabled' : null, onclick: () => move(i, -1) },
          el('span', { text: '↑' })),
        el('button', { class: 'tool', disabled: i === questions.length - 1 ? 'disabled' : null, onclick: () => move(i, 1) },
          el('span', { text: '↓' })),
        el('button', { class: 'tool danger', onclick: () => { questions.splice(i, 1); renderQuestions(); } },
          el('span', { text: 'Delete' }))
      );

      const body = el('div', {}, ta, tools);
      if (q.media && q.media.src) {
        const preview = q.media.type === 'video'
          ? el('video', { src: q.media.src, muted: '', playsinline: '', controls: '' })
          : el('img', { src: q.media.src, alt: '' });
        body.append(el('div', { class: 'thumb' }, preview, el('code', { text: q.media.src })));
      }

      list.append(el('div', { class: 'q' },
        el('div', { class: 'idx', text: String(i + 1) }),
        el('div', { class: 'card', style: 'padding:14px' }, body)
      ));
    });
  }

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= questions.length) return;
    [questions[i], questions[j]] = [questions[j], questions[i]];
    renderQuestions();
  };

  const addQuestion = () => {
    questions.push({ id: `q${Date.now().toString(36)}`, text: '', media: null });
    renderQuestions();
    const boxes = list.querySelectorAll('textarea');
    boxes[boxes.length - 1]?.focus();
  };
  $('addBtn').addEventListener('click', addQuestion);
  $('addBtn2').addEventListener('click', addQuestion);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !uploadTarget) return;
    msg('Uploading…', 'var(--dusty)');
    try {
      const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      uploadTarget.media = { type: data.type, src: data.src };
      renderAll();
      msg('Uploaded — remember to Save');
    } catch (err) {
      msg(err.message || 'Upload failed', '#a33');
    } finally {
      fileInput.value = '';
      uploadTarget = null;
    }
  });

  $('saveBtn').addEventListener('click', async () => {
    const res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions, config }),
    });
    const data = await res.json();
    if (data.error) return msg(data.error, '#a33');
    msg(`Saved ${data.count} questions ✓`);
  });

  /* Export / import — the hosted copy runs on an ephemeral filesystem, so this is
     how you carry edits back to the repo (npm run restore <file>). */
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ config, questions }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'quiglash-backup.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msg('Downloaded quiglash-backup.json');
  });

  $('importBtn').addEventListener('click', () => $('jsonInput').click());
  $('jsonInput').addEventListener('change', async () => {
    const file = $('jsonInput').files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.questions;
      if (!Array.isArray(incoming)) throw new Error('No questions found in that file');
      questions = incoming;
      if (!Array.isArray(parsed) && parsed.config) config = { ...config, ...parsed.config };
      renderAll();
      msg(`Loaded ${questions.length} questions — hit Save`);
    } catch (err) {
      msg(err.message || 'Could not read that file', '#a33');
    } finally { $('jsonInput').value = ''; }
  });

  // Only the hosted copy has the disappearing-edits problem; say so there.
  if (!/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(location.hostname)) {
    $('hostedNote').innerHTML =
      'This is the hosted copy — edits here last until the app restarts. ' +
      'Use <b>Export</b> and commit the file to keep them for good.';
  }

  fetch('/api/questions')
    .then((r) => r.json())
    .then((data) => {
      questions = data.questions || [];
      config = data.config || {};
      renderAll();
    });
})();
