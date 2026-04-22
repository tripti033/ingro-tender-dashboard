/**
 * Historical tender backfill — uses Gemini API with Google Search grounding
 * to find BESS tenders floated in India during a given date range.
 *
 * One Gemini call per month (free-tier quota is tight, so big ranges
 * will burn through fast — 20 req/day per model).
 *
 * Usage:
 *   node scraper/backfill-tenders.js 2023-06 2023-09        # Jun–Sep 2023
 *   node scraper/backfill-tenders.js 2024-01 2024-12        # all of 2024
 *   node scraper/backfill-tenders.js 2023-06 2023-06 --dry  # preview only
 *
 * Requires GEMINI_API_KEY in .env
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── CLI args ──
const args = process.argv.slice(2);
const dryRun = args.includes("--dry") || args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const startArg = positional[0];
const endArg = positional[1] || positional[0];

if (!startArg || !/^\d{4}-\d{2}$/.test(startArg) || !/^\d{4}-\d{2}$/.test(endArg)) {
  console.error("Usage: node scraper/backfill-tenders.js <YYYY-MM> [<YYYY-MM>] [--dry]");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set in .env");
  process.exit(1);
}

function* monthRange(start, end) {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${String(m).padStart(2, "0")}`;
    m++;
    if (m > 12) { m = 1; y++; }
  }
}

const months = [...monthRange(startArg, endArg)];
console.log(`Backfill plan: ${months.length} month(s) — ${months.join(", ")}`);
if (dryRun) console.log("[DRY RUN] — nothing will be written to Firestore\n");

// ── Firebase ──
const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
await signInWithEmailAndPassword(
  getAuth(app),
  process.env.FIREBASE_SCRAPER_EMAIL,
  process.env.FIREBASE_SCRAPER_PASSWORD,
);
const db = getFirestore(app);

// Load existing NITs once for dedup
const existingSnap = await getDocs(collection(db, "tenders"));
const existingNits = new Set(existingSnap.docs.map((d) => d.id));
console.log(`Loaded ${existingNits.size} existing tenders for dedup\n`);

// ── Gemini call ──
async function askGemini(prompt) {
  const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      tools: [{ google_search: {} }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.log(`  [Gemini] ${resp.status}:\n${err}`);
    return null;
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  // Extract the first top-level JSON array or object
  const match = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.log(`  [Gemini] No JSON in response: ${text.slice(0, 200)}`);
    return null;
  }
  try { return JSON.parse(match[0]); } catch {
    // Try salvaging a truncated array
    let s = match[0].replace(/,\s*$/, "");
    while (s.length > 10) {
      try { return JSON.parse(s); } catch {}
      s = s.slice(0, -1);
      if (!s.endsWith("}") && !s.endsWith("]")) continue;
      const closing = s.endsWith("}") ? "]" : "";
      try { return JSON.parse(s + closing); } catch {}
    }
    console.log(`  [Gemini] Unsalvageable JSON: ${match[0].slice(0, 200)}`);
    return null;
  }
}

function monthLabel(ym) {
  const [y, m] = ym.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[Number(m) - 1]} ${y}`;
}

function slugifyNit(raw) {
  return String(raw).trim().replace(/\s+/g, "-").slice(0, 80);
}

let totalFound = 0, totalWritten = 0, totalDup = 0, totalSkipped = 0;

for (const ym of months) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Month: ${monthLabel(ym)} (${ym})`);

  const prompt = `Help a BD team back-fill their tender database. They want every Indian BESS (Battery Energy Storage System) tender that was FLOATED — announced, issued, RfS/RfP released — in ${monthLabel(ym)}.

Search the web thoroughly. Cast a wide net: standalone battery storage, solar+storage / FDRE / hybrid, pumped storage, any EPC/BOOT/BOO/DBFOO model. If you're unsure whether something is "BESS enough", err on the side of including it — they'd rather filter one extra tender than miss one they should have tracked.

For each tender respond with a JSON array (no markdown, no prose):
[
  {
    "nitNumber": "exact NIT as published, or null if not visible",
    "title": "short concrete description, <200 chars",
    "authority": "SECI / NTPC / GUVNL / NHPC / state utility etc.",
    "state": "Indian state name or null",
    "powerMW": number or null,
    "energyMWh": number or null,
    "category": "Standalone / FDRE / S+S / PSP / Hybrid / null",
    "bidDeadline": "YYYY-MM-DD or null",
    "issueDate": "YYYY-MM-DD or null",
    "awardedTo": "company name if already decided, else null",
    "sourceUrl": "URL to tender doc or press release",
    "resultSummary": "one tight sentence — capacity, buyer, VGF support, winner if known"
  }
]

If nothing was floated in that month, return []. Only include tenders you have a real source URL for — don't make anything up. If coverage for a tender is shaky, return it but be honest in resultSummary ("press release unclear about exact capacity" etc.).`;

  console.log(`  Asking Gemini (model: ${GEMINI_MODEL})...`);
  const result = await askGemini(prompt);

  if (!result) {
    console.log(`  → no result, skipping`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  const list = Array.isArray(result) ? result : (result.tenders || []);
  if (list.length === 0) {
    console.log(`  → Gemini reported 0 BESS tenders for this month`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  totalFound += list.length;
  console.log(`  Gemini returned ${list.length} candidate tender(s)`);

  for (const t of list) {
    if (!t.title) { totalSkipped++; continue; }

    // Build a stable NIT. Prefer Gemini's nitNumber; otherwise synthesise
    // from authority + capacity + month so we dedupe across runs.
    let nit;
    if (t.nitNumber && String(t.nitNumber).trim().length > 2) {
      nit = slugifyNit(t.nitNumber);
    } else {
      const authSlug = (t.authority || "UNKNOWN").replace(/\s+/g, "-");
      const cap = t.energyMWh ? `${t.energyMWh}MWh` : (t.powerMW ? `${t.powerMW}MW` : "X");
      nit = `${authSlug}-${cap}-${ym}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
      console.log(`    ~ synthesised NIT: ${nit}`);
    }

    if (existingNits.has(nit)) {
      totalDup++;
      console.log(`    = dup: ${nit}`);
      continue;
    }

    const issueDate = t.issueDate ? new Date(t.issueDate) : null;
    const bidDeadlineDate = t.bidDeadline ? new Date(t.bidDeadline) : null;
    // Historical tenders are almost always closed/awarded — mark accordingly
    const tenderStatus = t.awardedTo ? "awarded" : "closed";

    const doc_ = {
      nitNumber: nit,
      title: String(t.title).slice(0, 500),
      authority: t.authority || null,
      state: t.state || null,
      location: null,
      category: t.category || null,
      tenderMode: null,
      powerMW: typeof t.powerMW === "number" ? t.powerMW : null,
      energyMWh: typeof t.energyMWh === "number" ? t.energyMWh : null,
      bidDeadline: bidDeadlineDate && !isNaN(+bidDeadlineDate) ? Timestamp.fromDate(bidDeadlineDate) : null,
      daysLeft: bidDeadlineDate && !isNaN(+bidDeadlineDate)
        ? Math.ceil((bidDeadlineDate.getTime() - Date.now()) / 86400000)
        : null,
      tenderStatus,
      awardedTo: t.awardedTo || null,
      developedBy: null,
      documentLink: t.sourceUrl || null,
      sourceUrl: t.sourceUrl || null,
      summary: t.resultSummary || null,
      sources: ["backfill"],
      flags: {},
      notes: {},
      firstSeenAt: issueDate && !isNaN(+issueDate) ? Timestamp.fromDate(issueDate) : Timestamp.now(),
      lastUpdatedAt: Timestamp.now(),
      createdBy: `backfill-${ym}`,
      llmExtractionFailed: false,
    };

    console.log(`    + ${nit} | ${t.authority || "?"} ${t.powerMW || "?"}MW/${t.energyMWh || "?"}MWh | ${t.awardedTo ? "won by " + t.awardedTo : "not awarded"}`);

    if (!dryRun) {
      try {
        await setDoc(doc(db, "tenders", nit), doc_);
        existingNits.add(nit);
        totalWritten++;
      } catch (err) {
        console.log(`      ✗ write failed: ${err.message}`);
      }
    }
  }

  // Rate-limit: 5s between Gemini calls (free tier is 20/day per model)
  await new Promise((r) => setTimeout(r, 5000));
}

console.log(`\n${"═".repeat(60)}`);
console.log(`Done. Candidates: ${totalFound} | Written: ${totalWritten} | Dup: ${totalDup} | Skipped (no NIT/title): ${totalSkipped}`);
if (dryRun) console.log(`(dry-run — nothing was actually written)`);
process.exit(0);
