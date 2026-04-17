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
 * Follow a Google News redirect URL to get the real article URL.
 * Google News RSS links are like: https://news.google.com/rss/articles/CBMi...
 * They redirect (302) to the actual article on mercomindia.com, pv-magazine etc.
 */
async function followRedirect(url) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    // If 200 — check if it's a meta refresh or JS redirect page
    const html = resp.data;
    if (typeof html === "string") {
      // Look for meta refresh
      const metaMatch = html.match(/url=([^"'\s>]+)/i);
      if (metaMatch) return metaMatch[1];
      // Look for canonical link
      const canonMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i);
      if (canonMatch) return canonMatch[1];
      // Look for og:url
      const ogMatch = html.match(/og:url['"]\s+content=["']([^"']+)/i);
      if (ogMatch) return ogMatch[1];
    }
    return resp.request?.res?.responseUrl || url;
  } catch (err) {
    // 302 redirect — get the Location header
    if (err.response?.status === 302 || err.response?.status === 301) {
      return err.response.headers.location || url;
    }
    return url;
  }
}

/**
 * Search Google News RSS for tender result articles.
 */
async function searchGoogleNews(query) {
  const articles = [];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " India")}&hl=en-IN&gl=IN`;
    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data, { xmlMode: true });

    $("item").each((_i, el) => {
      const title = $(el).find("title").text().trim();
      const googleLink = $(el).find("link").text().trim();
      // Get the actual source from <source> tag
      const sourceUrl = $(el).find("source").attr("url") || "";
      const sourceName = $(el).find("source").text().trim() || "Google News";

      if (!title || title.length < 15) return;

      const titleLower = title.toLowerCase();
      const isResult = ["award", "won", "winner", "result", "select", "lowest", "l1", "bags", "secures", "announces"].some(
        (kw) => titleLower.includes(kw)
      );
      if (isResult) {
        articles.push({ title, googleLink, sourceUrl, source: sourceName });
      }
    });
  } catch { /* skip */ }
  return articles;
}

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

    // Search Google News + Mercom
    const [googleArticles, mercomArticles] = await Promise.all([
      searchGoogleNews(query),
      searchMercom(`${realAuthority} ${tender.powerMW || ""} BESS result`),
    ]);

    // Filter by relevance — article title must mention the authority
    const authLower = realAuthority.toLowerCase();
    const mwStr = tender.powerMW ? String(tender.powerMW) : null;

    const allArticles = [...mercomArticles, ...googleArticles].filter((a) => {
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
      // Resolve actual URL (follow Google News redirects)
      let articleUrl = article.link || article.googleLink;
      if (articleUrl?.includes("news.google.com")) {
        console.log(`  Following redirect: ${articleUrl.slice(0, 60)}...`);
        articleUrl = await followRedirect(articleUrl);
        console.log(`  → Real URL: ${articleUrl?.slice(0, 60)}`);
      }

      if (!articleUrl || articleUrl.includes("news.google.com")) {
        console.log("  → Couldn't resolve redirect, trying next");
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
