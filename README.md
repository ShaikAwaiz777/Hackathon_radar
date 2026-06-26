# 🛰️ Hackathon Radar

Daily Telegram alerts for **new Indian government / public hackathons**.
Scrapes Unstop, Devfolio, Smart India Hackathon, and MyGov once a day, and DMs you only the **new** ones (never repeats).

Runs free on GitHub Actions — no server needed.

---

## Setup (5 minutes)

### 1. Create your Telegram bot
- Message **@BotFather** → `/newbot` → copy the **token**.
- Message **@userinfobot** → copy your **chat ID**.
- Open your new bot and tap **Start** (so it can DM you).

### 2. Push this repo to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/shaik2501/hackathon-radar.git
git push -u origin main
```

### 3. Add your secrets
In the repo: **Settings → Secrets and variables → Actions → New repository secret**
- `BOT_TOKEN` = your bot token
- `CHAT_ID` = your chat ID

### 4. Test it
- Go to the **Actions** tab → **Hackathon Radar** → **Run workflow**.
- First run sends a "Radar is live" message + the current open hackathons.
- After that, it only pings you when something **new** appears.

It runs automatically every day at **9:00 AM IST**.

---

## Run locally (optional)
```bash
npm install
BOT_TOKEN=xxx CHAT_ID=yyy npm start
```

## Customize
- **Timing:** edit the cron in `.github/workflows/radar.yml`.
- **Add sources:** add a new `fromXyz()` function in `index.js` and include it in the `Promise.all([...])` in `main()`.
- **Keywords:** tweak the regex filters inside each source function to widen/narrow what counts as "government".

## Notes
- Portal HTML changes sometimes; if a source stops returning results, its scraping logic may need a small update. The script is built so one failing source never breaks the others.
- `seen.json` is auto-committed back to the repo so the dedup memory persists between runs.
