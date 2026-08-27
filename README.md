# 💍 Quiglash — Megan's Bachelorette Party Game

A Quiplash-meets-Cards-Against-Humanity party game for one big screen and everybody's phones.
Questions are yours to write, the bride is the judge, and the funniest answer wins.

```
Big screen (TV/laptop)          Phones
┌───────────────────────┐       ┌──────────┐
│  QR code + room code  │◄──────│  join    │
│  question             │       │  type    │
│  answers (after all   │       │  answer  │
│  phones are in)       │       └──────────┘
│  Megan picks a winner │
└───────────────────────┘
```

## Run it

```bash
npm install
npm start
```

The terminal prints three links:

```
📺  Big screen : http://192.168.0.93:3000/host
📱  Players    : http://192.168.0.93:3000/
✏️  Editor     : http://192.168.0.93:3000/edit
```

Open the **big screen** link on the TV (or a laptop plugged into it) and everything else follows the QR code.
Everyone's phones must be on the **same Wi‑Fi** as the laptop running the game.

## Party night, step by step

1. **Big screen** → open `/host`. It shows a QR code and a four-letter room code.
2. **Everyone scans it** (or types the code at the players link), picks a name, and lands in the lobby.
3. **Megan is crowned automatically** if she types her name as `Megan`. Otherwise tap any name on the
   big screen to give her the crown. The judge doesn't write answers — she picks winners.
4. **Start the games.** The question appears on the screen; every other phone gets a text box.
5. **Answers stay hidden** until every phone has submitted. (Impatient? *Don't wait — show answers*.)
6. **Reveal them one at a time** so Megan can read each one aloud, or hit *Reveal all*.
7. **Megan awards points** — tap an answer right on the big screen, or use her phone.
   Best answer +1000, runner-up +500 (both configurable, runner-up can be skipped or turned off).
8. **Next question**, and so on. After the last one: podium, confetti-petals, and a winner.

**Shortcut:** on the big screen, `Space` / `→` does the obvious next thing — start, reveal, next question.

## Writing your own questions

Open **`/edit`** in a browser (or the *Edit questions* button in the lobby). You can:

- write, reorder, and delete questions
- attach a **photo or video** to any question — it shows on the big screen *and* on everyone's phone

  Videos play **with sound** on the big screen, once through, with **Replay** and a sound toggle
  underneath. If the browser blocks the audio (it only does that before anyone has clicked on the
  page) the clip still plays and the button says *Tap for sound*. Once the question has been asked
  the clip shrinks to a thumbnail so the answers get the screen.
- change the party settings: bride's name, location, tagline, hashtag, point values, answer timer,
  how many questions per game, whether the judge also answers

Hit **Save**. Changes apply to the next game you start (or hit *Play again* on the big screen).

Two tokens fill themselves in anywhere in a question, so the same bank works for any bride:

| Token | Becomes |
| --- | --- |
| `{bride}` | Megan |
| `{location}` | North Carolina |

> `If {bride} were stranded on a desert island…` → *If Megan were stranded on a desert island…*

Questions and settings live in [data/questions.json](data/questions.json) and
[data/config.json](data/config.json) if you'd rather edit the files directly. Uploaded media lands in
`public/assets/`.

## Settings reference

| Setting | Default | What it does |
| --- | --- | --- |
| `brideName` | Megan | Fills `{bride}`, and auto-crowns her as judge on name match |
| `location` | North Carolina | Fills `{location}` |
| `tagline` | Megan's Last Fling in the Carolina Hills | Subtitle on the big screen |
| `pointsForBest` / `pointsForRunnerUp` | 1000 / 500 | Points awarded |
| `enableRunnerUp` | true | Ask the judge for a second-place answer too |
| `judgeAnswersToo` | false | Let the bride write answers as well as judge |
| `answerTimeLimitSeconds` | 0 | 0 = no timer; otherwise a countdown on the big screen |
| `maxAnswerLength` | 180 | Characters per answer |
| `questionsPerGame` | 0 | 0 = use them all |
| `shuffleQuestions` | false | Randomize the order each game |

## Put it online (free, no laptop at the party)

The game is deployed from a Git repo — [render.yaml](render.yaml) is already set up for
[Render's](https://render.com) free plan. No credit card, no domain needed; you get a URL like
`https://quiglash.onrender.com`.

**One time, to get it live:**

1. Create an empty repo at [github.com/new](https://github.com/new) — call it `quiglash`, keep it
   public, and **don't** add a README or .gitignore (this folder already has them).
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/quiglash.git
   git push -u origin main
   ```
3. Go to [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints) → **New Blueprint
   Instance** → connect GitHub → pick the `quiglash` repo → **Apply**.
   Render reads `render.yaml` and does the rest. First build takes about two minutes.
4. Open `https://your-app.onrender.com/host` on the TV. The QR code automatically points at the
   public URL — there is nothing to configure.

**Afterwards, to change questions:** edit them locally (`npm start` → `/edit`), then

```bash
git add -A && git commit -m "new questions" && git push
```

Render redeploys in a couple of minutes.

### Two things to know about the free plan

- **It falls asleep** after 15 minutes with nobody connected, and takes ~50 seconds to wake up.
  Open the big screen **a few minutes before the party** and leave that tab open — as long as it's
  open, the game stays awake. If it does sleep mid-game, the room is lost and you start a new one.
- **The hosted filesystem resets** on every restart. Questions and media edited *on the live site*
  are temporary; anything committed to the repo is permanent. The `/edit` page on the hosted copy
  says so, and has an **Export** button:

  ```bash
  npm run restore -- ~/Downloads/quiglash-backup.json   # writes data/*.json
  git add -A && git commit -m "questions from the live editor" && git push
  ```

### Other hosts

It's a plain Node app: `npm start`, reads `PORT`, no database. Fly.io, Railway, or anything similar
works with no changes. It must run as a **single instance** — rooms live in memory, so a second
instance would put your phones in different games.

### Just testing from another house?

If the laptop *is* running, `npx ngrok http 3000` (or `cloudflared tunnel --url http://localhost:3000`)
gives you a temporary public URL, and the QR code follows it automatically.

## Good to know

- **Phones can reconnect.** Refresh, lock the screen, or wander off — rejoining with the same name in
  the same room gives you your seat and your score back.
- **Two screens?** Open `/host?code=ABCD` anywhere to mirror the big screen.
- **Pre-filled invite links:** `http://.../?code=ABCD&name=Ashley` drops someone straight into the game.
- **The game lives in memory.** Restarting the server ends the game, so don't restart mid-party.
- **Everything is committed on purpose** — questions, settings, and uploaded media — because hosted
  free tiers wipe anything that isn't in the repo.
- `npm test` plays a whole 24-question game with fake phones and checks the rules hold.

## Layout

| Path | What |
| --- | --- |
| [server.js](server.js) | Game engine — rooms, phases, scoring, QR generation |
| [data/questions.json](data/questions.json) | The question bank |
| [data/config.json](data/config.json) | Party settings |
| [public/host.html](public/host.html) · [public/js/host.js](public/js/host.js) | Big screen |
| [public/index.html](public/index.html) · [public/js/player.js](public/js/player.js) | Phones |
| [public/edit.html](public/edit.html) · [public/js/edit.js](public/js/edit.js) | Question editor |
| [public/css/style.css](public/css/style.css) | The whole bridal theme |
| [test/flow-test.js](test/flow-test.js) | End-to-end smoke test |
| [render.yaml](render.yaml) | Free-plan deploy config |
| [scripts/restore.js](scripts/restore.js) | Pull an exported backup back into the repo |
