/**
 * Tender Result Tracker — finds who won closed tenders.
 *
 * Uses DuckDuckGo HTML search to find news articles about tender results,
 * then LLM extracts winners, prices, bidders from the article text.
 *
 * Usage:
 *   node scraper/result-tracker.js           # All closed tenders
 *   node scraper/result-tracker.js <nitNo>   # Specific tender
 */
import "dotenv/config";
import axios from "axios";
import * as cheerio from "cheerio";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, getDocs, doc, updateDoc, addDoc, setDoc, Timestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { extractTenderResult, isLlmAvailable } from "./llm.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

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
 * Search DuckDuckGo HTML (no JS needed, no redirects, direct article URLs).
 * Restricts to energy news sites for accuracy.
 */
async function searchDuckDuckGo(query) {
  const articles = [];
  try {
    const siteFilter = "site:mercomindia.com OR site:saurenergy.com OR site:pv-magazine-india.com OR site:solarquarter.com";
    const fullQuery = `${query} ${siteFilter}`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(fullQuery)}`;

    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);

    $(".result__a").each((_i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href") || "";
      const match = href.match(/uddg=([^&]+)/);
      const realUrl = match ? decodeURIComponent(match[1]) : href;

      if (!title || title.length < 15 || !realUrl.startsWith("http")) return;

      const titleLower = title.toLowerCase();
      const isResult = ["award", "won", "winner", "result", "select", "lowest", "l1", "bags", "secures", "announces"].some(
        (kw) => titleLower.includes(kw)
      );
      if (isResult) {
        articles.push({ title, link: realUrl, source: "DuckDuckGo" });
      }
    });
  } catch { /* skip */ }
  return articles;
}

/**
 * Fetch article text from a URL.
 */
async function fetchArticleText(url) {
  try {
    const resp = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 15000 });
    const $ = cheerio.load(resp.data);
    $("nav, footer, .sidebar, .ad, script, style, .related-posts, .comments").remove();
    const articleEl = $("article, .entry-content, .post-content, .article-content, .td-post-content, main").first();
    return (articleEl.length ? articleEl.text() : $("body").text()).replace(/\s+/g, " ").trim().slice(0, 10000);
  } catch { return null; }
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function main() {
  if (!(await isLlmAvailable())) {
    console.error("Ollama is not running. Start with: ollama serve");
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

  console.log(`\nFound ${candidates.length} closed tenders with real authority names\n`);

  let updated = 0;
  let bidsCreated = 0;

  for (const tender of candidates) {
    const realAuthority = detectAuthority(tender);

    console.log(`\n${"─".repeat(60)}`);
    console.log(`[${tender.nitNumber}]`);
    console.log(`${(tender.title || "").slice(0, 80)}`);
    console.log(`Authority: ${realAuthority} | ${tender.powerMW || "?"}MW / ${tender.energyMWh || "?"}MWh`);

    // Build search query
    const queryParts = [realAuthority];
    if (tender.powerMW) queryParts.push(`${tender.powerMW}MW`);
    if (tender.energyMWh) queryParts.push(`${tender.energyMWh}MWh`);
    queryParts.push("BESS tender result winner");
    const query = queryParts.join(" ");

    console.log(`  Query: "${query}"`);

    // Search DuckDuckGo
    const articles = await searchDuckDuckGo(query);

    // Filter by relevance — must mention authority
    const authLower = realAuthority.toLowerCase();
    const relevant = articles.filter((a) => a.title.toLowerCase().includes(authLower));

    if (relevant.length === 0) {
      console.log(`  → No relevant articles found`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    console.log(`  Found ${relevant.length} article(s):`);
    relevant.slice(0, 3).forEach((a) => console.log(`    - ${a.title.slice(0, 70)}`));

    // Try each article
    let result = null;
    let usedUrl = null;

    for (const article of relevant.slice(0, 3)) {
      console.log(`  Fetching: ${article.link.slice(0, 70)}`);
      const text = await fetchArticleText(article.link);

      if (!text || text.length < 300) {
        console.log(`  → Too short (${text?.length || 0} chars), next`);
        continue;
      }

      console.log(`  ${text.length} chars. Asking LLM...`);
      const llmResult = await extractTenderResult(text, tender.title || "");

      if (!llmResult?.winners?.length || !llmResult.winners[0]?.company) {
        console.log("  → No winners, next");
        continue;
      }

      result = llmResult;
      usedUrl = article.link;
      break;
    }

    if (!result) {
      console.log("  → No valid result, skipping");
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    // Display
    console.log(`  RESULT: ${result.resultSummary || ""}`);
    for (const w of result.winners) {
      console.log(`    Winner: ${w.company} — ${w.capacityMWh || "?"}MWh @ ${w.priceLakhsPerMW || w.priceRsPerKWh || "?"}`);
    }
    const bidders = Array.isArray(result.bidders) ? result.bidders : (typeof result.bidders === "string" ? [result.bidders] : []);

    // Write to Firestore
    const awardedTo = result.winners[0].company;
    await updateDoc(doc(db, "tenders", tender.nitNumber), {
      awardedTo,
      developedBy: (result.developer && result.developer !== "null") ? result.developer : null,
      tenderStatus: "awarded",
      lastUpdatedAt: Timestamp.now(),
    });
    console.log(`  → Updated: awarded to ${awardedTo}`);
    updated++;

    for (const w of result.winners) {
      if (!w.company) continue;
      const cid = slugify(w.company);
      await setDoc(doc(db, "companies", cid), { name: w.company, type: "Developer", bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: Timestamp.now() }, { merge: true });
      await addDoc(collection(db, "bids"), {
        companyId: cid, companyName: w.company, tenderNit: tender.nitNumber,
        tenderName: realAuthority, category: tender.category || null,
        capacityMWh: w.capacityMWh || null, priceStandalone: w.priceLakhsPerMW || null,
        priceFDRE: w.priceRsPerKWh || null, state: result.state || tender.state || null,
        result: "won", reference: usedUrl,
      });
      bidsCreated++;
    }

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
          state: result.state || tender.state || null, result: "lost", reference: usedUrl,
        });
        bidsCreated++;
      }
    }

    await new Promise((r) => setTimeout(r, 3000)); // rate limit DDG
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done. Tenders updated: ${updated} | Bid records created: ${bidsCreated}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
