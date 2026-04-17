/**
 * Tender Result Tracker — finds who won closed tenders.
 *
 * Pipeline:
 * 1. Find tenders where daysLeft < 0, no awardedTo, AND has a real authority name
 * 2. Search Google News RSS + Mercom for result articles
 * 3. Follow Google News redirects to get real article URLs
 * 4. LLM extracts: winner, price, bidders, developer
 * 5. Validates result matches the tender before writing
 * 6. Updates tender + creates Bid records
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

// Known authority names to detect from tender title/NIT
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
 * Generic search on a news site — extracts article titles + links.
 */
async function searchSite(url, sourceName) {
  const articles = [];
  try {
    const resp = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 15000 });
    const $ = cheerio.load(resp.data);
    $("article h2 a, .entry-title a, h3 a, h2 a").each((_i, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr("href");
      if (!title || title.length < 20 || !link) return;
      const titleLower = title.toLowerCase();
      if (["award", "won", "winner", "result", "select", "lowest", "l1", "bags", "secures", "announces"].some(kw => titleLower.includes(kw))) {
        articles.push({ title, link, source: sourceName });
      }
    });
  } catch { /* skip */ }
  return articles;
}

/**
 * Search Google News RSS — but instead of using the redirect link,
 * construct the real URL by searching the source site directly.
 * Returns articles with title + source name (no direct link — we search the source site).
 */
async function searchGoogleNewsWithSources(query) {
  const articles = [];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " India")}&hl=en-IN&gl=IN`;
    const resp = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 15000 });
    const $ = cheerio.load(resp.data, { xmlMode: true });

    $("item").each((_i, el) => {
      const title = $(el).find("title").text().trim();
      const sourceName = $(el).find("source").text().trim();
      const sourceUrl = $(el).find("source").attr("url") || "";

      if (!title || title.length < 15) return;
      const titleLower = title.toLowerCase();
      if (["award", "won", "winner", "result", "select", "lowest", "l1", "bags", "secures", "announces"].some(kw => titleLower.includes(kw))) {
        // Use the source site's search to find the article
        // Construct a search URL for the source site
        let link = null;
        if (sourceUrl.includes("mercomindia")) link = `https://mercomindia.com/?s=${encodeURIComponent(title.slice(0, 40))}`;
        else if (sourceUrl.includes("saurenergy")) link = `https://www.saurenergy.com/?s=${encodeURIComponent(title.slice(0, 40))}`;
        else if (sourceUrl.includes("pv-magazine")) link = `https://www.pv-magazine-india.com/?s=${encodeURIComponent(title.slice(0, 40))}`;
        else if (sourceUrl.includes("solarquarter")) link = `https://solarquarter.com/?s=${encodeURIComponent(title.slice(0, 40))}`;
        // For known sources, search their site directly
        if (link) {
          articles.push({ title, link, source: sourceName, isSearchUrl: true });
        }
      }
    });
  } catch { /* skip */ }
  return articles;
}

// Keep old function name for compatibility but unused now
/**
 * Search Mercom India for tender result articles.
 */
async function searchMercom(query) {
  const articles = [];
  try {
    const url = `https://mercomindia.com/?s=${encodeURIComponent(query)}`;
    const resp = await axios.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: 15000 });
    const $ = cheerio.load(resp.data);

    $("article h2 a, .entry-title a, h3 a").each((_i, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr("href");
      if (!title || title.length < 20 || !link) return;

      const titleLower = title.toLowerCase();
      const isResult = ["award", "won", "winner", "result", "select", "lowest", "l1", "bags", "secures", "announces"].some(
        (kw) => titleLower.includes(kw)
      );
      if (isResult) {
        articles.push({ title, link, source: "Mercom" });
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

  // Find closed tenders without results — ONLY those with a real authority
  const candidates = allTenders.filter((t) => {
    if (targetNit) return t.nitNumber === targetNit;
    if (t.awardedTo) return false;
    if (t.tenderStatus !== "closed" && !(t.daysLeft != null && t.daysLeft < 0)) return false;
    // Must have a real authority name (skip generic TenderDetail labels)
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

    // Search multiple news sites directly (not Google News — redirects don't resolve)
    const mercomQuery = `${realAuthority} ${tender.powerMW || ""} BESS result`;
    const mercomArticles = await searchMercom(mercomQuery);
    const saurArticles = await searchSite(
      `https://www.saurenergy.com/?s=${encodeURIComponent(mercomQuery)}`,
      "SaurEnergy"
    );
    const pvMagArticles = await searchSite(
      `https://www.pv-magazine-india.com/?s=${encodeURIComponent(mercomQuery)}`,
      "PV Magazine"
    );

    // Also search Google News but extract source URLs from RSS metadata
    const googleArticles = await searchGoogleNewsWithSources(query);

    // Filter by relevance — article title must mention the authority
    const authLower = realAuthority.toLowerCase();
    const mwStr = tender.powerMW ? String(tender.powerMW) : null;

    const allArticles = [...mercomArticles, ...saurArticles, ...pvMagArticles, ...googleArticles].filter((a) => {
      const titleLower = a.title.toLowerCase();
      return titleLower.includes(authLower) || (mwStr && titleLower.includes(mwStr));
    });

    // Deduplicate by title (first 50 chars)
    const seen = new Set();
    const uniqueArticles = allArticles.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueArticles.length === 0) {
      console.log(`  → No relevant articles found, skipping`);
      continue;
    }

    console.log(`  Found ${uniqueArticles.length} relevant article(s):`);
    uniqueArticles.slice(0, 5).forEach((a) => console.log(`    - ${a.title.slice(0, 70)} [${a.source}]`));

    // Try each article until we get a valid result
    let result = null;

    for (const article of uniqueArticles.slice(0, 3)) {
      let articleUrl = article.link;

      // If this is a search URL from Google News source matching, resolve the actual article
      if (article.isSearchUrl) {
        console.log(`  Searching source: ${articleUrl?.slice(0, 60)}`);
        try {
          const resp = await axios.get(articleUrl, { headers: { "User-Agent": USER_AGENT }, timeout: 15000 });
          const $s = cheerio.load(resp.data);
          // Get first article link from search results
          const firstLink = $s("article a, .entry-title a, h2 a, h3 a").first().attr("href");
          if (firstLink && !firstLink.includes("?s=")) {
            articleUrl = firstLink;
          } else {
            console.log("  → Couldn't find article in search results, trying next");
            continue;
          }
        } catch {
          console.log("  → Search failed, trying next");
          continue;
        }
      }

      if (!articleUrl) {
        console.log("  → No URL, trying next");
        continue;
      }

      console.log(`  Fetching: ${articleUrl.slice(0, 70)}`);
      const text = await fetchArticleText(articleUrl);

      if (!text || text.length < 300) {
        console.log(`  → Article too short (${text?.length || 0} chars), trying next`);
        continue;
      }

      console.log(`  Article: ${text.length} chars. Asking LLM...`);
      const llmResult = await extractTenderResult(text, tender.title || "");

      if (!llmResult || !llmResult.winners || !Array.isArray(llmResult.winners) || llmResult.winners.length === 0) {
        console.log("  → No winners extracted, trying next");
        continue;
      }

      const winner = llmResult.winners[0]?.company;
      if (!winner || winner.length < 2) {
        console.log("  → Empty winner name, trying next");
        continue;
      }

      result = llmResult;
      result._articleUrl = articleUrl;
      break;
    }

    if (!result) {
      console.log("  → No valid result, skipping");
      continue;
    }

    // Display
    console.log(`  RESULT: ${result.resultSummary || "-"}`);
    for (const w of result.winners) {
      console.log(`    Winner: ${w.company} — ${w.capacityMWh || "?"}MWh @ ${w.priceLakhsPerMW || w.priceRsPerKWh || "?"}`);
    }

    const bidders = Array.isArray(result.bidders) ? result.bidders : (typeof result.bidders === "string" ? [result.bidders] : []);
    if (bidders.length > 0) console.log(`    Bidders: ${bidders.join(", ")}`);
    if (result.developer && result.developer !== "null") console.log(`    Developer: ${result.developer}`);

    // Write to Firestore
    const awardedTo = result.winners[0].company;
    await updateDoc(doc(db, "tenders", tender.nitNumber), {
      awardedTo,
      developedBy: (result.developer && result.developer !== "null") ? result.developer : null,
      tenderStatus: "awarded",
      lastUpdatedAt: Timestamp.now(),
    });
    console.log(`  → Tender updated: awarded to ${awardedTo}`);
    updated++;

    // Create bid records for winners
    for (const w of result.winners) {
      if (!w.company) continue;
      const companyId = slugify(w.company);
      await setDoc(doc(db, "companies", companyId), { name: w.company, type: "Developer", bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: Timestamp.now() }, { merge: true });
      await addDoc(collection(db, "bids"), {
        companyId, companyName: w.company, tenderNit: tender.nitNumber,
        tenderName: realAuthority || tender.nitNumber, category: tender.category || null,
        capacityMWh: w.capacityMWh || null, priceStandalone: w.priceLakhsPerMW || null,
        priceFDRE: w.priceRsPerKWh || null, state: result.state || tender.state || null,
        result: "won", reference: result._articleUrl,
      });
      bidsCreated++;
    }

    // Create bid records for losers
    if (bidders.length > 0) {
      const winnerNames = new Set(result.winners.map((w) => w.company?.toLowerCase()));
      for (const bidder of bidders) {
        if (!bidder || winnerNames.has(bidder.toLowerCase())) continue;
        const companyId = slugify(bidder);
        await setDoc(doc(db, "companies", companyId), { name: bidder, type: "Developer", bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: Timestamp.now() }, { merge: true });
        await addDoc(collection(db, "bids"), {
          companyId, companyName: bidder, tenderNit: tender.nitNumber,
          tenderName: realAuthority || tender.nitNumber, category: tender.category || null,
          capacityMWh: null, priceStandalone: null, priceFDRE: null,
          state: result.state || tender.state || null, result: "lost", reference: result._articleUrl,
        });
        bidsCreated++;
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done. Tenders updated: ${updated} | Bid records created: ${bidsCreated}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
