# Lapidary

A floating prompt refiner. Speak a rough idea on any web page, get back a polished, framework-applied prompt with a recommendation for which AI model to send it to.

Built because voice dictation makes me lazy, and lazy prompts waste tokens and produce mediocre answers. This forces the moment of thought back into the workflow without forcing me to type out everything by hand.

---

## What it does

1. Click the **Lapidary** bookmark on any web page.
2. A small panel slides in from the top-right corner.
3. Speak (or type) your rough idea. Ramble — that's fine.
4. Click **Analyze**. Lapidary detects:
   - What kind of task it is (writing, coding, research, debugging, etc.)
   - How complex it is (simple, medium, complex)
   - Which prompt-engineering framework fits best (CO-STAR, RTF, RISEN, Chain-of-Thought, or a Hybrid)
5. If anything important is missing, Lapidary asks up to 3 specific clarifying questions. Never generic ones.
6. You answer (voice or text), click **Facet Prompt**.
7. You get a polished prompt ready to paste anywhere, plus a recommendation for the best Claude or GPT model to run it on.

The whole thing runs in a draggable panel. Press **Esc** to close. Position is remembered between sessions.

---

## Why a bookmarklet instead of an extension or a web app

- **Extensions** require a Chrome Web Store review, a publisher account, and ongoing manifest maintenance. For a personal tool, that's overkill.
- **Web apps** mean another tab to manage. Lapidary's value is being available *inside whatever tab you're already in* — Claude, ChatGPT, Gmail, a Google Doc, anywhere.
- **Bookmarklets** install in 30 seconds, work in any modern browser that syncs bookmarks, and overlay onto any page where they're allowed.

Trade-offs are real and discussed in the security section below.

---

## Setup

### 1. Get an Anthropic API key

1. Sign up at [console.anthropic.com](https://console.anthropic.com/).
2. Add a payment method under **Settings → Billing**. Set a monthly spending cap of $5 to start. You won't get close — Sonnet 4 is cheap and each Lapidary use is a small handful of tokens.
3. Go to **Settings → API Keys → Create Key**. Name it "Lapidary". Copy the key (starts with `sk-ant-...`).

### 2. Host the script on GitHub Pages

The bookmarklet is tiny — it just fetches and runs `lapidary.js` from a URL. You need somewhere to put that file. GitHub Pages is free and made for exactly this.

1. Create a new public repo on GitHub. Name it `lapidary`.
2. Add `lapidary.js` to the repo (drag-and-drop in the browser, no local setup needed).
3. Go to **Settings → Pages**. Under "Source", pick `Deploy from a branch`. Branch: `main`, folder: `/ (root)`. Save.
4. Wait about 60 seconds. Your site goes live at `https://YOUR-USERNAME.github.io/lapidary/`.

Confirm by opening `https://YOUR-USERNAME.github.io/lapidary/lapidary.js` in a tab — you should see the raw JavaScript.

### 3. Create the bookmark

In Chrome, right-click the bookmarks bar → **Add page**:
- **Name:** `Lapidary`
- **URL:** the line below, with `YOUR-USERNAME` replaced:

```
javascript:(function(){var s=document.createElement('script');s.src='https://YOUR-USERNAME.github.io/lapidary/lapidary.js?v=1';document.body.appendChild(s);})();
```

The `?v=1` is a version tag. When you update `lapidary.js`, bump it to `?v=2` in your bookmark to force browsers to fetch the new version instead of using a cached one.

### 4. Use it

Click the bookmark. First time only: paste your API key. It saves to your browser's localStorage. From then on, it's instant.

---

## Keyboard shortcuts

- **Esc** — close the panel
- **Ctrl + Enter** — submit (analyze or generate, depending on which step you're on)
- Drag the header to move the panel anywhere. Position is remembered.

---

## Security model

This is a personal tool. The security model reflects that, and I want to be explicit about the tradeoffs:

**Your API key lives in your browser's localStorage.** It never leaves your machine in any direction except in the `x-api-key` header on requests to `api.anthropic.com`. There is no Lapidary server. There is no telemetry.

**Risks you should understand:**

- **Anyone with physical access to your unlocked computer** can open DevTools and read the key. Lock your screen.
- **The bookmarklet runs in the context of whichever page you clicked it on.** That means malicious JavaScript on that page could, in theory, read the key from localStorage while Lapidary is open. Don't click the bookmark on sketchy websites. On reputable sites (Claude.ai, ChatGPT, Gmail, GitHub, Google Docs, mainstream blogs) this isn't a practical concern.
- **The API key is visible in your DevTools Network tab** while requests are in flight. This is unavoidable for any browser-only tool calling a third-party API directly.
- **Set a spending cap in the Anthropic console.** Even if a key leaks, it can only spend up to your cap before being shut off.

**Hardening already in place:**

- 10,000-character input cap prevents runaway API costs from accidental long inputs or speech-recognition loops.
- 60-second timeout on all API calls.
- Automatic retry once on transient errors (5xx, network blips, rate limits).
- Mutex prevents duplicate concurrent requests from rage-clicks.
- Input is HTML-escaped before rendering (XSS protection).
- Key format is validated before saving.
- Offline detection prevents pointless failed requests.

**If you want to revoke or rotate the key:** click "Reset Key" in the footer of Lapidary, or revoke the key directly in the Anthropic console.

---

## What's next — upgrading to a desktop app with global hotkey

The bookmarklet is the right starting point because it works everywhere you have a browser tab open. But it has real limits: it can't run over Microsoft Word, Notion desktop, your code editor, or anything outside a browser. Some sites with strict Content Security Policy (banks, certain Google properties) also refuse to load it.

The natural upgrade is a **small desktop app with a global hotkey** — press something like `Ctrl + Shift + Space` from anywhere in Windows, and the same Lapidary panel appears as a floating window over whatever you're doing. Dismiss with Esc, copy the prompt, you're back in your original app.

The two reasonable ways to build this:

- **Tauri** (Rust + system webview): produces a ~5MB executable, very fast, low memory. Better long-term choice if I'm going to keep using it daily.
- **Electron** (Chromium): produces a larger executable (~80MB), but easier to build and lets me reuse most of the bookmarklet code directly.

Either way, the core JavaScript stays the same. The wrapper changes from "inject into any web page" to "render in a native window with global hotkey registration."

When I'm ready to upgrade: I'll fork the JS into a new repo with a desktop wrapper, keep this bookmarklet repo as-is for browser use, and document the migration. The bookmarklet stays useful as a fallback even after the desktop app exists.

---

## Limitations

- **Voice input only works in Chrome, Edge, Brave**, and other browsers that implement the Web Speech API. Safari and Firefox fall back to typing only.
- **Voice input requires HTTPS pages.** Mic access on `http://` pages is blocked by browsers. In practice everywhere you'd use this is HTTPS anyway.
- **Some sites block bookmarklets** via Content Security Policy. If you click the bookmark and nothing happens, that site has strict CSP and there's no workaround short of a desktop app or browser extension. Try the same bookmarklet on a different site to confirm it's working.
- **Speech recognition stops on its own after periods of silence.** Just click the mic button again to keep going.

---

## File structure

```
lapidary/
├── lapidary.js     # The whole app, single file, no dependencies
└── README.md       # You are here
```

That's the entire project. No build step, no package.json, no node_modules. Drop the JS file on GitHub Pages, point a bookmarklet at it, done.

---

## Built with

- Plain JavaScript, no frameworks
- The [Anthropic API](https://docs.claude.com/) (Claude Sonnet 4 for internal analysis and prompt synthesis)
- The Web Speech API for voice input
- GitHub Pages for static hosting
- Built in collaboration with Claude

---

## License

Lapidary is shared under the MIT license. It's a personal tool I built for myself and decided to put online in case it's useful to others. If you fork it, improve it, or build something with it — that's the whole point. If you make money off it somehow, that's also fine, just keep my name on the copy. If something breaks, you're on your own.
