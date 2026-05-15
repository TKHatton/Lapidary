/* Lapidary v1.1 — a floating prompt refiner
 * Loaded by the Lapidary bookmarklet from GitHub Pages.
 * Single-file, no dependencies. Vanilla JS.
 *
 * v1.1 changes (security & robustness pass):
 *  - 10KB input cap to prevent runaway API costs
 *  - 60s API timeout with abort
 *  - Auto-retry once on 5xx and network errors
 *  - In-flight mutex prevents duplicate concurrent requests
 *  - JSON parse fallback with one repair attempt
 *  - navigator.onLine check before requests
 *  - Position remembered across sessions (localStorage)
 *  - Ctrl/Cmd+Enter to submit
 *  - Focus-stealing bug in input handler fixed
 *  - Speech recognition error backoff
 */
(function () {
  'use strict';

  if (window.__lapidaryActive) {
    const existing = document.getElementById('lapidary-root');
    if (existing) existing.remove();
    window.__lapidaryActive = false;
    return;
  }
  window.__lapidaryActive = true;

  const STORAGE_KEY = 'lapidary_anthropic_key';
  const POSITION_KEY = 'lapidary_position';
  const MODEL_ID = 'claude-sonnet-4-6';
  const MAX_INPUT_CHARS = 10000;
  const REQUEST_TIMEOUT_MS = 60000;

  const css = `
    #lapidary-root, #lapidary-root * { box-sizing: border-box; }
    #lapidary-root {
      position: fixed; top: 24px; right: 24px;
      width: 420px; max-height: calc(100vh - 48px);
      z-index: 2147483647;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      color: #2d1b3d;
      background: linear-gradient(180deg, #f7f3fb 0%, #f1eaf6 100%);
      border: 1.5px solid #e2d4ec;
      border-radius: 16px;
      box-shadow: 0 24px 60px rgba(45, 27, 61, 0.18), 0 4px 12px rgba(45, 27, 61, 0.08);
      overflow: hidden;
      display: flex; flex-direction: column;
      animation: lap-in 0.18s ease-out;
    }
    @keyframes lap-in {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    #lapidary-root.dragging { transition: none; user-select: none; }
    .lap-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid #e2d4ec;
      cursor: grab;
      background: rgba(255,255,255,0.4);
    }
    .lap-header.dragging { cursor: grabbing; }
    .lap-title {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 1.4rem; font-weight: 500;
      font-style: italic;
      color: #8b6dc7;
      letter-spacing: -0.02em;
      line-height: 1;
    }
    .lap-title-row { display: flex; align-items: baseline; gap: 10px; }
    .lap-tag {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem;
      color: #9b8eb0;
      letter-spacing: 0.18em;
    }
    .lap-close {
      background: none; border: none;
      width: 28px; height: 28px;
      border-radius: 8px;
      color: #6b5b7e;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
      font-size: 18px; line-height: 1;
    }
    .lap-close:hover { background: rgba(45, 27, 61, 0.06); }
    .lap-body { padding: 16px 18px 18px; overflow-y: auto; flex: 1; }
    .lap-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.65rem;
      color: #9b8eb0;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .lap-textarea-wrap {
      position: relative;
      border: 1.5px solid #e2d4ec;
      border-radius: 12px;
      background: #ffffff;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .lap-textarea-wrap.listening {
      border-color: #8b6dc7;
      box-shadow: 0 0 0 4px rgba(139, 109, 199, 0.12);
    }
    .lap-textarea {
      width: 100%; padding: 12px 14px;
      background: transparent; border: none; outline: none;
      resize: none;
      font-family: inherit;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #2d1b3d;
      min-height: 110px;
    }
    .lap-textarea-small { min-height: 56px; padding-right: 40px; }
    .lap-listening-pill {
      position: absolute; top: 10px; right: 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; color: #8b6dc7;
      letter-spacing: 0.12em;
      display: flex; align-items: center; gap: 6px;
    }
    .lap-pulse {
      display: inline-block; width: 7px; height: 7px;
      border-radius: 50%; background: #8b6dc7;
      animation: lap-pulse 1.2s ease-in-out infinite;
    }
    @keyframes lap-pulse {
      0%, 100% { opacity: 0.4; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.1); }
    }
    .lap-charcount {
      position: absolute; bottom: 8px; right: 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem;
      color: #b5a8c4;
      letter-spacing: 0.05em;
      pointer-events: none;
    }
    .lap-charcount.warn { color: #c46a8a; }
    .lap-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
    .lap-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 16px;
      border: none; border-radius: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s;
    }
    .lap-btn:active:not(:disabled) { transform: translateY(1px); }
    .lap-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .lap-btn-primary {
      background: #8b6dc7; color: #ffffff;
      box-shadow: 0 4px 12px rgba(139, 109, 199, 0.22);
    }
    .lap-btn-primary:hover:not(:disabled) {
      background: #7a5cb8;
      box-shadow: 0 6px 16px rgba(139, 109, 199, 0.3);
    }
    .lap-btn-secondary {
      background: #f3ecf8; color: #2d1b3d;
      border: 1.5px solid #e2d4ec;
      font-weight: 500;
    }
    .lap-btn-secondary:hover:not(:disabled) { background: #ebe1f3; }
    .lap-btn-mint {
      background: #5fb091; color: #ffffff;
      box-shadow: 0 4px 12px rgba(95, 176, 145, 0.25);
    }
    .lap-btn-ghost {
      background: transparent; color: #6b5b7e;
      font-weight: 500;
      padding: 10px 12px;
    }
    .lap-btn-ghost:hover { color: #2d1b3d; background: rgba(45, 27, 61, 0.04); }
    .lap-mic-mini {
      position: absolute; top: 8px; right: 8px;
      width: 32px; height: 32px;
      border: none; border-radius: 8px;
      background: transparent; color: #9b8eb0;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .lap-mic-mini:hover { background: rgba(45, 27, 61, 0.05); color: #2d1b3d; }
    .lap-mic-mini.active { background: #5fb091; color: #ffffff; }
    .lap-mic-mini.active:hover { background: #4d9a7d; }
    .lap-card {
      padding: 14px 16px;
      border: 1.5px solid #e2d4ec;
      border-radius: 12px;
      background: #ffffff;
      margin-bottom: 14px;
    }
    .lap-card-accent { border-color: #c9b8e3; background: #fbf7fe; }
    .lap-detect-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .lap-detect-val {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 1.05rem;
      color: #2d1b3d;
      font-weight: 500;
      line-height: 1.2;
    }
    .lap-detect-val em { color: #8b6dc7; font-style: italic; font-weight: 500; }
    .lap-detect-sub {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem;
      color: #9b8eb0;
      margin-top: 4px;
      letter-spacing: 0.08em;
    }
    .lap-reason {
      font-family: 'Fraunces', Georgia, serif;
      font-style: italic;
      font-size: 0.85rem;
      color: #6b5b7e;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e2d4ec;
      line-height: 1.5;
    }
    .lap-question { margin-bottom: 16px; }
    .lap-question-text {
      font-size: 0.92rem;
      color: #2d1b3d;
      margin-bottom: 8px;
      line-height: 1.5;
    }
    .lap-q-num {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #8b6dc7;
      font-size: 0.8rem;
      margin-right: 8px;
    }
    .lap-prompt-box {
      border: 1.5px solid #e2d4ec;
      border-radius: 12px;
      background: #ffffff;
      padding: 14px;
      margin-bottom: 12px;
      max-height: 220px;
      overflow-y: auto;
    }
    .lap-prompt-text {
      white-space: pre-wrap;
      font-size: 0.85rem;
      line-height: 1.55;
      color: #2d1b3d;
      margin: 0;
      font-family: inherit;
    }
    .lap-note {
      font-family: 'Fraunces', Georgia, serif;
      font-style: italic;
      font-size: 0.82rem;
      color: #6b5b7e;
      margin: 0 0 14px;
      line-height: 1.5;
    }
    .lap-note-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-style: normal;
      font-size: 0.6rem;
      color: #9b8eb0;
      letter-spacing: 0.18em;
      margin-right: 8px;
    }
    .lap-error {
      margin-top: 12px; padding: 10px 12px;
      background: #fae4ec;
      color: #8a3a52;
      border: 1px solid #e8b8c8;
      border-left: 3px solid #c46a8a;
      border-radius: 8px;
      font-size: 0.82rem;
      line-height: 1.4;
    }
    .lap-key-prompt { padding: 6px 0 8px; }
    .lap-key-prompt p {
      font-size: 0.88rem;
      line-height: 1.55;
      color: #2d1b3d;
      margin: 0 0 12px;
    }
    .lap-key-prompt a {
      color: #8b6dc7;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .lap-key-input {
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid #e2d4ec;
      border-radius: 10px;
      background: #ffffff;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.8rem;
      color: #2d1b3d;
      outline: none;
      transition: border-color 0.2s;
    }
    .lap-key-input:focus { border-color: #8b6dc7; }
    .lap-footer {
      padding: 10px 18px;
      border-top: 1px solid #e2d4ec;
      background: rgba(255,255,255,0.4);
      text-align: center;
    }
    .lap-footer span {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.58rem;
      color: #9b8eb0;
      letter-spacing: 0.15em;
    }
    .lap-footer a { color: #8b6dc7; text-decoration: none; margin-left: 6px; }
    .lap-footer a:hover { text-decoration: underline; }
    .lap-body::-webkit-scrollbar, .lap-prompt-box::-webkit-scrollbar { width: 8px; }
    .lap-body::-webkit-scrollbar-thumb, .lap-prompt-box::-webkit-scrollbar-thumb {
      background: #d8c8e6; border-radius: 4px;
    }
    .lap-body::-webkit-scrollbar-thumb:hover, .lap-prompt-box::-webkit-scrollbar-thumb:hover {
      background: #c9b8e3;
    }
  `;

  if (!document.getElementById('lap-fonts')) {
    const link = document.createElement('link');
    link.id = 'lap-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;1,400;1,500&family=Plus+Jakarta+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }

  const styleEl = document.createElement('style');
  styleEl.id = 'lapidary-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const FRAMEWORK_NAMES = {
    'CO-STAR': 'Context · Objective · Style · Tone · Audience · Response',
    'RTF': 'Role · Task · Format',
    'RISEN': 'Role · Instructions · Steps · End-goal · Narrowing',
    'Chain-of-Thought': 'Explicit reasoning steps',
    'Hybrid': 'Blended approach'
  };

  function getModelRec(taskType, complexity) {
    let rec;
    if (complexity === 'simple') {
      rec = { primary: 'Claude Haiku 4.5', alt: 'Claude Sonnet 4.6', why: 'Fast and cheap for straightforward tasks' };
    } else if (complexity === 'complex') {
      rec = { primary: 'Claude Opus 4.7', alt: 'GPT-5', why: 'Deepest reasoning for hard, multi-layered tasks' };
    } else {
      rec = { primary: 'Claude Sonnet 4.6', alt: 'Claude Opus 4.7', why: 'Strong general-purpose, balanced cost vs. quality' };
    }
    if (taskType === 'research') {
      rec = { primary: 'Claude Opus 4.7 (Research mode)', alt: 'GPT-5 Deep Research', why: 'Multi-source synthesis with citations' };
    } else if ((taskType === 'creative' || taskType === 'writing') && complexity !== 'simple') {
      rec = { primary: 'Claude Opus 4.7', alt: 'Claude Sonnet 4.6', why: 'Opus has the strongest prose quality and tonal control' };
    } else if (taskType === 'debugging' && complexity !== 'simple') {
      rec = { primary: 'Claude Opus 4.7', alt: 'Claude Sonnet 4.6', why: 'Best at root-cause analysis in unfamiliar code' };
    } else if (taskType === 'communication') {
      rec = { primary: 'Claude Sonnet 4.6', alt: 'Claude Haiku 4.5', why: 'Fast and tonally precise for emails, messages, posts' };
    }
    return rec;
  }

  const state = {
    apiKey: localStorage.getItem(STORAGE_KEY) || '',
    phase: '',
    rawInput: '',
    questions: [],
    answers: [],
    taskType: '',
    complexity: 'medium',
    framework: '',
    frameworkReason: '',
    polishedPrompt: '',
    promptNotes: '',
    loading: false,
    loadingMsg: '',
    error: '',
    listeningTarget: null,
    inFlight: false,
  };
  state.phase = state.apiKey ? 'input' : 'key';

  let recognition = null;
  let speechSupported = true;
  let speechErrorCount = 0;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      speechErrorCount = 0;
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
      }
      if (!transcript.trim()) return;
      const target = state.listeningTarget;
      if (target === 'input') {
        const next = (state.rawInput ? state.rawInput + ' ' : '') + transcript.trim();
        state.rawInput = next.slice(0, MAX_INPUT_CHARS);
        render();
      } else if (target && target.startsWith('answer:')) {
        const idx = parseInt(target.split(':')[1], 10);
        const next = (state.answers[idx] ? state.answers[idx] + ' ' : '') + transcript.trim();
        state.answers[idx] = next.slice(0, MAX_INPUT_CHARS);
        render();
      }
    };
    recognition.onend = () => {
      state.listeningTarget = null;
      render();
    };
    recognition.onerror = (e) => {
      speechErrorCount++;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        state.error = 'Microphone access denied. Allow mic permission in your browser/OS settings.';
        speechSupported = false;
      } else if (speechErrorCount >= 3) {
        state.error = 'Microphone keeps failing. Just type instead.';
        speechSupported = false;
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        state.error = `Microphone issue: ${e.error}. Try again.`;
      }
      state.listeningTarget = null;
      render();
    };
  } else {
    speechSupported = false;
  }

  function startListening(target) {
    state.error = '';
    if (!recognition || !speechSupported) {
      state.error = 'Speech recognition not available. Just type.';
      render();
      return;
    }
    if (state.listeningTarget) {
      try { recognition.stop(); } catch (e) {}
    }
    state.listeningTarget = target;
    render();
    try { recognition.start(); } catch (e) {
      state.error = 'Could not start mic. Refresh and allow mic access.';
      state.listeningTarget = null;
      render();
    }
  }

  function stopListening() {
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
    }
  }

  function parseJSONStrict(text) {
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('No JSON object found');
    return JSON.parse(cleaned.slice(s, e + 1));
  }

  async function callClaude(prompt, maxTokens, attempt) {
    attempt = attempt || 0;
    if (!navigator.onLine) {
      throw new Error('You appear to be offline. Check your connection.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': state.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL_ID,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if ((response.status >= 500 || response.status === 429) && attempt === 0) {
          await new Promise(r => setTimeout(r, 1200));
          return callClaude(prompt, maxTokens, attempt + 1);
        }
        if (response.status === 401) throw new Error('API key rejected. Click "Reset Key" in the footer.');
        if (response.status === 429) throw new Error('Rate limited. Wait a moment and try again.');
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      return data.content.filter(c => c.type === 'text').map(c => c.text).join('');
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') throw new Error('Request timed out after 60s. Try again.');
      if (e instanceof TypeError && attempt === 0) {
        await new Promise(r => setTimeout(r, 1200));
        return callClaude(prompt, maxTokens, attempt + 1);
      }
      throw e;
    }
  }

  async function callClaudeJSON(prompt, maxTokens) {
    const text = await callClaude(prompt, maxTokens);
    try {
      return parseJSONStrict(text);
    } catch (e) {
      const repair = await callClaude(
        `The following was supposed to be valid JSON but isn't. Return ONLY valid JSON with the same intended structure, no preamble, no markdown:\n\n${text}`,
        maxTokens
      );
      return parseJSONStrict(repair);
    }
  }

  async function analyzeInput() {
    if (state.inFlight) return;
    if (!state.rawInput.trim()) {
      state.error = 'Add some input first — speak or type.';
      render();
      return;
    }
    state.inFlight = true;
    state.error = '';
    state.loading = true;
    state.loadingMsg = 'Reading your idea';
    render();

    try {
      const parsed = await callClaudeJSON(`You are an expert prompt engineer helping someone turn a rough, often voice-transcribed idea into an excellent AI prompt.

USER'S ROUGH INPUT (may ramble, may have transcription artifacts — be forgiving of these):
"""
${state.rawInput}
"""

Analyze this and respond with ONLY a valid JSON object (no markdown fences, no preamble, no trailing text):

{
  "taskType": "one of: coding, writing, research, analysis, planning, communication, creative, learning, debugging, brainstorming, other",
  "complexity": "one of: simple, medium, complex",
  "framework": "one of: CO-STAR, RTF, RISEN, Chain-of-Thought, Hybrid",
  "frameworkReason": "one sentence on why this framework fits",
  "questions": ["Q1 if needed", "Q2 if needed", "Q3 if needed"]
}

Rules:
- 0-3 questions. Fewer is better. Only ask what is genuinely missing and would meaningfully change the prompt.
- Questions must be SPECIFIC to this task — never generic like "what's your goal?" or "what tone?"
- Each question answerable in 1-2 sentences
- If input is already detailed enough, return "questions": []
- Framework guide: CO-STAR for content/comms with audience nuance, RTF for simple direct tasks, RISEN for multi-step work with constraints, Chain-of-Thought for reasoning/analysis, Hybrid for mixed needs
- Complexity guide: simple = one clear action, no ambiguity. medium = multiple parts or some judgment needed. complex = deep reasoning, multiple constraints, or significant ambiguity.`, 1000);

      state.taskType = parsed.taskType || 'other';
      state.complexity = parsed.complexity || 'medium';
      state.framework = parsed.framework || 'Hybrid';
      state.frameworkReason = parsed.frameworkReason || '';

      if (!parsed.questions || parsed.questions.length === 0) {
        state.inFlight = false;
        await generatePrompt();
        return;
      } else {
        state.questions = parsed.questions;
        state.answers = new Array(parsed.questions.length).fill('');
        state.phase = 'clarifying';
      }
    } catch (e) {
      state.error = `Could not analyze: ${e.message}`;
    }
    state.loading = false;
    state.inFlight = false;
    render();
  }

  async function generatePrompt() {
    if (state.inFlight) return;
    state.inFlight = true;
    state.loading = true;
    state.loadingMsg = 'Refining your prompt';
    state.error = '';
    render();

    try {
      const qaSection = state.questions.length > 0
        ? state.questions.map((q, i) => `Q: ${q}\nA: ${state.answers[i] || '(skipped)'}`).join('\n\n')
        : '(no clarifying questions were needed)';

      const parsed = await callClaudeJSON(`You are an expert prompt engineer. Synthesize a polished, production-quality prompt from this material.

USER'S ROUGH IDEA:
"""
${state.rawInput}
"""

CLARIFYING Q&A:
${qaSection}

TASK TYPE: ${state.taskType}
COMPLEXITY: ${state.complexity}
FRAMEWORK TO APPLY: ${state.framework}

Apply the framework to create an excellent prompt another AI can act on directly.

Respond with ONLY a valid JSON object (no markdown fences, no preamble):

{
  "prompt": "The polished prompt, ready to copy-paste into any AI. Include all relevant context, constraints, and desired output format. Be specific. Detailed but not bloated.",
  "notes": "1-2 sentences on the structural choices you made"
}

Framework reference:
- CO-STAR: Context, Objective, Style, Tone, Audience, Response format
- RTF: Role, Task, Format
- RISEN: Role, Instructions, Steps, End goal, Narrowing constraints
- Chain-of-Thought: Set up explicit reasoning steps
- Hybrid: Blend elements as needed

Write in second person ("You are...", "Your task...") so it reads naturally when pasted into a fresh chat. Do not include meta-commentary like "Here is your prompt" inside the prompt itself.`, 1500);

      state.polishedPrompt = parsed.prompt || '';
      state.promptNotes = parsed.notes || '';
      state.phase = 'output';
    } catch (e) {
      state.error = `Could not generate: ${e.message}`;
    }
    state.loading = false;
    state.inFlight = false;
    render();
  }

  function reset() {
    state.phase = 'input';
    state.rawInput = '';
    state.questions = [];
    state.answers = [];
    state.taskType = '';
    state.complexity = 'medium';
    state.framework = '';
    state.frameworkReason = '';
    state.polishedPrompt = '';
    state.promptNotes = '';
    state.error = '';
    render();
  }

  async function copyPrompt(btn) {
    try {
      await navigator.clipboard.writeText(state.polishedPrompt);
      btn.classList.remove('lap-btn-primary');
      btn.classList.add('lap-btn-mint');
      btn.innerHTML = '✓ COPIED';
      setTimeout(() => {
        btn.classList.remove('lap-btn-mint');
        btn.classList.add('lap-btn-primary');
        btn.innerHTML = '⎘ COPY PROMPT';
      }, 2000);
    } catch (e) {
      state.error = 'Could not copy. Select text manually.';
      render();
    }
  }

  function saveKey(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith('sk-ant-')) {
      state.error = 'That doesn\'t look like an Anthropic key. Should start with "sk-ant-".';
      render();
      return;
    }
    if (trimmed.length < 30) {
      state.error = 'Key looks too short. Paste the full key.';
      render();
      return;
    }
    state.apiKey = trimmed;
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch (e) {
      state.error = 'Could not save key (localStorage blocked). It will work for this session only.';
    }
    if (!state.error.includes('localStorage')) state.error = '';
    state.phase = 'input';
    render();
  }

  function clearKey() {
    if (!confirm('Remove the saved API key from this browser?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    state.apiKey = '';
    state.phase = 'key';
    render();
  }

  function close() {
    const root = document.getElementById('lapidary-root');
    if (root) root.remove();
    document.getElementById('lapidary-styles')?.remove();
    window.__lapidaryActive = false;
    document.removeEventListener('keydown', keyHandler);
  }

  function keyHandler(e) {
    if (e.key === 'Escape' && state.listeningTarget === null && !state.inFlight) {
      close();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const root = document.getElementById('lapidary-root');
      if (!root || !root.contains(document.activeElement)) return;
      if (state.phase === 'input' && state.rawInput.trim() && !state.loading) {
        e.preventDefault();
        analyzeInput();
      } else if (state.phase === 'clarifying' && !state.loading) {
        e.preventDefault();
        generatePrompt();
      }
    }
  }
  document.addEventListener('keydown', keyHandler);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render() {
    let root = document.getElementById('lapidary-root');
    const isFirst = !root;
    if (isFirst) {
      root = document.createElement('div');
      root.id = 'lapidary-root';
      document.body.appendChild(root);
      try {
        const saved = localStorage.getItem(POSITION_KEY);
        if (saved) {
          const pos = JSON.parse(saved);
          if (typeof pos.left === 'number' && typeof pos.top === 'number') {
            const safeLeft = Math.max(0, Math.min(window.innerWidth - 420, pos.left));
            const safeTop = Math.max(0, Math.min(window.innerHeight - 80, pos.top));
            root.style.left = safeLeft + 'px';
            root.style.top = safeTop + 'px';
            root.style.right = 'auto';
          }
        }
      } catch (e) {}
    }

    const headerHTML = `
      <div class="lap-header" id="lap-header">
        <div class="lap-title-row">
          <span class="lap-title">Lapidary</span>
          <span class="lap-tag">ROUGH → FACETED</span>
        </div>
        <button class="lap-close" id="lap-close-btn" title="Close (Esc)">×</button>
      </div>
    `;

    let bodyHTML = '';

    if (state.phase === 'key') {
      bodyHTML = `
        <div class="lap-key-prompt">
          <p>Lapidary needs your Anthropic API key to work. Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. It's stored only in this browser's localStorage.</p>
          <input type="password" class="lap-key-input" id="lap-key-input" placeholder="sk-ant-..." autocomplete="off" />
          <div class="lap-actions">
            <button class="lap-btn lap-btn-primary" id="lap-key-save">SAVE KEY</button>
          </div>
        </div>
      `;
    } else if (state.phase === 'input') {
      const charCount = state.rawInput.length;
      const nearLimit = charCount > MAX_INPUT_CHARS * 0.9;
      bodyHTML = `
        <div class="lap-label">Your rough idea</div>
        <div class="lap-textarea-wrap ${state.listeningTarget === 'input' ? 'listening' : ''}">
          <textarea class="lap-textarea" id="lap-input" maxlength="${MAX_INPUT_CHARS}" placeholder="Talk into the mic, or type. Ramble — that's fine.">${esc(state.rawInput)}</textarea>
          ${state.listeningTarget === 'input' ? '<div class="lap-listening-pill"><span class="lap-pulse"></span>LISTENING</div>' : ''}
          ${charCount > 200 ? `<div class="lap-charcount ${nearLimit ? 'warn' : ''}">${charCount} / ${MAX_INPUT_CHARS}</div>` : ''}
        </div>
        <div class="lap-actions">
          ${speechSupported ? `
            <button class="lap-btn ${state.listeningTarget === 'input' ? 'lap-btn-mint' : 'lap-btn-secondary'}" id="lap-mic-btn" ${state.loading ? 'disabled' : ''}>
              ${state.listeningTarget === 'input' ? '◼ STOP' : '🎤 SPEAK'}
            </button>
          ` : ''}
          <button class="lap-btn lap-btn-primary" id="lap-analyze-btn" ${state.loading || !state.rawInput.trim() ? 'disabled' : ''}>
            ${state.loading ? `<span class="lap-pulse" style="background:#fff"></span>${state.loadingMsg.toUpperCase()}` : 'ANALYZE →'}
          </button>
          ${state.rawInput && !state.loading ? '<button class="lap-btn lap-btn-ghost" id="lap-clear-btn">CLEAR</button>' : ''}
        </div>
        ${!speechSupported ? '<p style="margin-top:10px;font-size:0.78rem;color:#9b8eb0;font-style:italic;">Voice input not available. Just type.</p>' : ''}
      `;
    } else if (state.phase === 'clarifying') {
      bodyHTML = `
        <div class="lap-card">
          <div class="lap-detect-grid">
            <div>
              <div class="lap-label" style="margin-bottom:4px">Detected</div>
              <div class="lap-detect-val">${esc(state.taskType.charAt(0).toUpperCase() + state.taskType.slice(1))} <span style="color:#9b8eb0;font-size:0.85rem;font-weight:400">· ${esc(state.complexity)}</span></div>
            </div>
            <div>
              <div class="lap-label" style="margin-bottom:4px">Framework</div>
              <div class="lap-detect-val"><em>${esc(state.framework)}</em></div>
              <div class="lap-detect-sub">${esc(FRAMEWORK_NAMES[state.framework] || '')}</div>
            </div>
          </div>
          ${state.frameworkReason ? `<p class="lap-reason">${esc(state.frameworkReason)}</p>` : ''}
        </div>
        <div class="lap-label">Quick clarifications</div>
        ${state.questions.map((q, i) => `
          <div class="lap-question">
            <p class="lap-question-text"><span class="lap-q-num">${(i + 1).toString().padStart(2, '0')}</span>${esc(q)}</p>
            <div class="lap-textarea-wrap ${state.listeningTarget === `answer:${i}` ? 'listening' : ''}">
              <textarea class="lap-textarea lap-textarea-small" data-answer-idx="${i}" maxlength="${MAX_INPUT_CHARS}" placeholder="Type or speak — a sentence or two is plenty.">${esc(state.answers[i] || '')}</textarea>
              ${speechSupported ? `<button class="lap-mic-mini ${state.listeningTarget === `answer:${i}` ? 'active' : ''}" data-mic-idx="${i}" title="${state.listeningTarget === `answer:${i}` ? 'Stop' : 'Speak'}">${state.listeningTarget === `answer:${i}` ? '◼' : '🎤'}</button>` : ''}
            </div>
          </div>
        `).join('')}
        <div class="lap-actions">
          <button class="lap-btn lap-btn-primary" id="lap-generate-btn" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? `<span class="lap-pulse" style="background:#fff"></span>${state.loadingMsg.toUpperCase()}` : '✦ FACET PROMPT'}
          </button>
          <button class="lap-btn lap-btn-ghost" id="lap-back-btn" ${state.loading ? 'disabled' : ''}>BACK</button>
        </div>
      `;
    } else if (state.phase === 'output') {
      const rec = getModelRec(state.taskType, state.complexity);
      bodyHTML = `
        <div class="lap-card lap-card-accent">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
            <span style="color:#8b6dc7">✦</span>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;letter-spacing:0.18em;color:#8b6dc7;font-weight:500">PROMPT READY</span>
          </div>
          <div class="lap-detect-grid">
            <div>
              <div class="lap-label" style="margin-bottom:4px">Best for</div>
              <div class="lap-detect-val">${esc(rec.primary)}</div>
              <div style="font-size:0.75rem;margin-top:6px;color:#6b5b7e;line-height:1.4">${esc(rec.why)}</div>
            </div>
            <div>
              <div class="lap-label" style="margin-bottom:4px">Or try</div>
              <div class="lap-detect-val">${esc(rec.alt)}</div>
              <div class="lap-detect-sub" style="margin-top:8px">APPLIED: ${esc(state.framework.toUpperCase())}</div>
            </div>
          </div>
        </div>
        <div class="lap-label">Your polished prompt</div>
        <div class="lap-prompt-box">
          <pre class="lap-prompt-text">${esc(state.polishedPrompt)}</pre>
        </div>
        ${state.promptNotes ? `<p class="lap-note"><span class="lap-note-label">NOTE</span>${esc(state.promptNotes)}</p>` : ''}
        <div class="lap-actions">
          <button class="lap-btn lap-btn-primary" id="lap-copy-btn">⎘ COPY PROMPT</button>
          <button class="lap-btn lap-btn-secondary" id="lap-new-btn">↺ NEW</button>
        </div>
      `;
    }

    const errorHTML = state.error ? `<div class="lap-error">⚠ ${esc(state.error)}</div>` : '';

    const footerHTML = `
      <div class="lap-footer">
        <span>SONNET 4 · ESC TO CLOSE · CTRL+ENTER SUBMITS${state.apiKey ? ' · <a href="#" id="lap-key-clear">RESET KEY</a>' : ''}</span>
      </div>
    `;

    // Preserve focus across re-renders
    const activeId = document.activeElement?.id;
    const activeIdx = document.activeElement?.dataset?.answerIdx;
    const selStart = document.activeElement?.selectionStart;
    const selEnd = document.activeElement?.selectionEnd;

    root.innerHTML = `${headerHTML}<div class="lap-body">${bodyHTML}${errorHTML}</div>${footerHTML}`;

    if (activeId && document.getElementById(activeId)) {
      const el = document.getElementById(activeId);
      el.focus();
      if (typeof selStart === 'number') {
        try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    } else if (activeIdx !== undefined) {
      const el = document.querySelector(`[data-answer-idx="${activeIdx}"]`);
      if (el) {
        el.focus();
        if (typeof selStart === 'number') {
          try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
        }
      }
    }

    document.getElementById('lap-close-btn').onclick = close;

    if (state.phase === 'key') {
      const input = document.getElementById('lap-key-input');
      document.getElementById('lap-key-save').onclick = () => saveKey(input.value);
      input.onkeydown = (e) => { if (e.key === 'Enter') saveKey(input.value); };
      if (!activeId) input.focus();
    } else if (state.phase === 'input') {
      const ta = document.getElementById('lap-input');
      ta.oninput = (e) => {
        const wasEmpty = state.rawInput.trim() === '';
        const isEmpty = e.target.value.trim() === '';
        state.rawInput = e.target.value;
        // Only re-render on empty<->non-empty transition (toggles buttons)
        if (wasEmpty !== isEmpty) {
          render();
        } else {
          // Update char counter in place
          const cc = root.querySelector('.lap-charcount');
          if (state.rawInput.length > 200) {
            const text = `${state.rawInput.length} / ${MAX_INPUT_CHARS}`;
            const warn = state.rawInput.length > MAX_INPUT_CHARS * 0.9;
            if (cc) {
              cc.textContent = text;
              cc.classList.toggle('warn', warn);
            } else {
              // Counter wasn't shown but should be now — re-render
              render();
            }
          } else if (cc) {
            // Crossed back under 200 — re-render to remove counter
            render();
          }
        }
      };
      if (speechSupported) {
        document.getElementById('lap-mic-btn').onclick = () => {
          state.listeningTarget === 'input' ? stopListening() : startListening('input');
        };
      }
      document.getElementById('lap-analyze-btn').onclick = analyzeInput;
      const clearBtn = document.getElementById('lap-clear-btn');
      if (clearBtn) clearBtn.onclick = () => { state.rawInput = ''; render(); };
      if (isFirst && !state.listeningTarget && !activeId) ta.focus();
    } else if (state.phase === 'clarifying') {
      document.querySelectorAll('[data-answer-idx]').forEach(ta => {
        ta.oninput = (e) => {
          const idx = parseInt(e.target.dataset.answerIdx, 10);
          state.answers[idx] = e.target.value;
        };
      });
      document.querySelectorAll('[data-mic-idx]').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.micIdx, 10);
          const target = `answer:${idx}`;
          state.listeningTarget === target ? stopListening() : startListening(target);
        };
      });
      document.getElementById('lap-generate-btn').onclick = generatePrompt;
      document.getElementById('lap-back-btn').onclick = () => { state.phase = 'input'; render(); };
    } else if (state.phase === 'output') {
      document.getElementById('lap-copy-btn').onclick = (e) => copyPrompt(e.currentTarget);
      document.getElementById('lap-new-btn').onclick = reset;
    }

    const keyClear = document.getElementById('lap-key-clear');
    if (keyClear) keyClear.onclick = (e) => { e.preventDefault(); clearKey(); };

    setupDrag();
  }

  function setupDrag() {
    const root = document.getElementById('lapidary-root');
    const header = document.getElementById('lap-header');
    if (!root || !header) return;
    let startX, startY, startLeft, startTop;
    header.onmousedown = (e) => {
      if (e.target.closest('button')) return;
      const rect = root.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      root.classList.add('dragging');
      header.classList.add('dragging');
      const move = (ev) => {
        const newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, startLeft + ev.clientX - startX));
        const newTop = Math.max(0, Math.min(window.innerHeight - 60, startTop + ev.clientY - startY));
        root.style.left = newLeft + 'px';
        root.style.top = newTop + 'px';
        root.style.right = 'auto';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        root.classList.remove('dragging');
        header.classList.remove('dragging');
        try {
          const finalRect = root.getBoundingClientRect();
          localStorage.setItem(POSITION_KEY, JSON.stringify({ left: finalRect.left, top: finalRect.top }));
        } catch (e) {}
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    };
  }

  render();
})();
