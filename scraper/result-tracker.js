/**
 * Tender Result Tracker — uses Gemini API with Google Search grounding
 * to find who won closed BESS tenders.
 *
 * One API call per tender. Gemini searches the web and returns structured results.
 * No scraping, no article fetching, no local LLM needed.
 *
 * Usage:
 *   node scraper/result-tracker.js           # All closed tenders
 *   node scraper/result-tracker.js <nitNo>   # Specific tender
 *
 * Requires: GEMINI_API_KEY in .env
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, updateDoc, addDoc, setDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const USE_GROUNDING = process.env.USE_GROUNDING !== "false";

const KNOWN_AUTHORITIES = [
  "SECI", "NTPC", "NGEL", "NUGEL", "GUVNL", "MSEDCL", "RRVUNL", "PSPCL",
  "TNGECL", "SJVNL", "DHBVN", "WBSEDCL", "MSETCL", "UPCL", "UJVNL",
  "NHPC", "PGCIL", "POWERGRID", "IREDA", "HPPCL", "NVVN", "KPTCL",
  "TSECL", "RVPN", "APTRANSCO", "CESC", "CSPDCL", "UPPCL", "WBGEDCL",
  "KREDL", "HPCL", "AEML", "TGTRANSCO", "BSPGCL", "RUMSL",
];

function detectAuthority(tender) {
  const text = `${tender.nitNumber || ""} ${tender.title || ""} ${tender.authority || ""}`.toUpperCase();
  for (const auth of KNOWN_AUTHORITIES) {
    if (text.includes(auth)) return auth;
  }
  return null;
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// Firebase init
const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const authFb = getAuth(app);
await signInWithEmailAndPassword(authFb, process.env.FIREBASE_SCRAPER_EMAIL, process.env.FIREBASE_SCRAPER_PASSWORD);
const db = getFirestore(app);

/**
 * Ask Gemini (with Google Search grounding) about a tender result.
 * Returns structured JSON with winners, bidders, prices.
 */
async function geminiCall(query, attempt = 1) {
  const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `You are an expert on Indian BESS (Battery Energy Storage System) tenders.

Search the web and answer this question. If the tender result has NOT been announced yet, say "not announced".

Question: ${query}

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{
  "announced": true or false,
  "winners": [{"company": "name", "capacityMWh": number or null, "priceLakhsPerMW": number or null, "priceRsPerKWh": number or null}],
  "bidders": ["company1", "company2"],
  "developer": "company name or null",
  "state": "state name or null",
  "resultSummary": "one sentence summary"
}

If result is not announced, return: {"announced": false, "winners": null, "bidders": null, "developer": null, "state": null, "resultSummary": "Result not yet announced"}`,
        }],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
      ...(USE_GROUNDING ? { tools: [{ google_search: {} }] } : {}),
    }),
  });

  // Retry 503 once with backoff
  if (resp.status === 503 && attempt === 1) {
    console.log(`  [Gemini] 503 transient, retrying in 20s...`);
    await new Promise((r) => setTimeout(r, 20000));
    return geminiCall(query, 2);
  }

  return resp;
}

function salvageJson(text) {
  // Strip markdown fences
  let s = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  s = s.slice(start);

  // Try direct parse
  try { return JSON.parse(s); } catch {}

  // Walk and close dangling structures (handles truncated JSON)
  const stack = [];
  let inStr = false, esc = false, lastGood = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") { stack.pop(); lastGood = i; }
    else if (c === "," && stack.length > 0) lastGood = i;
  }

  // Truncate to last valid comma/brace, strip trailing comma, close open structures
  let truncated = lastGood > 0 ? s.slice(0, lastGood + 1) : s;
  truncated = truncated.replace(/,\s*$/, "");
  // Close any strings left open
  if (inStr) truncated += '"';
  // Close remaining stack
  const closeStack = [...stack];
  while (closeStack.length) {
    const open = closeStack.pop();
    truncated += open === "{" ? "}" : "]";
  }

  try { return JSON.parse(truncated); } catch { return null; }
}

async function askGemini(query) {
  try {
    const resp = await geminiCall(query);

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`  [Gemini] API error ${resp.status}:\n${errText}`);
      return null;
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const finishReason = data.candidates?.[0]?.finishReason;

    const parsed = salvageJson(text);
    if (!parsed) {
      console.log(`  [Gemini] No parseable JSON (finish=${finishReason}): ${text.slice(0, 200)}`);
      return null;
    }
    if (finishReason === "MAX_TOKENS") {
      console.log(`  [Gemini] WARN: response hit MAX_TOKENS, data may be incomplete`);
    }
    return parsed;
  } catch (err) {
    console.log(`  [Gemini] Error: ${err.message}`);
    return null;
  }
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set in .env");
    process.exit(1);
  }

  const snap = await getDocs(collection(db, "tenders"));
  const allTenders = snap.docs.map((d) => ({ nitNumber: d.id, ...d.data() }));
  const targetNit = process.argv[2];

  const candidates = allTenders.filter((t) => {
    if (targetNit) return t.nitNumber === targetNit;
    if (t.awardedTo) return false;
    if (t.tenderStatus !== "closed" && !(t.daysLeft != null && t.daysLeft < 0)) return false;
    return !!detectAuthority(t);
  });

  console.log(`\nFound ${candidates.length} closed tenders to check\n`);

  let updated = 0;
  let bidsCreated = 0;
  let skipped = 0;

  for (const tender of candidates) {
    const realAuthority = detectAuthority(tender);

    console.log(`\n${"─".repeat(60)}`);
    console.log(`[${tender.nitNumber}]`);
    console.log(`${(tender.title || "").slice(0, 80)}`);
    console.log(`Authority: ${realAuthority} | ${tender.powerMW || "?"}MW / ${tender.energyMWh || "?"}MWh`);

    // Ask Gemini
    const question = `Who won the ${realAuthority} ${tender.powerMW || ""}MW ${tender.energyMWh || ""}MWh BESS tender in India? NIT: ${tender.nitNumber}. Title: ${(tender.title || "").slice(0, 100)}`;
    console.log(`  Asking Gemini...`);

    const result = await askGemini(question);

    if (!result) {
      console.log("  → Gemini returned null, skipping");
      skipped++;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (!result.announced || !result.winners || !Array.isArray(result.winners) || result.winners.length === 0) {
      console.log(`  → ${result.resultSummary || "Not announced yet"}`);
      skipped++;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    // Display
    console.log(`  RESULT: ${result.resultSummary || ""}`);
    for (const w of result.winners) {
      console.log(`    Winner: ${w.company} — ${w.capacityMWh || "?"}MWh @ ${w.priceLakhsPerMW || w.priceRsPerKWh || "?"}`);
    }

    const bidders = Array.isArray(result.bidders) ? result.bidders : [];
    if (bidders.length > 0) console.log(`    Bidders: ${bidders.join(", ")}`);

    // Write to Firestore
    const awardedTo = result.winners[0].company;
    if (!awardedTo || awardedTo.length < 2) {
      console.log("  → Empty winner name, skipping");
      skipped++;
      continue;
    }

    await updateDoc(doc(db, "tenders", tender.nitNumber), {
      awardedTo,
      developedBy: (result.developer && result.developer !== "null") ? result.developer : null,
      tenderStatus: "awarded",
      lastUpdatedAt: Timestamp.now(),
    });
    console.log(`  → Updated: awarded to ${awardedTo}`);
    updated++;

    // Create bid records for winners
    for (const w of result.winners) {
      if (!w.company) continue;
      const cid = slugify(w.company);
      await setDoc(doc(db, "companies", cid), { name: w.company, type: "Developer", bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: Timestamp.now() }, { merge: true });
      await addDoc(collection(db, "bids"), {
        companyId: cid, companyName: w.company, tenderNit: tender.nitNumber,
        tenderName: realAuthority, category: tender.category || null,
        capacityMWh: w.capacityMWh || null, priceStandalone: w.priceLakhsPerMW || null,
        priceFDRE: w.priceRsPerKWh || null, state: result.state || tender.state || null,
        result: "won", reference: "Gemini Search",
      });
      bidsCreated++;
    }

    // Create bid records for losers
    if (bidders.length > 0) {
      const winnerNames = new Set(result.winners.map((w) => w.company?.toLowerCase()));
      for (const bidder of bidders) {
        if (!bidder || winnerNames.has(bidder.toLowerCase())) continue;
        const cid = slugify(bidder);
        await setDoc(doc(db, "companies", cid), { name: bidder, type: "Developer", bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: Timestamp.now() }, { merge: true });
        await addDoc(collection(db, "bids"), {
          companyId: cid, companyName: bidder, tenderNit: tender.nitNumber,
          tenderName: realAuthority, category: tender.category || null,
          capacityMWh: null, priceStandalone: null, priceFDRE: null,
          state: result.state || tender.state || null, result: "lost", reference: "Gemini Search",
        });
        bidsCreated++;
      }
    }

    await new Promise((r) => setTimeout(r, 5000)); // rate limit — 15 req/min free tier
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done. Updated: ${updated} | Bids created: ${bidsCreated} | Skipped: ${skipped}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
