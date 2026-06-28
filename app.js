/* ============================================
   TEASTEEEP — APP LOGIC
   localStorage-only, Groq via Cloudflare Worker
   ============================================ */

// ─── HARDCODED WORKER URL ─────────────────────
const WORKER_URL = 'https://groq-proxy.henryooi0077.workers.dev';

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
      sessionsCompleted: 0,
      totalExchanges: 0,
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

// Migrate old saves that don't have totalExchanges yet
if (typeof appState.couple.totalExchanges === 'undefined') {
  appState.couple.totalExchanges = appState.sessions.reduce(
    (sum, s) => sum + (s.exchanges?.length || 0), 0
  );
  saveState();
}

// ─── REFRESH COUNTER ──────────────────────────
// Tracks how many times the current question has been refreshed
// Resets when a new question is generated (not on refresh)

let refreshCount = 0;
const MAX_REFRESHES = 2;

// ─── SCREEN ROUTER ────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ─── DEPTH SYSTEM ─────────────────────────────

function getDepthLabel(couple) {
  const n = couple.totalExchanges || 0;
  if (n === 0)  return '🍵 Cold cup';
  if (n < 10)   return '🍵 Just steeping';
  if (n < 30)   return '🍵 First warmth';
  if (n < 60)   return '🍵 Full steep';
  if (n < 100)  return '🍵 Deep brew';
  return               '🍵 Aged leaves';
}

function getDepthNumber(couple) {
  const n = couple.totalExchanges || 0;
  if (n === 0)  return 1;
  if (n < 10)   return 2;
  if (n < 30)   return 3;
  if (n < 60)   return 4;
  if (n < 100)  return 5;
  return 6;
}

// ─── HOME STATS ───────────────────────────────

function renderHomeStats() {
  const couple = appState.couple;
  const n      = couple.totalExchanges || 0;

  document.getElementById('depth-badge').textContent      = getDepthLabel(couple);
  document.getElementById('stat-depth-label').textContent = getDepthLabel(couple);
  document.getElementById('stat-exchanges').textContent   = n;
  document.getElementById('stat-sessions').textContent    = couple.sessionsCompleted || 0;

  const thresholds = [0, 10, 30, 60, 100, Infinity];
  let currentFloor = 0;
  let nextCeiling  = 10;

  for (let i = 0; i < thresholds.length - 1; i++) {
    if (n >= thresholds[i] && n < thresholds[i + 1]) {
      currentFloor = thresholds[i];
      nextCeiling  = thresholds[i + 1];
      break;
    }
  }

  const isMaxed = n >= 100;
  const pct     = isMaxed
    ? 100
    : Math.round(((n - currentFloor) / (nextCeiling - currentFloor)) * 100);

  document.getElementById('depth-progress-fill').style.width = `${pct}%`;
  document.getElementById('depth-progress-label').textContent = isMaxed
    ? '🍵 Fully steeped'
    : `${n} / ${nextCeiling} prompts to next level`;
}

// ─── AI CALL ──────────────────────────────────

async function callGroq(userPrompt) {
  console.log('[TeaSteep] Calling worker...');

  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       'openai/gpt-oss-20b',
      messages:    [{ role: 'user', content: userPrompt }],
      temperature: 0.85,
      max_tokens:  3000
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[TeaSteep] Worker error:', res.status, errText);
    throw new Error(`Worker error: ${res.status}`);
  }

  const data = await res.json();
  console.log('[TeaSteep] Response:', data);

  if (!data.choices?.[0]?.message?.content) {
    console.error('[TeaSteep] Empty or missing content:', data);
    throw new Error('No content returned from model');
  }

  return data.choices[0].message.content.trim();
}

// ─── QUESTION GENERATION ──────────────────────

async function generateQuestion() {
  const { couple, currentSession } = appState;
  const depth = getDepthNumber(couple);
  const mood  = currentSession.mood;

  const usedTagsAll     = couple.topicTagsUsed.slice(-20).join(', ') || 'none yet';
  const usedTagsTonight = currentSession.exchanges
    .map(e => e.tags).flat().join(', ') || 'none yet';

  const moodGuide = {
    Light: 'Keep it warm, light, and easy. Avoid anything heavy or emotionally demanding.',
    Cozy:  'Go a little deeper. Touch on values, preferences, small dreams. Comfortable but meaningful.',
    Open:  'Go somewhere real. Deeper feelings, meaningful reflections. Still warm, never harsh.'
  };

  const depthGuide = [
    '',
    'This couple is just starting out. Keep it very warm and low-stakes.',
    'They have shared a little. Slightly more personal is fine.',
    'They know each other well. Personal and reflective questions work.',
    'Deep familiarity. Rich, layered prompts are welcome.',
    'Long history together. Touch on growth, change, and depth.',
    'Deeply bonded. The most personal and meaningful prompts are appropriate.'
  ];

  const prompt = `You are a conversation guide for a couple who want to genuinely understand each other better.

CORE PURPOSE:
- Help two people who love each other discover things they never thought to ask
- Every question should feel like: "I thought I knew you, but I never actually asked you this"
- Both people should have a real answer that might surprise the other
- Rooted in real feelings and real life — not hypothetical fantasy, not therapy-speak

TONE:
- Quiet, warm, and honest — like a close friend asking over a late night drink
- Never dramatic, never poetic, never scripted
- 1–2 sentences max — set up a small relatable moment, then ask one honest question

FORMAT:
- The question should feel like it came from a person, not an app
- No flowery language, no grand setups
- Short. Direct. Genuine.

GOOD EXAMPLES:
  "When you're having a really bad day and don't want to talk yet — what do you actually need from me in that moment, even if you'd never ask for it?"
  "Is there something about the way you grew up that you think I still don't fully understand about you?"
  "When we argue, what's the thing you wish I knew about how you were feeling that you can never quite say in the moment?"
  "If you could change one small thing about how we spend time together — nothing big, just a small habit — what would it be?"
  "What's something you've never said out loud to me, not because you were hiding it, but because you never found the right moment?"
  "Is there something you've always wanted us to do together but never brought up because you weren't sure I'd be into it?"
  "What does feeling truly loved by me actually look like to you — not in theory, but in the small everyday things?"
  "When you imagine us five years from now, what's the one thing you hope hasn't changed?"

THE REAL RULE — it's not about the topic, it's about how you ask:
- Any topic can work if it's wrapped in enough warmth and context
- Any topic falls flat if it's asked cold, bare, or without a human setup
- The question should feel like it came from someone who knows them — not a quiz card

BAD EXAMPLES (these are bad because of HOW they're asked, not what they're about):
  "What is your biggest fear?" ← too cold and bare. Wrap it: "Is there something you're quietly afraid of that you don't really talk about — not a dramatic fear, just something that sits in the back of your mind sometimes?"
  "If you won the lottery what would you buy?" ← too surface. Push it further: "If money genuinely wasn't a thing anymore — not fantasy rich, just completely free — what would your life actually look like?"
  "What would your younger self think of you?" ← too self-help-y on its own. Ground it: "Is there something about who you've become that you think your younger self would be surprised by — good or bad?"
  "If you could change one thing about the world..." ← too broad. Make it personal: "Is there something about the world your future kids would grow up in that quietly worries you — something you don't bring up much?"
  "What's your love language?" ← too clinical. Ask the real thing underneath: "What does feeling truly loved by me actually look like in the small everyday moments — not in theory?"
  "Describe your perfect day." ← too generic. Make it about us: "If we had a completely free day together with no plans and no obligations — what would you actually want it to look like?"

RULES:
- Return ONLY the question on the first line
- Then on a new line: TAGS: tag1, tag2, tag3 (2–4 tags from: family, dreams, childhood, conflict, future, memory, comfort, growth, love, habits)
- No preamble, no explanation, just the question then the tags

Depth level: ${depth}/6. ${depthGuide[depth]}
Tonight's ceiling: ${mood}. ${moodGuide[mood]}
Topics used across all sessions (avoid recently): ${usedTagsAll}
Topics used tonight already (avoid completely): ${usedTagsTonight}

Generate the question now:`;

  const raw = await callGroq(prompt);
  console.log('[TeaSteep] Raw question output:', raw);

  const lines        = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const tagLineIndex = lines.findIndex(l => l.startsWith('TAGS:'));
  const tags         = tagLineIndex !== -1
    ? lines[tagLineIndex].replace('TAGS:', '').split(',').map(t => t.trim().toLowerCase())
    : [];
  const question     = (tagLineIndex !== -1 ? lines.slice(0, tagLineIndex) : lines)
    .join(' ').trim();

  console.log('[TeaSteep] Parsed question:', question, '| Tags:', tags);
  return { question, tags };
}

// ─── SUMMARY GENERATION ───────────────────────

async function generateSummary() {
  const { currentSession, couple } = appState;
  const exchanges = currentSession.exchanges;

  if (exchanges.length === 0) {
    return 'A quiet night together is still a night together. 🍵';
  }

  const exchangeText = exchanges.map((e, i) =>
    `Prompt ${i + 1}: "${e.question}"\n${couple.partner1}: "${e.answer1}"\n${couple.partner2}: "${e.answer2}"`
  ).join('\n\n');

  const prompt = `You are a warm, gentle narrator reflecting on a couple's conversation tonight.
Write a short warm summary (3-5 sentences) that reflects something meaningful back to them.
Be poetic but grounded. Notice small things. Don't be cheesy or over-the-top.
Address them warmly by name. Return only the summary text, nothing else.

Here is what ${couple.partner1} and ${couple.partner2} shared tonight:

${exchangeText}

Write the summary now:`;

  return await callGroq(prompt);
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

// ─── PROMPT HINT ──────────────────────────────

function setPromptHint(question, p1ElId, p2ElId) {
  const hint = "✍️ Answer honestly — there's no wrong answer here.";
  const el1  = document.getElementById(p1ElId);
  const el2  = document.getElementById(p2ElId);
  if (el1) el1.textContent = hint;
  if (el2) el2.textContent = hint;
}

// ─── REFRESH BUTTON HELPERS ───────────────────

function showRefreshBtn() {
  const btn = document.getElementById('btn-refresh-question');
  if (btn) btn.style.display = 'block';
}

function hideRefreshBtn() {
  const btn = document.getElementById('btn-refresh-question');
  if (btn) btn.style.display = 'none';
}

function updateRefreshBtn() {
  const btn = document.getElementById('btn-refresh-question');
  if (!btn) return;

  if (refreshCount >= MAX_REFRESHES) {
    // Gently lock it — nudge them to just answer
    btn.textContent = '✦ Give this one a go 😊';
    btn.disabled    = true;
  } else {
    btn.textContent = '↻ Try a different question';
    btn.disabled    = false;
  }
}

// ─── INIT ─────────────────────────────────────

function init() {
  const { couple } = appState;

  if (!couple.partner1 || !couple.partner2) {
    showScreen('screen-setup');
    return;
  }

  if (appState.currentSession && appState.currentSession.state) {
    resumeSession();
    return;
  }

  showHome();
}

function showHome() {
  const { couple } = appState;
  document.getElementById('home-greeting').textContent = getGreeting();
  document.getElementById('home-names').textContent    =
    `${couple.partner1} & ${couple.partner2}`;
  renderHomeStats();
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
    exchanges:       [],
    state:           'loading',
    startDate:       new Date().toISOString(),
    answer1:         null,
    answer2:         null,
    answer1Draft:    '',
    answer2Draft:    '',
    currentQuestion: null,
    currentTags:     []
  };
  saveState();

  // Reset refresh counter for the new question
  refreshCount = 0;

  showScreen('screen-p1');
  setQuestionLoadingState(true);
  hideRefreshBtn();

  try {
    const { question, tags } = await generateQuestion();
    appState.currentSession.currentQuestion = question;
    appState.currentSession.currentTags     = tags;
    appState.currentSession.state           = 'waiting_p1';
    saveState();
    renderP1Screen();
    showRefreshBtn();
    updateRefreshBtn();
  } catch (err) {
    console.error('[TeaSteep] Failed to generate question:', err);
    showToast('Could not steep a question. Check console for details.');
    appState.currentSession = null;
    saveState();
    showHome();
  }
}

// ─── LOADING STATE HELPER ─────────────────────

function setQuestionLoadingState(isLoading) {
  const qText    = document.getElementById('question-text-p1');
  const qLoading = document.getElementById('q-loading');
  const hint     = document.getElementById('prompt-hint-p1');

  if (isLoading) {
    qLoading.style.display = 'flex';
    qText.style.display    = 'none';
    qText.textContent      = '';
    if (hint) hint.textContent = '';
  } else {
    qLoading.style.display = 'none';
    qText.style.display    = 'block';
  }
}

// ─── P1 SCREEN ────────────────────────────────

function renderP1Screen() {
  const { couple, currentSession } = appState;

  document.getElementById('p1-indicator').textContent    = `● ${couple.partner1}`;
  document.getElementById('p1-answer-label').textContent =
    `${couple.partner1}'s thoughts…`;

  setQuestionLoadingState(false);

  const question = currentSession.currentQuestion || '';
  document.getElementById('question-text-p1').textContent = question;

  setPromptHint(question, 'prompt-hint-p1', null);

  document.getElementById('answer-p1').value =
    currentSession.answer1Draft || '';
}

// ─── P2 SCREEN ────────────────────────────────

function renderP2Screen() {
  const { couple, currentSession } = appState;

  document.getElementById('p2-indicator').textContent    = `● ${couple.partner2}`;
  document.getElementById('p2-answer-label').textContent =
    `${couple.partner2}'s thoughts…`;

  const question = currentSession.currentQuestion || '';
  document.getElementById('question-text-p2').textContent = question;

  setPromptHint(question, null, 'prompt-hint-p2');

  document.getElementById('answer-p2').value =
    currentSession.answer2Draft || '';
}

// ─── REVEAL SCREEN ────────────────────────────

function renderRevealScreen() {
  const { couple, currentSession } = appState;
  const last = currentSession.exchanges[currentSession.exchanges.length - 1];

  document.getElementById('question-text-reveal').textContent = last.question;
  document.getElementById('reveal-name-1').textContent        = couple.partner1;
  document.getElementById('reveal-answer-1').textContent      = last.answer1;
  document.getElementById('reveal-name-2').textContent        = couple.partner2;
  document.getElementById('reveal-answer-2').textContent      = last.answer2;
}

// ─── REFRESH QUESTION ─────────────────────────

async function refreshQuestion() {
  if (refreshCount >= MAX_REFRESHES) return;

  refreshCount++;
  updateRefreshBtn();

  // Show loading, hide refresh btn while fetching
  setQuestionLoadingState(true);
  hideRefreshBtn();

  try {
    // Generate fresh question — do NOT touch tags or depth
    const { question, tags } = await generateQuestion();
    appState.currentSession.currentQuestion = question;
    appState.currentSession.currentTags     = tags;
    // State stays 'waiting_p1' — no change
    saveState();
    renderP1Screen();
    showRefreshBtn();
    updateRefreshBtn();
  } catch (err) {
    console.error('[TeaSteep] Failed to refresh question:', err);
    showToast('Could not steep a new question. Try again.');
    setQuestionLoadingState(false);
    showRefreshBtn();
    updateRefreshBtn();
  }
}

// ─── NEXT QUESTION ────────────────────────────

async function nextQuestion() {
  appState.currentSession.answer1Draft = '';
  appState.currentSession.answer2Draft = '';
  appState.currentSession.answer1      = null;
  appState.currentSession.answer2      = null;
  appState.currentSession.state        = 'loading';
  saveState();

  // Reset refresh counter for the new question
  refreshCount = 0;

  document.getElementById('answer-p1').value = '';
  document.getElementById('answer-p2').value = '';

  showScreen('screen-p1');
  setQuestionLoadingState(true);
  hideRefreshBtn();

  try {
    const { question, tags } = await generateQuestion();
    appState.currentSession.currentQuestion = question;
    appState.currentSession.currentTags     = tags;
    appState.currentSession.state           = 'waiting_p1';
    saveState();
    renderP1Screen();
    showRefreshBtn();
    updateRefreshBtn();
  } catch (err) {
    console.error('[TeaSteep] Failed to generate next question:', err);
    showToast('Could not steep the next question. Try again.');
    setQuestionLoadingState(false);
  }
}

// ─── WRAP UP ──────────────────────────────────

async function wrapUp() {
  showScreen('screen-summary');

  const summaryLoading = document.getElementById('summary-loading');
  const summaryText    = document.getElementById('summary-text');

  summaryLoading.style.display = 'flex';
  summaryText.style.display    = 'none';
  summaryText.textContent      = '';

  let summary = '';
  try {
    summary = await generateSummary();
  } catch (err) {
    console.error('[TeaSteep] Summary generation failed:', err);
    summary = "Tonight you steeped something together. That's enough. 🍵";
  }

  summaryLoading.style.display = 'none';
  summaryText.style.display    = 'block';
  summaryText.textContent      = summary;

  const exchanges = appState.currentSession.exchanges;
  document.getElementById('session-stats').innerHTML =
    `${exchanges.length} question${exchanges.length !== 1 ? 's' : ''} explored · ${appState.currentSession.mood} night`;

  // ── Persist session ──────────────────────────
  const { couple, currentSession } = appState;

  couple.totalExchanges = (couple.totalExchanges || 0) + exchanges.length;

  const allTags = currentSession.exchanges.flatMap(e => e.tags);
  couple.topicTagsUsed = [...couple.topicTagsUsed, ...allTags].slice(-60);
  couple.sessionsCompleted += 1;

  appState.sessions.push({
    date: new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    }),
    mood:      currentSession.mood,
    depth:     getDepthNumber(couple),
    exchanges: currentSession.exchanges,
    summary
  });

  appState.currentSession = null;
  saveState();
}

// ─── HISTORY ──────────────────────────────────

function renderHistory() {
  const list     = document.getElementById('history-list');
  const sessions = [...appState.sessions].reverse();

  if (sessions.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);
      font-style:italic;padding:40px 0;">Your journey starts tonight. 🍵</p>`;
    return;
  }

  list.innerHTML = sessions.map((s, i) => `
    <div class="history-entry"
      onclick="expandHistory(${appState.sessions.length - 1 - i})">
      <div class="history-date">${s.date}</div>
      <div class="history-mood">
        ${moodEmoji(s.mood)} ${s.mood} night · ${s.exchanges.length} questions
      </div>
      <div class="history-preview">
        ${s.summary || s.exchanges[0]?.question || ''}
      </div>
    </div>
  `).join('');
}

function moodEmoji(mood) {
  return { Light: '🌿', Cozy: '🕯️', Open: '🌊' }[mood] || '🍵';
}

function expandHistory(index) {
  const s          = appState.sessions[index];
  const { couple } = appState;

  const detail = s.exchanges.map(e => `
    <div class="history-entry" style="cursor:default">
      <div class="history-mood" style="font-style:italic;font-family:'Lora',serif">
        "${e.question}"
      </div>
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

  document.getElementById('history-list').innerHTML = `
    <button class="btn-ghost" onclick="renderHistory()"
      style="margin-bottom:8px">← All sessions</button>
    <div class="history-entry" style="cursor:default;background:var(--surface-2)">
      <div class="history-date">${s.date} · ${moodEmoji(s.mood)} ${s.mood}</div>
      <div class="summary-text" style="text-align:left;margin-top:8px">
        ${s.summary || ''}
      </div>
    </div>
    ${detail}
  `;
}

// ─── EVENT LISTENERS ──────────────────────────

// Setup
document.getElementById('btn-setup-done').addEventListener('click', () => {
  const p1 = document.getElementById('input-p1').value.trim();
  const p2 = document.getElementById('input-p2').value.trim();

  if (!p1 || !p2) return showToast('Please enter both names. 🍵');

  appState.couple.partner1 = p1;
  appState.couple.partner2 = p2;
  saveState();
  showHome();
});

// Mood selection → start session
document.querySelectorAll('.mood-card').forEach(card => {
  card.addEventListener('click', () => startSession(card.dataset.mood));
});

// P1 done — lock the question, hide refresh
document.getElementById('btn-p1-done').addEventListener('click', () => {
  const answer = document.getElementById('answer-p1').value.trim();
  if (!answer) return showToast('Write something first, even just a word. 🍵');

  // Lock the question — refresh is no longer available
  hideRefreshBtn();

  appState.currentSession.answer1      = answer;
  appState.currentSession.answer1Draft = '';
  appState.currentSession.state        = 'waiting_p2';
  saveState();

  document.getElementById('handoff-msg').textContent =
    `${appState.couple.partner2}, it's your turn.`;
  showScreen('screen-handoff');
});

// Refresh question (P1 only, before answering)
document.getElementById('btn-refresh-question').addEventListener('click', refreshQuestion);

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

// Handoff → P2
document.getElementById('btn-handoff-ready').addEventListener('click', () => {
  renderP2Screen();
  showScreen('screen-p2');
});

// P2 done
document.getElementById('btn-p2-done').addEventListener('click', () => {
  const answer = document.getElementById('answer-p2').value.trim();
  if (!answer) return showToast('Write something first, even just a word. 🍵');

  const { currentSession } = appState;
  currentSession.answer2      = answer;
  currentSession.answer2Draft = '';
  currentSession.state        = 'revealed';

  currentSession.exchanges.push({
    question: currentSession.currentQuestion,
    tags:     currentSession.currentTags || [],
    answer1:  currentSession.answer1,
    answer2:  answer
  });

  currentSession.currentQuestion = null;
  currentSession.currentTags     = null;
  currentSession.answer1         = null;
  saveState();

  renderRevealScreen();
  showScreen('screen-reveal');
});

// Next question
document.getElementById('btn-next').addEventListener('click', nextQuestion);

// Wrap up (from multiple screens)
['btn-wrapup-p1', 'btn-wrapup-p2', 'btn-wrapup-reveal'].forEach(id => {
  document.getElementById(id).addEventListener('click', () => {
    if (confirm('Wrap up tonight\'s session?')) wrapUp();
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
  document.getElementById('settings-p1').value = appState.couple.partner1;
  document.getElementById('settings-p2').value = appState.couple.partner2;
  showScreen('screen-settings');
});
document.getElementById('btn-back-settings').addEventListener('click', showHome);

document.getElementById('btn-save-settings').addEventListener('click', () => {
  const p1 = document.getElementById('settings-p1').value.trim();
  const p2 = document.getElementById('settings-p2').value.trim();

  if (!p1 || !p2) return showToast('Names cannot be empty.');

  appState.couple.partner1 = p1;
  appState.couple.partner2 = p2;
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