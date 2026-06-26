// Hackathon Radar — scrapes Indian government / public hackathon portals
// and DMs you on Telegram when a NEW one appears.
//
// Sources: Unstop, Devfolio, Smart India Hackathon, MyGov.
// Dedup: keeps a seen.json so you only ever get alerted ONCE per hackathon.

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SEEN_FILE = "seen.json";

// ---------- helpers ----------

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...opts.headers }, ...opts });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function getHTML(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...set], null, 2));
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    console.error("Telegram error:", await res.text());
  }
}

// ---------- sources ----------
// Each source returns an array of { id, title, link, meta }

// 1. Unstop — public API, filter for government/public hackathons
async function fromUnstop() {
  const url =
    "https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=1&per_page=30&oppstatus=open";
  try {
    const data = await getJSON(url);
    const list = data?.data?.data || [];
    return list
      .filter((o) => {
        const text = `${o.title} ${o.organisation?.name || ""}`.toLowerCase();
        return /gov|government|ministry|smart india|govt|public|nic|digital india|startup india/.test(
          text
        );
      })
      .map((o) => ({
        id: `unstop-${o.id}`,
        title: o.title,
        link: `https://unstop.com/${o.public_url || "hackathons/" + o.seo_url}`,
        meta: `${o.organisation?.name || ""} · ${o.region || ""}`.trim(),
      }));
  } catch (e) {
    console.error("Unstop failed:", e.message);
    return [];
  }
}

// 2. Devfolio — public hackathon listing API
async function fromDevfolio() {
  const url = "https://api.devfolio.co/api/search/hackathons";
  try {
    const data = await getJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "all", from: 0, size: 30 }),
    });
    const hits = data?.hits?.hits || [];
    return hits
      .map((h) => h._source)
      .filter((s) => {
        const text = `${s.name} ${s.tagline || ""} ${s.desc || ""}`.toLowerCase();
        return /gov|government|ministry|smart india|govt|public sector|india/.test(text);
      })
      .map((s) => ({
        id: `devfolio-${s.slug}`,
        title: s.name,
        link: `https://${s.slug}.devfolio.co`,
        meta: s.tagline || "",
      }));
  } catch (e) {
    console.error("Devfolio failed:", e.message);
    return [];
  }
}

// 3. Smart India Hackathon — scrape homepage announcements
async function fromSIH() {
  try {
    const html = await getHTML("https://www.sih.gov.in/");
    const $ = cheerio.load(html);
    const items = [];
    $("a").each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href") || "";
      if (
        title.length > 15 &&
        /hackathon|edition|register|problem statement|sih \d{4}/i.test(title)
      ) {
        items.push({
          id: `sih-${Buffer.from(title).toString("base64").slice(0, 16)}`,
          title,
          link: href.startsWith("http") ? href : `https://www.sih.gov.in/${href}`,
          meta: "Smart India Hackathon",
        });
      }
    });
    return items.slice(0, 10);
  } catch (e) {
    console.error("SIH failed:", e.message);
    return [];
  }
}

// 4. MyGov — scrape the "Tasks / Innovate" hackathon listings
async function fromMyGov() {
  try {
    const html = await getHTML("https://www.mygov.in/task/");
    const $ = cheerio.load(html);
    const items = [];
    $("a").each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href") || "";
      if (title.length > 15 && /hackathon|challenge|innovation|contest/i.test(title)) {
        items.push({
          id: `mygov-${Buffer.from(title).toString("base64").slice(0, 16)}`,
          title,
          link: href.startsWith("http") ? href : `https://www.mygov.in${href}`,
          meta: "MyGov",
        });
      }
    });
    return items.slice(0, 15);
  } catch (e) {
    console.error("MyGov failed:", e.message);
    return [];
  }
}

// ---------- main ----------

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing BOT_TOKEN or CHAT_ID env vars.");
    process.exit(1);
  }

  const seen = loadSeen();
  const firstRun = seen.size === 0;

  const results = (
    await Promise.all([fromUnstop(), fromDevfolio(), fromSIH(), fromMyGov()])
  ).flat();

  const fresh = results.filter((r) => r.id && !seen.has(r.id));

  // dedup within this run too
  const uniqueFresh = [];
  const batchIds = new Set();
  for (const r of fresh) {
    if (!batchIds.has(r.id)) {
      batchIds.add(r.id);
      uniqueFresh.push(r);
    }
  }

  console.log(`Total scraped: ${results.length}, new: ${uniqueFresh.length}`);

  // Mark everything as seen
  results.forEach((r) => seen.add(r.id));
  saveSeen(seen);

  if (uniqueFresh.length === 0) {
    console.log("Nothing new today.");
    return;
  }

  // On the very first run, just seed and send one summary (avoid 50-msg spam)
  if (firstRun) {
    await sendTelegram(
      `🛰️ <b>Hackathon Radar is live!</b>\nTracking ${uniqueFresh.length} current gov/public hackathons. You'll get pinged whenever a NEW one drops.`
    );
    // send up to 10 of the current ones so you see them now
    for (const r of uniqueFresh.slice(0, 10)) {
      await sendTelegram(formatMsg(r));
      await new Promise((res) => setTimeout(res, 400));
    }
    return;
  }

  for (const r of uniqueFresh) {
    await sendTelegram(formatMsg(r));
    await new Promise((res) => setTimeout(res, 400)); // avoid rate limits
  }
}

function formatMsg(r) {
  return `🚨 <b>New hackathon</b>\n\n<b>${escapeHtml(r.title)}</b>\n${
    r.meta ? escapeHtml(r.meta) + "\n" : ""
  }\n🔗 ${r.link}`;
}

function escapeHtml(s = "") {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
