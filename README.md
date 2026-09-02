# squad-sniffer

**A pixel-art classroom that shows a Backend.AI GO agent squad at work.**

squad-sniffer draws the execution of a [Backend.AI GO](https://go.backend.ai/) agent squad as a classroom. The request is written on the blackboard, students (agents) pick up task cards and take them to their desks, raise a hand to call a senior when they are stuck, get graded, and hand the answer in. Every token the squad spends accumulates on the taximeter above the board. Walk up to a student and press `Space`, and that agent's own model answers in character about what it is doing.

It is a static web application with no build step and no packages to install. The only requirement is Python 3, whose standard library runs the local server and reverse proxy. Without a server the page plays a built-in scenario, so the classroom can be explored offline.

This repository is the source of the visualization used by [aigo-web](https://github.com/EunseokEthanYang/aigo-web), which embeds it as a git submodule. Korean documentation: [README.ko.md](README.ko.md) and the run guide [README_RUN.md](README_RUN.md).

## Key Features

### The Classroom

- One run is one class period: it occupies one row of the timetable. The request appears on the blackboard, the planner splits it into tasks, and the students who receive cards walk to their desks.
- A student who is stuck raises a hand and passes the card up the price tiers: junior (1×) → senior (2×) → teacher (3×). The teacher's desk is normally empty; the teacher walks in through the door only when called as the last resort.
- Finished work is stamped ○ (green) or ✗ (red), and the last card holder hands it in at the teacher's desk, where the bell rings.
- The timetable in the top-left corner lists the periods of the day; click a row to open the details of a past run.

### The Taximeter

- The meter above the board accumulates weighted tokens — tokens multiplied by the price tier of the model that spent them — so cost is visible while the answer is still being produced.
- The 1× / 2× / 3× lamps show which tier is working right now, and every student carries a pencil gauge of the tokens they have left.
- Budget warnings, budget exhaustion, and emergency stops are staged in the classroom (bell, emotes, everyone goes home) when the connected server reports them.

### Live Replay

- The live data source replays the event feed of a squad run — request, planning, plan, wave, task start, retry, task done, task failed, aggregate, done — in order, so the classroom tells the same story the engine actually executed even when the engine is faster than the animation.
- Runs that finished before the page was opened are not replayed; they only appear as ✓ or ✕ in the timetable. An idle squad shows an idle classroom.
- If a new run starts while one is being replayed, the rest of the old replay is dropped. A server without an event feed falls back to polling token totals.
- Press `T` (or click the request button) to send a request. On the live source the squad really runs it (`POST /execute`) and spends real tokens.

### Voices and Dialogue

- When a student finishes, a visual-novel dialogue box opens with the character's full-body portrait (the teacher and robot sets use their pixel sprite instead), name plate, and answer.
- Inside aigo-web with `LOCAL_TTS=1`, the answer is read aloud in the character's Korean voice (Supertonic 3 on the host). Otherwise nothing is spoken by default; add `?speak=1` to the URL to use the browser's own speech synthesis.
- Answers are read to the end (up to 1,500 characters; anything longer is cut with "… 이하 생략"). Long ones are split at sentence boundaries, students queue behind one another instead of cutting each other off, and only one page speaks a given answer even when several are open.
- Markdown, code blocks, formulas, and URLs are rewritten for reading ("code omitted", "link"), and failure reasons are spoken as short Korean sentences rather than raw error text.
- With `?voice=1` (which aigo-web's classroom view, `/studio/classroom`, sets for you) the page listens on load, submits what it hears as the request, and keeps the microphone off until the final answer has been read. Speech recognition needs Chrome or Edge on an `https` origin or `localhost`.

### Talking to Agents

- Stand next to a student and press `Space` (`E` and left `Shift` also work). The agent's model answers in character, with its role, current task, and token spend as context. The ⚙ menu switches between the visual-novel box and a plain web chat.

## Data Sources

The classroom reads a Backend.AI GO server through `backend/proxy.py`, which serves the static files and reverse-proxies the Management API under `/aigo/*` with the access key attached, so the browser never deals with CORS or credentials. POST requests (sending a request, talking to an agent) pass through as well.

| Source                                                     | Command                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| Local aigo-web container (`LOCAL_AGENTS=1 ./run-local.sh`) | `AIGO_BASE=http://127.0.0.1:1001 ./run.sh`                     |
| An aigo-web deployment                                     | `AIGO_BASE=https://your-server AIGO_KEY=gate-token ./run.sh`   |
| Headless `aigo-server`                                     | `AIGO_BASE=http://127.0.0.1:8001 AIGO_KEY=access-key ./run.sh` |
| No server — built-in scenario                              | `./run.sh 8790 mock`                                           |

| Variable         | Meaning                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIGO_BASE`      | Management API address. Empty means `http://127.0.0.1:8001`, where a headless `aigo-server` listens; if nothing answers there, only the built-in scenario is served. |
| `AIGO_KEY`       | Access key. An aigo-web deployment takes its gate token; a Backend.AI GO server takes an API key (`X-API-Key`).                                               |
| `AIGO_AUTH`      | `apikey`, `gate`, or `auto` (default: `apikey` for `127.0.0.1` and `localhost`, `gate` otherwise).                                                            |
| `AIGO_INFERENCE` | OpenAI-compatible inference address (`/v1`). Empty means `http://127.0.0.1:39080` when `AIGO_BASE` is `http://127.0.0.1:8001`, and `AIGO_BASE` otherwise.    |

### Desktop App Support

**The Backend.AI GO desktop app (1.12.1) is not a supported data source.** The app does not expose its Management API (`/api/v1/squads` and the rest, port 8001) outside the process: there is no switch in its settings, and creating an access key does not open it either — only the router on port 39080 listens. The code is ready for a release that does open that port: `./run.sh` auto-detects `127.0.0.1:8001` and authenticates with `X-API-Key`.

## Requirements

- Python 3.8 or later. Only the standard library is used; there is nothing to `pip install`.
- A Chromium-based browser or Safari for the classroom; Chrome or Edge for speech recognition.
- The web fonts are loaded from a CDN. Offline, the browser's default fonts are used.

## Running

| Platform            | How                                                                         |
| ------------------- | --------------------------------------------------------------------------- |
| macOS, Linux        | `./run.sh [port] [mock\|live]`, e.g. `./run.sh 8791 mock`                   |
| Windows             | Double-click `run.bat`, or `run.bat [port] [mock\|live]` from a terminal    |
| Windows, force mock | `run_mock.bat`                                                              |
| By hand             | `python backend/proxy.py 8790`, then open `http://127.0.0.1:8790/index.html` |

The default port is 8790, and the browser opens on its own. If the port is already taken, `run.sh` shows which process (or Docker container) owns it and asks whether to stop it, use another port, or quit — it never kills anything on its own. On Windows pass another port as the first argument instead. Port 8765 is deliberately not used; it has collided with other apps before.

## Controls

| Key       | Action                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `← ↑ ↓ →` | Move your character. WASD and gamepad can be enabled under `controls` in `js/config.js`.                  |
| `Space`   | Talk to the nearest agent. `E` and left `Shift` do the same.                                              |
| `T`       | Send a request. On the mock source this replays the built-in scenario; on the live source the squad runs. |
| `N`       | Nerd mode: budget burn-down and the raw trace.                                                            |
| `M`       | Bell on or off.                                                                                           |
| `Esc`     | Close the current overlay.                                                                                |

The ⚙ menu holds the dialogue style (visual novel or web chat), nerd mode, the timetable, the bell, name tags (auto, always, hidden), the theme (light, default, draft), and the **squad selector**, which remembers the squad you pick from the live list.

### Reading the Screen

- **TAXIMETER** at the top: weighted tokens spent by the squad; the lit lamp is the tier working now.
- Blackboard: the current request. The card above a character is the task it holds; the speech bubble is what it is doing.
- The pencil gauge under a student is the tokens it has left.
- Timetable, top-left: which period is in progress; click a row for details.
- Chip, top-right: `● MOCK · built-in scenario` or `● LIVE · <squad name>`; click it to switch sources.

### URL Parameters

| Parameter                   | Effect                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `?source=mock\|live`        | Force a data source.                                                                        |
| `?squad=<id>`               | Select a squad on the live source.                                                          |
| `?voice=1` / `?voice=0`     | Turn the hands-free microphone loop on or off.                                              |
| `?speak=1`                  | Read answers with the browser's speech synthesis when no server voice is available.         |
| `?chat=vn\|web`             | Open the first agent's dialogue immediately in the given style (for captures).              |
| `?theme=light\|default\|draft` | Pick a theme.                                                                            |
| `?nerd=1`                   | Start in nerd mode.                                                                         |
| `?fit=fill\|cover\|contain` | How the classroom fits the window.                                                          |
| `?skipIntro=1`              | Skip the intro overlay. Only relevant when `theme.intro` is set to `true`; it is off by default. |

## Configuration

Everything lives in `js/config.js`: the price tiers (`rates`), role labels (`roleLabels`), character assignment (`characters`), voices and presets (`voice`), movement keys (`controls`), and the walkable map (`world.walkable`). The bottom notices and verdict cards are off by default; set `theme.annotations` and `theme.verdictCards` to `true` to bring them back. The translation from engine events to classroom staging lives in `js/data/live.js`.

## Inside aigo-web

[aigo-web](https://github.com/EunseokEthanYang/aigo-web) includes this repository as a submodule and runs `./sync-viz.sh` to produce `viz/`, which the container serves from the same origin under `/_viz/` and `/studio`. No proxy is needed there. This repository is the source of truth: commit here first, run `./sync-viz.sh` in aigo-web, then commit `viz/` together with the submodule pointer.

## Repository Layout

| Path                                          | Role                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `index.html`, `css/`                          | The page and its themes                                                       |
| `js/main.js`                                  | Bootstrap: source selection, hotkeys, URL parameters                          |
| `js/config.js`                                | All settings: squads, themes, characters, voices, price tiers                 |
| `js/engine/`                                  | Canvas world, director (staging), UI overlays, voice loop                     |
| `js/data/`                                    | Data sources: `live.js` (replays engine events), `mock.js` (built-in scenario) |
| `backend/aigo_client.js`, `backend/aigo_state.js` | Browser-side API client and state normalisation used by `live.js`         |
| `backend/proxy.py`                            | Local static server and Backend.AI GO reverse proxy                           |
| `backend/portguard.sh`                        | The port check used by `run.sh`                                               |
| `run.sh`, `run.bat`, `run_mock.bat`           | Launchers                                                                     |
| `assets/`                                     | Character sprites and portraits, the classroom background                     |
| `docs/HANDOFF.md`                             | Hand-over document: design, rules, verification history (Korean)              |
| `docs/architecture.md`                        | Module structure (Korean)                                                     |
| `docs/data-catalog.md`                        | What the Backend.AI GO server exposes and how the classroom uses it (Korean)  |
| `tools/voice-test.js`                         | Regression test for the voice loop                                            |

## Testing

```bash
node tools/voice-test.js
```

The voice state machine — listen, ask, solve, read back, listen again — plus the speech queue, sentence chunking, and the microphone hold during a run are exercised without a browser.

## Upstream and Credits

This project visualizes [Backend.AI GO](https://github.com/lablup/backend.ai-go-releases), developed and maintained by [Lablup Inc.](https://www.lablup.com) The classroom talks to its Management API and inference router and does not modify them.

| Component                                                        | Provided by                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| [Backend.AI GO](https://github.com/lablup/backend.ai-go-releases) server, squads, and Management API | [Lablup Inc.](https://github.com/lablup) |
| Korean character voices (via aigo-web, `LOCAL_TTS=1`)            | [Supertonic 3](https://github.com/supertone-inc/supertonic), MIT |
| Classroom, characters, staging engine, and proxy                 | This repository (Team Sannabi)                              |

Built for the Junction Asia Hackathon on the Lablup × FuriosaAI track.
