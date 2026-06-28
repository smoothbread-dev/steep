/* ============================================
   TEASTEEEP — APP LOGIC
   localStorage-only, Groq via Cloudflare Worker
   ============================================ */

// ─── STATE ────────────────────────────────────

const STATE_KEY = 'teasteeep_data';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || defaultState();
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    couple: {
      partner1: '',
      partner2: '',
      workerUrl: '',
      sessionsCompleted: 0,
      topicTagsUsed: []
    },
    sessions: [],
    currentSession: null
  };
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(appState));
}

let appState = loadState();

// ─── SCREEN ROUTER ────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ─── DEPTH SYSTEM ─────────────────────────────

function getDepthLabel(sessions) {
  if (sessions === 0)  return '🍵 First sip';
  if (sessions < 3)   return '🍵 Just steeping';
  if (sessions < 8)   return '🍵 Getting warm';
  if (sessions < 20)  return '🍵 Well steeped';
  if (sessions < 40)  return '🍵 Deep brew';
  return '🍵 Aged leaves';
}

function getDepthNumber(sessions) {
  if (sessions === 0)  return 1;
  if (sessions < 3)   return 2;
  if (sessions < 8)   return 3;
  if (sessions < 20)  return 4;
  if (sessions < 40)  return 5;
  return 6;
}

// ─── AI CALL ──────────────────────────────────

async function callGroq(messages) {
  const url = appState.couple.workerUrl;
  if (!url) throw new Error('No worker URL set.');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages,
      temperature: 0.85,
      max_tokens: 300
    })
  });

  if (!res.ok) throw new Error(`Worker error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ─── QUESTION GENERATION ──────────────────────

async function generateQuestion() {
  const { couple, currentSession } = appState;
  const depth = getDepthNumber(couple.sessionsCompleted);
  const mood = currentSession.mood;
  const usedTagsAll = couple.topicTagsUsed.slice(-20).join(', ') || 'none yet';
  const usedTagsTonight = currentSession.exchanges.map(e => e.tags).flat().join(', ') || 'none yet';

  const moodGuide = {
    Light: 'Keep it warm, light, and easy. Avoid anything heavy or emotionally demanding. Think: fond memories, small joys, gentle curiosities.',
    Cozy: 'Go a little deeper. Touch on values, preferences, small dreams. Comfortable but meaningful.',
    Open: 'Go somewhere real. Deeper feelings, meaningful reflections, things that matter. Still warm, never harsh.'
  };

  const depthGuide = [
    '',
    'This couple is just starting out. Keep questions very warm and low-stakes.',
    'They have shared a little. Slightly more personal is fine.',
    'They know each other well. Personal and reflective questions work.',
    'Deep familiarity. Rich, layered questions are welcome.',
    'Long history together. Questions can touch on growth, change, and depth.',
    'Deeply bonded. The most personal and meaningful questions are appropriate.'
  ];

  const systemPrompt = `You are a gentle conversation guide for couples. Your job is to generate ONE single conversation prompt.

Rules:
- NEVER ask direct questions like "What is your biggest fear?"
- Frame prompts as observations, shared scenarios, or fill-in-together sentences
- Examples of good framing: "Something I've never told you about how I felt when we first met is…", "If our relationship were a season, right now it feels like…", "A small thing you do that I quietly love is…"
- Return ONLY the prompt text, nothing else
- Also append on a new line: TAGS: tag1, tag2, tag3 (2-4 topic tags like: family, dreams, childhood, conflict, food, travel, future, memory, comfort, growth)

Depth level: ${depth}/6. ${depthGuide[depth]}
Tonight's ceiling: ${mood}. ${moodGuide[mood]}
Topics used across all sessions (avoid these recently): ${usedTagsAll}
Topics used tonight already (avoid completely): ${usedTagsTonight}`;

  const raw = await callGroq([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the next prompt for this couple.' }
  ]);

  // Parse out tags
  const lines = raw.split('\n');
  const tagLine = lines.find(l => l.startsWith('TAGS:'));
  const tags = tagLine
    ? tagLine.replace('TAGS:', '').split(',').map(t => t.trim().toLowerCase())
    : [];
  const question = lines
    .filter(l => !l.startsWith('TAGS:'))
    .join(' ')
    .trim();

  return { question, tags };
}

// ─── SUMMARY GENERATION ───────────────────────

async function generateSummary() {
  const { currentSession, couple } = appState;
  const exchanges = currentSession.exchanges;

  if (exchanges.length === 0) return 'A quiet night together is still a night together. 🍵';

  const exchangeText = exchanges.map((e, i) =>
    `Prompt ${i + 1}: "${e.question}"\n${couple.partner1}: "${e.answer1}"\n${couple.partner2}: "${e.answer2}"`
  ).join('\n\n');

  const systemPrompt = `You are a warm, gentle narrator reflecting on a couple's conversation. 
Write a short, warm summary (3-5 sentences) that reflects something meaningful back to them about tonight's conversation. 
Be poetic but grounded. Notice small things. Don't be cheesy or over-the-top. 
Address them warmly. Return only the summary text.`;

  return await callGroq([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here is what ${couple.partner1} and ${couple.partner2} shared tonight:\n\n${exchangeText}` }
  ]);
}

// ─── TOAST ────────────────────────────────────

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

// ─── GREETING ─────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

// ─── INIT ─────────────────────────────────────

function init() {
  const { couple } = appState;

  // First launch check
  if (!couple.partner1 || !couple.partner2 || !couple.workerUrl) {
    showScreen('screen-setup');
    return;
  }

  // Resume interrupted session
  if (appState.currentSession && appState.currentSession.state) {
    resumeSession();
    return;
  }

  showHome();
}

function showHome() {
  const { couple } = appState;
  document.getElementById('depth-badge').textContent = getDepthLabel(couple.sessionsCompleted);
  document.getElementById('home-greeting').textContent = getGreeting();
  document.getElementById('home-names').textContent = `${couple.partner1} & ${couple.partner2}`;
  showScreen('screen-home');
}

function resumeSession() {
  const state = appState.currentSession.state;
  if (state === 'waiting_p1') {
    renderP1Screen();
    showScreen('screen-p1');
  } else if (state === 'waiting_p2') {
    renderP2Screen();
    showScreen('screen-p2');
  } else if (state === 'revealed') {
    renderRevealScreen();
    showScreen('screen-reveal');
  } else {
    showHome();
  }
}

// ─── SESSION START ────────────────────────────

async function startSession(mood) {
  appState.currentSession = {
    mood,
    exchanges: [],
    state: 'loading',
    startDate: new Date().toISOString()
  };
  saveState();

  renderP1Screen(true); // show loading
  showScreen('screen-p1');

  try {
    const { question, tags } = await generateQuestion();
    appState.currentSession.currentQuestion = question;
    appState.currentSession.currentTags = tags;
    appState.currentSession.state = 'waiting_p1';
    saveState();
    renderP1Screen();
  } catch (err) {
    showToast('Could not steep a question. Check your Worker URL.');
    showHome();
  }
}

// ─── P1 SCREEN ────────────────────────────────

function renderP1Screen(loading = false) {
  const { couple, currentSession } = appState;
  document.getElementById('p1-indicator').textContent = `● ${couple.partner1}`;
  document.getElementById('p1-answer-label').textContent = `${couple.partner1}'s thoughts…`;

  const qText = document.getElementById('question-text-p1');
  const qLoading = document.getElementById('q-loading');

  if (loading) {
    qText.style.display = 'none';
    qLoading.style.display = 'block';
  } else {
    qLoading.style.display = 'none';
    qText.style.display = 'block';
    qText.textContent = currentSession.currentQuestion;
  }

  // Restore saved answer if resuming
  const savedAnswer = currentSession.answer1Draft || '';
  document.getElementById('answer-p1').value = savedAnswer;
}

// ─── P2 SCREEN ────────────────────────────────

function renderP2Screen() {
  const { couple, currentSession } = appState;
  document.getElementById('p2-indicator').textContent = `● ${couple.partner2}`;
  document.getElementById('p2-answer-label').textContent = `${couple.partner2}'s thoughts…`;
  document.getElementById('question-text-p2').textContent = currentSession.currentQuestion;

  const savedAnswer = currentSession.answer2Draft || '';
  document.getElementById('answer-p2').value = savedAnswer;
}

// ─── REVEAL SCREEN ────────────────────────────

function renderRevealScreen() {
  const { couple, currentSession } = appState;
  const last = currentSession.exchanges[currentSession.exchanges.length - 1];

  document.getElementById('question-text-reveal').textContent = last.question;
  document.getElementById('reveal-name-1').textContent = couple.partner1;
  document.getElementById('reveal-answer-1').textContent = last.answer1;
  document.getElementById('reveal-name-2').textContent = couple.partner2;
  document.getElementById('reveal-answer-2').textContent = last.answer2;
}

// ─── NEXT QUESTION ────────────────────────────

async function nextQuestion() {
  document.getElementById('question-text-p1').style.display = 'none';
  document.getElementById('q-loading').style.display = 'block';
  document.getElementById('answer-p1').value = '';
  document.getElementById('answer-p2').value = '';
  appState.currentSession.answer1Draft = '';
  appState.currentSession.answer2Draft = '';
  appState.currentSession.state = 'loading';
  saveState();
  showScreen('screen-p1');

  try {
    const { question, tags } = await generateQuestion();
    appState.currentSession.currentQuestion = question;
    appState.currentSession.currentTags = tags;
    appState.currentSession.state = 'waiting_p1';
    saveState();
    renderP1Screen();
  } catch (err) {
    showToast('Could not steep the next question. Try again.');
  }
}

// ─── WRAP UP ──────────────────────────────────

async function wrapUp() {
  showScreen('screen-summary');
  document.getElementById('summary-loading').style.display = 'flex';
  document.getElementById('summary-text').style.display = 'none';

  try {
    const summary = await generateSummary();
    document.getElementById('summary-loading').style.display = 'none';
    document.getElementById('summary-text').style.display = 'block';
    document.getElementById('summary-text').textContent = summary;
  } catch {
    document.getElementById('summary-loading').style.display = 'none';
    document.getElementById('summary-text').style.display = 'block';
    document.getElementById('summary-text').textContent =
      "Tonight you steeped something together. That's enough. 🍵";
  }

  // Session stats
  const exchanges = appState.currentSession.exchanges;
  document.getElementById('session-stats').innerHTML =
    `${exchanges.length} question${exchanges.length !== 1 ? 's' : ''} explored · ${appState.currentSession.mood} night`;

  // Save session
  const { couple, currentSession } = appState;
  const allTags = currentSession.exchanges.flatMap(e => e.tags);
  couple.topicTagsUsed = [...couple.topicTagsUsed, ...allTags].slice(-60);
  couple.sessionsCompleted += 1;

  appState.sessions.push({
    date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    mood: currentSession.mood,
    depth: getDepthNumber(couple.sessionsCompleted),
    exchanges: currentSession.exchanges,
    summary: document.getElementById('summary-text').textContent
  });

  appState.currentSession = null;
  saveState();
}

// ─── HISTORY ──────────────────────────────────

function renderHistory() {
  const list = document.getElementById('history-list');
  const sessions = [...appState.sessions].reverse();

  if (sessions.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);font-style:italic;padding:40px 0;">
      Your journey starts tonight. 🍵</p>`;
    return;
  }

  list.innerHTML = sessions.map((s, i) => `
    <div class="history-entry" onclick="expandHistory(${appState.sessions.length - 1 - i})">
      <div class="history-date">${s.date}</div>
      <div class="history-mood">${moodEmoji(s.mood)} ${s.mood} night · ${s.exchanges.length} questions</div>
      <div class="history-preview">${s.summary || s.exchanges[0]?.question || ''}</div>
    </div>
  `).join('');
}

function moodEmoji(mood) {
  return { Light: '🌿', Cozy: '🕯️', Open: '🌊' }[mood] || '🍵';
}

function expandHistory(index) {
  const s = appState.sessions[index];
  const { couple } = appState;

  const detail = s.exchanges.map(e => `
    <div class="history-entry" style="cursor:default">
      <div class="history-mood" style="font-style:italic;font-family:'Lora',serif">"${e.question}"</div>
      <div style="margin-top:10px">
        <div class="answer-name">${couple.partner1}</div>
        <div class="answer-text">${e.answer1}</div>
      </div>
      <div style="margin-top:10px">
        <div class="answer-name">${couple.partner2}</div>
        <div class="answer-text">${e.answer2}</div>
      </div>
    </div>
  `).join('');

  const list = document.getElementById('history-list');
  list.innerHTML = `
    <button class="btn-ghost" onclick="renderHistory()" style="margin-bottom:8px">← All sessions</button>
    <div class="history-entry" style="cursor:default;background:var(--surface-2)">
      <div class="history-date">${s.date} · ${moodEmoji(s.mood)} ${s.mood}</div>
      <div class="summary-text" style="text-align:left;margin-top:8px">${s.summary || ''}</div>
    </div>
    ${detail}
  `;
}

// ─── EVENT LISTENERS ──────────────────────────

// Setup
document.getElementById('btn-setup-done').addEventListener('click', () => {
  const p1 = document.getElementById('input-p1').value.trim();
  const p2 = document.getElementById('input-p2').value.trim();
  const url = document.getElementById('input-worker').value.trim();

  if (!p1 || !p2) return showToast('Please enter both names.');
  if (!url || !url.startsWith('http')) return showToast('Please enter a valid Worker URL.');

  appState.couple.partner1 = p1;
  appState.couple.partner2 = p2;
  appState.couple.workerUrl = url;
  saveState();
  showHome();
});

// Mood selection
document.querySelectorAll('.mood-card').forEach(card => {
  card.addEventListener('click', () => {
    startSession(card.dataset.mood);
  });
});

// P1 done
document.getElementById('btn-p1-done').addEventListener('click', () => {
  const answer = document.getElementById('answer-p1').value.trim();
  if (!answer) return showToast('Write something first, even just a word. 🍵');

  appState.currentSession.answer1 = answer;
  appState.currentSession.answer1Draft = '';
  appState.currentSession.state = 'waiting_p2';
  saveState();

  document.getElementById('handoff-msg').textContent =
    `${appState.couple.partner2}, it's your turn.`;
  showScreen('screen-handoff');
});

// Auto-save drafts
document.getElementById('answer-p1').addEventListener('input', e => {
  if (appState.currentSession) {
    appState.currentSession.answer1Draft = e.target.value;
    saveState();
  }
});

document.getElementById('answer-p2').addEventListener('input', e => {
  if (appState.currentSession) {
    appState.currentSession.answer2Draft = e.target.value;
    saveState();
  }
});

// Handoff ready
document.getElementById('btn-handoff-ready').addEventListener('click', () => {
  renderP2Screen();
  showScreen('screen-p2');
});

// P2 done
document.getElementById('btn-p2-done').addEventListener('click', () => {
  const answer = document.getElementById('answer-p2').value.trim();
  if (!answer) return showToast('Write something first, even just a word. 🍵');

  const { currentSession } = appState;
  currentSession.answer2 = answer;
  currentSession.answer2Draft = '';
  currentSession.state = 'revealed';

  // Commit exchange
  currentSession.exchanges.push({
    question: currentSession.currentQuestion,
    tags: currentSession.currentTags || [],
    answer1: currentSession.answer1,
    answer2: answer
  });

  currentSession.currentQuestion = null;
  currentSession.currentTags = null;
  currentSession.answer1 = null;
  saveState();

  renderRevealScreen();
  showScreen('screen-reveal');
});

// Next question
document.getElementById('btn-next').addEventListener('click', nextQuestion);

// Wrap up buttons (from multiple screens)
['btn-wrapup-p1', 'btn-wrapup-p2', 'btn-wrapup-reveal'].forEach(id => {
  document.getElementById(id).addEventListener('click', () => {
    if (confirm("Wrap up tonight's session?")) wrapUp();
  });
});

// Done for tonight
document.getElementById('btn-done-tonight').addEventListener('click', showHome);

// History
document.getElementById('btn-history').addEventListener('click', () => {
  renderHistory();
  showScreen('screen-history');
});

document.getElementById('btn-back-history').addEventListener('click', showHome);

// Settings
document.getElementById('btn-settings').addEventListener('click', () => {
  const { couple } = appState;
  document.getElementById('settings-p1').value = couple.partner1;
  document.getElementById('settings-p2').value = couple.partner2;
  document.getElementById('settings-worker').value = couple.workerUrl;
  showScreen('screen-settings');
});

document.getElementById('btn-back-settings').addEventListener('click', showHome);

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const p1 = document.getElementById('settings-p1').value.trim();
  const p2 = document.getElementById('settings-p2').value.trim();
  const url = document.getElementById('settings-worker').value.trim();

  if (!p1 || !p2) return showToast('Names cannot be empty.');
  if (!url || !url.startsWith('http')) return showToast('Please enter a valid Worker URL.');

  appState.couple.partner1 = p1;
  appState.couple.partner2 = p2;
  appState.couple.workerUrl = url;
  saveState();
  showToast('Saved. ✓');
  showHome();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('This will erase everything — all history, depth, and settings. Are you sure?')) {
    localStorage.removeItem(STATE_KEY);
    location.reload();
  }
});

// ─── START ────────────────────────────────────

init();