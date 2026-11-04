# Charmly

**Better replies, in your own voice.**

Charmly is a Chrome extension for WhatsApp Web, and for any other messaging site in Chrome through one shortcut. When a new message arrives in the chat you have open, it reads the conversation, gets the vibe, and suggests three replies that sound like *you*: warm, playful, direct, or flirty if you've opted in. Tap one and it goes into your message box. You edit it or press Enter yourself. **Charmly never sends anything.**

<p align="center"><a href="docs/charmly-promo.mp4"><img src="docs/demo-blink.gif" width="92%" alt="Charmly in 30 seconds: the hook, the vibe, three replies, tones, polish, presets" /></a><br />
<sub><b><a href="docs/charmly-promo.mp4">▶ Watch the film</a></b> (81 seconds, with sound): every feature, cut on the beat, with a slower Steer section. Then <b><a href="docs/charmly-steer-film.mp4">the Steer story</a></b> (97 seconds), a date night in four messages. Every suggestion in both is real output from the on-device model. <a href="#the-films-made-in-code">How they were made</a>.</sub></p>

![Charmly reads the vibe and suggests three replies, in your voice](docs/demo-suggestions.gif)

## The experience

- **It just appears.** A new incoming message triggers suggestions automatically after a short pause (people often send several messages in a row). They stream in one by one, so the first option shows almost immediately.
- **A read of the vibe.** "excited · sharing news · English + Tamil". If the other person seems tired or wants space, Charmly says so, keeps every option gentle and switches flirty off.
- **Your voice, learnt locally.** Charmly builds a small style profile from your own sent messages: typical length, emoji habits, lowercase or not, your "haha"s and "da"s. Only that summary is kept, it's visible in the popup, and you can clear it with one click.
- **Tones on tap.** Warm, Playful, Direct, and Flirty (opt-in) chips change which kind of reply leads. Charmly names the three tones to write, in order, so the one you tap always comes first, and in flirt mode a flirty option stays in the mix.
- **Steer toward what you want to say.** Some things are better reached than blurted: asking someone out, asking for money back, telling a friend you're moving. Set a goal and a pace (3, 4 or 5 exchanges), and Charmly drives the chat there slowly: one step per back-and-forth, and it only says it on the last step. [More below](#steer).
- **Polish my draft.** Start typing your own reply, whether the tray is tucked away or showing suggestions, and Charmly offers to polish it in your voice.
- **Keyboard first.** `Alt+1/2/3` inserts a suggestion, `Alt+R` regenerates, `Alt+P` polishes your draft, `Esc` tucks the tray away. Hold `Alt` on its own to peek: the tray fades away so you can read the chat behind it.
- **One chip for everything about a chat.** The tray has one line of context: the vibe, plus a chip summing up this chat's setup ("😎 Friends · 💻 llama3.2:3b"). The chip opens a single sheet with the voice preset, the goal, a note and the engine. A thin goal strip shows only while you're steering.
- **Voice presets.** Tell Charmly who you are and how you talk in each kind of chat: what to always do, what never to do, and words it must never use. Four editable starters ship (😎 Friends, 💼 Work, 🏡 Family, 💫 Dating), and you can add your own. Switch presets from the tray's sheet, which also holds a note for the chat ("my manager: keep it brief"). Charmly remembers both per chat.
- **Three engines, switchable in the chat.** The sheet lists your installed local models, plus Claude and Demo. **On-device** runs a small model on your laptop through [Ollama](https://ollama.com), so your chats never leave the machine. **Claude** gives the best quality with your Anthropic key. **Demo** lets you try the experience with built-in samples.
- **Out of your way.** At rest Charmly is a small breathing dot at the right end of the message box, where your own messages sit, so the message you're answering stays in view. Hover the dot and it opens into the full bar. Click it for replies. Drag it anywhere, and Charmly remembers the spot for that site; double-click to reset. A pip on the dot means you have a draft to polish, and a ring fills with your Steer progress. When suggestions open, they dock on the right too, and × collapses them back to the dot.
- **Clear glass, not a wall.** The tray is see-through glass: a 1px blur, a thin tint and a highlight edge, so the messages behind it stay readable. It firms up a little while your pointer is over it. It follows the page's light or dark theme, measured from the page itself rather than the system setting.

<p align="center"><img src="docs/suggestions-dark.jpg" width="68%" alt="Dark theme" /> &nbsp; <img src="docs/popup.png" width="24%" alt="The popup: switches, tone, API key, demo mode, your voice" /></p>

## Beyond WhatsApp

![Charmly on a Messenger-style chat it has no special support for, opened with the shortcut](docs/demo-anywhere.gif)

Charmly works wherever you write messages in Chrome: Telegram, Messenger, Instagram, LinkedIn, Slack, Discord, Google Chat, or a site it has never seen.

- **Press ⌥⇧C (Alt+Shift+C) in any message box.** Chrome lets Charmly into that tab for that moment, so no site permission is needed. It reads the conversation and suggests replies. With nothing to reply to, it polishes your draft. You can change the key at `chrome://extensions/shortcuts`.
- **Select a message to reply to just that.** On any page, select someone's message and the pill offers **Reply to selected text**, handy for email threads, forums and comment boxes.
- **Always on this site.** For a messenger you live in, switch it on from the popup. Chrome asks once, for that site only. Charmly then suggests replies by itself when messages arrive, the same as on WhatsApp. The presets page lists these sites, each with a **Turn off** button.
- **Out of the way.** On other sites the pill only shows while you're in a message box, and Alt shortcuts only apply while the tray is open, so the site's own keys keep working.

**How it reads a page it doesn't know.** Most messengers draw your messages on the right and theirs on the left, so the generic reader works from layout, not markup:
1. It probes the point just above your message box to find the scrolling conversation (`elementsFromPoint`, cheap even on huge apps).
2. It groups the text into bubbles: the widest box around each piece of text that is still clearly narrower than the conversation.
3. It reads each bubble's side.

On layouts where everyone is on the left (Slack, Discord), each row is a message and all count as theirs. Names, times, dates and "Seen" are dropped. Popular sites also get **hints**, such as their message and "mine" selectors and the chat's title (see [`generic.ts`](extension/src/content/generic.ts)). When a hint misses after a redesign, the layout reader takes over. Charmly inserts the way a person types, so textareas, React inputs and rich editors (Lexical, Slate, Draft, Quill) keep their state.

The test pages cover three kinds of page: a Messenger-style chat with obfuscated class names, a Slack-style channel with names and times, and a LinkedIn-style thread using its hints. The hints for the real sites follow their published markup, which can change without notice.

## How it works

```mermaid
flowchart LR
    W["WhatsApp Web<br/>open chat"] -- "MutationObserver:<br/>new incoming message" --> C["Context reader<br/>last 12 messages<br/>names → Them / Me"]
    C --> P["Prompt<br/>chat + your style + tone"]
    S[("Your style<br/>computed locally")] --> P
    P -- "port" --> BG["Background worker<br/>(holds the API key)"]
    BG -- "one streamed call" --> CL[(Claude)]
    CL -- "VIBE line, then<br/>one line per reply" --> PR["Line parser"]
    PR --> SF{{"Safety filter<br/>deterministic"}}
    SF -- "on-tone, no pressure" --> T["Tray<br/>cards stream in"]
    SF -. "held back" .-> X(("dropped"))
    T -- "tap / Alt+1" --> CB["Message box<br/>you press Enter"]
```

**Context → tone → writer, in one call.** The Lab card describes a three-step chain. Here it runs as a single streamed request, so the latency is one round trip. Claude first writes a `VIBE|mood|intent|language|boundary` line, then one `n|tone|reply|why` line per option. The parser emits each record as soon as its line completes, so the vibe and the first card appear while the rest are still being written.

**The safety filter is code, not a prompt.** Every suggestion passes a deterministic check before it can be shown:
- it drops pressure and coercion ("or else", "you owe me", "you have to reply"). Banter and swearing are left to you: these are your own chats, and the replies match how the chat already talks
- it drops invented phone numbers, emails and addresses
- it drops anything that breaks character ("As an AI")
- it drops flirty options unless you opted in, and always when the other person signals they want space
- in that case it also drops pushy phrasing ("come on", "just one")
- it normalises em dashes to hyphens

The tray tells you how many options it held back.

**Isolated from WhatsApp.** The tray renders in a shadow root, so neither side's CSS leaks into the other. Everything Charmly knows about WhatsApp's markup lives in one adapter, [`src/content/whatsapp.ts`](extension/src/content/whatsapp.ts):

| What it reads | Hook |
|---|---|
| Messages | `[data-pre-plain-text]` |
| Direction | `.message-in` / `.message-out` |
| Emoji | image `alt` text |
| Message box | the footer's contenteditable |

The adapter includes a health check the popup shows, so if WhatsApp changes its page you see "Can't find the message box" instead of silence.

**Inserting text the way a person would.** WhatsApp's editor keeps its own state, so writing to the DOM directly doesn't stick. Charmly selects the box's content and uses the editor's own input path (`insertText`), with a synthetic paste as a fallback.

## Voice presets

![The preset editor](docs/presets.jpg)

Each preset is your voice for one kind of chat:
- **About you & how you talk:** free text in your own words, the strongest guidance.
- **Always** and **Never:** rules, with one-tap quick rules for the common ones ("Never agree to plans, money or times on my behalf").
- **Never use these words:** enforced in code by the safety filter, so a suggestion containing one is dropped whatever the model writes.

The editor shows exactly what Charmly adds to each request. A chat uses the preset you picked for it in the tray, or your default. The preset and any chat note reach Claude, the on-device model and the filter alike. Chat names, presets and notes are stored only in your browser.

## Steer

![Steer: from a party follow-up to a date night, in four natural messages](docs/demo-steer.gif)

A goal is a quiet instruction for one chat, like "ask her out for a date night", reached **slowly**. In the film the four steps go like this:
1. **Common ground.** "How's your week going so far? Any fun plans?"
2. **Bridge.** "…What made you discover that place? Are they serving any good pasta?"
3. **Test the water.** "oh no, a night off sounds like just what you need"
4. **Say it.** "I'd love to take you out and help you unwind. Are you free this weekend?"

Then Maya: "yes!! friday? 🥰". [Watch the whole story](docs/charmly-steer-film.mp4) (97 seconds, with sound). The plan is in code, not left to the model:

| Pace | Steps, one per back-and-forth |
|---|---|
| Quick · 3 | find common ground → bridge to the topic → say it |
| Natural · 4 | find common ground → bridge to the topic → test the water → say it |
| Slow · 5 | build rapport → find common ground → bridge to the topic → test the water → say it |

- **Steps follow the conversation, not the history.** A new goal always starts at step 1, however long the chat already is. Your reply finishes a step; their answer starts the next. Several messages in a row count once.
- **The ask is held back, twice.** Each request names the current step and tells the model that no option may say it before the last step. Code backs that up: before the last step, an option that makes the ask (an invitation like "want to / can we / if you're free" with the goal's topic) is held back, unless they opened the door themselves. On the last step, all three options say it, in different ways.
- **The strip in the tray** shows the plan as bars, where you are ("step 2 of 4 · bridge to the topic, not saying it yet"), and "step 2 done, next when they reply" after you send. Once the tray is tucked away, the pill keeps a small "🎯 2/4" chip.
- **You stay in charge.** **Skip ›** moves on by hand. If they bring the topic up themselves ("need a coffee so badly"), the strip offers **Say it now ›**. If they seem to want space, the plan pauses and holds its step. After you've said it, **Done ✓** ends the goal, or **Keep going** keeps steering.
- **Honest by design.** The prompt rules out tricks, false pretexts, guilt and pressure.

Claude gets the whole plan and reports whether they've opened the door themselves (a `GOAL|yes/no|note` line). The on-device model gets a two-line version of the current step, which small models follow more reliably, and Charmly spots the door-opening itself. Goals and their steps are stored per chat in your browser.

<p align="center"><img src="docs/sheet.jpg" width="80%" alt="The sheet: voice, goal and pace, note, engine" /></p>

## On-device with Ollama

```bash
brew install ollama          # or download it from ollama.com
ollama serve                 # if the app isn't already running
ollama pull llama3.2:3b      # about 2 GB; quick on an M1, natural for chat
```

In Charmly's popup choose **On-device**. It lists the models you've pulled, picks the smallest, and **Test model** shows a real reply and how long it took. On an M1 with 16 GB, `llama3.2:3b` puts the first suggestion on screen in about a second and all three in about three, once the model is warm. Charmly keeps it loaded between messages.

Small models need more help than Claude, so the on-device path is tuned for them:

- **A shorter prompt with one worked example.** Small models copy an example far more reliably than they follow rules.
- **A forgiving parser.** It handles what models actually emit: echoed templates (`1|tone|reply|why`), un-numbered `Warm: …` lines, a vibe written as a numbered line, `**bold**` numbering, and a tone on one line with the reply on the next, extra label fields, `<think>` blocks from reasoning models (stripped even when the tags are split across stream chunks). It stops at three options, and if nothing parses it salvages plain lines.
- **A local safety floor.** Small models often skip the vibe line, so Charmly reads the last message itself, instantly. If either that read or the model sees the other person pulling back, flirty and pushy options stay off. The same floor applies to Claude.
- **No setup surprises.** By default Ollama rejects chat requests from browser extensions, so they'd fail unless you restart it with `OLLAMA_ORIGINS`. Instead, Charmly adds a `declarativeNetRequest` rule that removes the `Origin` header only on requests Charmly itself sends to localhost (`initiatorDomains` is Charmly's own ID, so no web page can use it). Ollama then treats them like a local `curl`.

## Privacy and safety

- Reads only the chat you have open, and only while Charmly is on. Outside WhatsApp, only in a tab where you pressed the shortcut or on a site you switched on.
- **On-device:** the chat is read and answered on your laptop. Nothing leaves it.
- **Claude:** the last 12 messages, labelled `Them` and `Me` with no names or numbers, go to Anthropic's API using **your** key. The key lives in the extension's local storage and is only used by its background worker.
- There is no Charmly server.
- Never sends a message, never clicks anything, never acts on your account.
- **Demo mode** works with no key at all, using built-in sample suggestions.
- Charmly is an independent project, not affiliated with WhatsApp or Meta. WhatsApp Web's page can change without notice, and the adapter is built to fail visibly when it does.

## Install

```bash
cd extension
pnpm install
pnpm build          # → extension/dist
```

Then open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and select `extension/dist`. Open web.whatsapp.com, click the Charmly icon, and pick an engine: **On-device** (see below), **Claude** (paste an Anthropic API key and **Save & test**), or **Demo**.

## Tests

```bash
pnpm typecheck && pnpm test   # adapter, stream parser (incl. small-model output), safety filter, voice profile, Ollama client
pnpm e2e                      # the real extension in Chrome, on a local chat page
```

`fixtures/chat.html` reproduces just the WhatsApp Web hooks Charmly reads. The other fixtures are the pages described under [Beyond WhatsApp](#beyond-whatsapp). The end-to-end run loads the built extension into Chrome through puppeteer, simulates incoming messages, and checks the experience:

```
  ✓ docks as a small pill above the message box
  ✓ credits Balaji Sri Raj in the tray
  ✓ streams three suggestions (3)
  ✓ reads the vibe: "excited · sharing news"
  ✓ matches the chat's light theme
  ✓ tapping a card inserts it into the message box
  ✓ nothing is sent automatically
  ✓ confirms the insert and hands control back
  ✓ Alt+2 inserts the second option
  ✓ holding Alt peeks through the tray
  ✓ letting go brings it back
  ✓ Escape tucks the tray away
  ✓ offers to polish the draft you have
  ✓ notices they may want space
  ✓ keeps every option gentle (warm, playful, direct)
  ✓ tone chips change the lead option (playful)
  ✓ follows the dark theme
  ✓ flirt mode: Warm leads and stays selected (warm, chip ☀️ Warm)
  ✓ flirt mode: Direct leads and stays selected (direct, chip ➜ Direct)
  ✓ flirt mode: Flirty leads and stays selected (flirty, chip 💫 Flirty)
  ✓ typing while suggestions are open offers Polish
  ✓ polishes that draft, then hides the offer
  ✓ one sheet holds voice, goal, note and engine
  ✓ goal pace: Quick, Natural or Slow, Natural by default
  ✓ an example fills the goal
  ✓ starts at step 1 of 4 even in a chat with history ("step 1 of 4 · find common ground, not saying it yet")
  ✓ holds the ask back
  ✓ no suggestion says it on step 1
  ✓ after you reply, the pill shows "1/4 · waiting for them"
  ✓ two messages in a row still count as one step
  ✓ suggestions take step 2
  ✓ drives the chat step by step: find common ground → bridge to the topic → test the water → say it
  ✓ only the last step says it
  ✓ after you send it, the goal shows as said
  ✓ Stop ends steering
  ✓ Quick pace plans three steps
  ✓ they mention it first: offers 'Say it now' ("they brought it up themselves")
  ✓ Say it now jumps to the last step
  ✓ pauses when they want space ("paused, they may want space")
  ✓ and holds the step
  ✓ Skip › moves on by hand
  ✓ another chat has no goal
  ✓ the goal and its step are remembered for this chat (2/4)
  ✓ lists local models (tiny:1b)
  ✓ the sheet lists the starter presets
  ✓ the chat now shows the Work preset
  ✓ on-device engine streams suggestions
  ✓ on-device replies (2): "recharge mode activated 🔋 talk tomorrow?" · "all good, message me whenever"
  ✓ the tray shows the on-device model (💼 Work · 💻 tiny:1b · ✎ ▾)
  ✓ keeps the space-aware read on-device
  ✓ sent a streaming chat request to Ollama
  ✓ the Work preset's rules reach the model
  ✓ the chat note reaches the model
  ✓ the goal's current step reaches the on-device model
  ✓ a word blocked in the preset is never shown
  ✓ preset and note are remembered for this chat
  ✓ the engine menu lists local models (tiny:1b)
  ✓ switches to Demo from the tray
  ✓ and back to the local model
  ✓ on other sites, stays out of the way until you're in a message box
  ✓ docks above the box you click into
  ✓ reads a bubble chat from its layout, sides and all ("Them: hey! it was so fun meeting you at Arun's party 😊\nMe: haha same, your karaoke was legendary\nThem: omg don't remind me 🙈 what are you up to this week?\nThem: we should totally do karaoke again 😂 are you free friday?")
  ✓ suggests replies automatically on a new message (3)
  ✓ inserts into the site's rich-text box
  ✓ reads a channel without names or times ("Them: anyone up for a hike on Saturday?\nThem: I'm in if it's not too early 😅\nThem: 8am start, coffee on the way, promise\nThem: does 8 work for everyone?")
  ✓ inserts into a plain textarea
  ✓ offers to reply to text you select
  ✓ answers just the selection ("Them: 8am start, coffee on the way, promise")
  ✓ site hints read LinkedIn's thread ("Them: Hi Balaji, loved your talk on agent design last week!\nMe: Thank you Ananya, glad it was useful\nThem: We're hiring for an AI lead role, would you be open to a chat?\nThem: Would Thursday at 4 work for a quick call?")
  ✓ knows it's on LinkedIn (LinkedIn, 4 messages)
  ✓ isn't on sites you haven't switched on
  ✓ the shortcut loads Charmly into the tab and asks what to reply to when it can't tell
  ✓ the shortcut replies to the selected message
  ✓ with nothing to reply to, the shortcut polishes your draft
  ✓ switches a site on
  ✓ and loads there by itself
  ✓ switching it off stops it
  ✓ ships the ⌥⇧C shortcut
```

By default the on-device checks run against a stand-in that speaks Ollama's API and answers in a deliberately messy small-model format, so CI covers them. `OLLAMA_E2E=http://localhost:11434 OLLAMA_MODEL=llama3.2:3b pnpm e2e` runs them against a real model, which also passes.

## The films, made in code

There are two films:
- **The promo** ([`promo/blink.ts`](extension/promo/blink.ts)) shows every feature, cut on the beat at 120 bpm: kinetic type, then punch-ins on the real tray.
- **The Steer story** ([`promo/film.ts`](extension/promo/film.ts)) is a calm walk through a date-night goal.

Neither is a screen recording. Both are rendered from code, frame by frame, in two passes:

1. **Capture** ([`promo/capture.mjs`](extension/promo/capture.mjs), and [`capture-extras.mjs`](extension/promo/capture-extras.mjs) for the Polish, Work-preset and back-off takes) drives the real extension in Chrome with the real on-device model (`llama3.2:3b`), through the real UI: it opens the sheet, sets the goal, inserts the chosen card and presses send. Maya's lines are written for the film. **Every suggestion is real output.** A director picks the take like an editor would: a natural, complete line, no ask before the last step, a real invitation on the last step. A weak take gets regenerated, as you would press ↻. The result is [`promo/script.json`](extension/promo/script.json).
2. **Render** ([`render.mjs`](extension/promo/render.mjs)) builds each film from that data. The tray on screen is **Charmly's actual `Tray` component**, bundled into the film page and fed the captured suggestions. A timeline of beats drives everything else, and `renderAt(t)` sets the page to exactly what frame `t` shows:
   - chat messages and typing indicators;
   - camera moves (eased zooms into the tray);
   - a cursor path with click ripples;
   - captions, title cards and key caps.

   Puppeteer steps through 2,900 frames at 30 fps, and ffmpeg encodes them. Text stays vector-sharp at any zoom, and motion never drops a frame.

Both scores are original, synthesised in plain Python and composed to each film's own markers.

The promo's score ([`music_upbeat.py`](extension/promo/music_upbeat.py)) is modern drums with a Japanese, reflective colour, at 120 bpm:
- **The groove:** a punchy kick and clap, hi-hat rolls, a deep 808 bass, and warm chords that breathe with the kick.
- **The Japanese colour:** taiko on the downbeats and fills, shime-daiko accents, a koto-style riff in the Yo pentatonic scale, and a breathy shakuhachi-style flute over the hook.
- **Steer:** the flute alone, then an accelerating taiko roll into the "Steer." drop. Steer's story runs half-time under big taiko hits.
- **Mastering:** normalised to -14 LUFS.

The Steer story's score ([`music.py`](extension/promo/music.py)) is quieter:
- warm pads in F major under the hook;
- a riser and bells on the reveal;
- a hushed breakdown for "the hardest messages to send";
- the beat returning with Steer, and a flourish when she says yes.

Making the film was also a test: the capture surfaced four small-model formatting bugs, all fixed in the product:
- a leaked "Me:" label;
- "Option 2" and tone labels;
- format records slipping through the fallback path;
- bare "yes" whys.

```bash
node promo/capture.mjs                  # needs Ollama; writes promo/script.json
node promo/capture-extras.mjs           # the extra takes for the promo
node promo/render.mjs                   # the promo → promo/out/charmly-blink.mp4, docs/charmly-promo.mp4
node promo/render.mjs --film film       # the Steer story → docs/charmly-steer-film.mp4 and the feature GIFs
node promo/render.mjs --preview 47      # one frame, for art direction
node promo/render.mjs --music track.mp3 # bring your own licensed track
```

## Layout

```
extension/
  src/content/     whatsapp.ts · generic.ts (any site, plus site hints) · insert.ts · tray.ts + tray.css (the UI) · index.ts (observer, keys, shortcut)
  src/background/  the only code that talks to a model (Claude, Ollama or demo)
  src/shared/      parse.ts · safety.ts · style.ts · prompt.ts · ollama.ts · demo.ts · types.ts
  src/popup/       engine, default preset, your voice, health
  src/options/     the voice-preset editor
  fixtures/        chat.html (WhatsApp-like) · bubbles.html · thread.html · linkedin.html · plain.html
  e2e/run.mjs      end-to-end checks and README screenshots
  promo/           the films: capture*.mjs (real model) · blink.ts + film.ts (the timelines) · film.html (the set) · render.mjs · music*.py
  build.mjs        esbuild → MV3 bundle; --dev also allows localhost for the test page
```

## Credit and licence

Charmly is designed and built by [Balaji Sri Raj](https://balajisriraj.com). The credit appears in the tray, the popup, the presets page, the extension's manifest and the top of every built file. You're welcome to read the code and run Charmly for yourself. Copies and forks must keep that credit visible and may not be used commercially without permission. See [LICENSE](LICENSE).

---

Part of [the Lab](https://balajisriraj.com/#lab), ten agentic products by [Balaji Sri Raj](https://balajisriraj.com).
