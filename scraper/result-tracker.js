/**
 * Tender Result Tracker — finds who won closed tenders.
 *
 * Pipeline:
 * 1. Find tenders where daysLeft < 0 and no awardedTo yet
 * 2. Search Google News for "{authority} {MW} BESS tender result winner"
 * 3. Scrape matching news articles
 * 4. LLM extracts: winner, price, bidders, developer
 * 5. Updates tender: awardedTo, developedBy, tenderStatus = "awarded"
 * 6. Creates Bid records (won/lost) linked to companies
 *
 * Usage:
 *   node scraper/result-tracker.js           # Process all closed tenders without results
 *   node scraper/result-tracker.js <nitNo>   # Process a specific tender
 *
 * Requires Ollama running locally.
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

// News sources to search for tender results
const NEWS_SEARCH_URLS = [
  (q) => `https://mercomindia.com/?s=${encodeURIComponent(q)}`,
  (q) => `https://www.saurenergy.com/?s=${encodeURIComponent(q)}`,
  (q) => `https://www.pv-magazine-india.com/?s=${encodeURIComponent(q)}`,
  // Google News RSS — broadest coverage
  (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + " India")}&hl=en-IN&gl=IN`,
];

// Known authority names to detect from tender title/NIT
const KNOWN_AUTHORITIES = [
  "SECI", "NTPC", "NGEL", "NUGEL", "GUVNL", "MSEDCL", "RRVUNL", "PSPCL",
  "TNGECL", "SJVNL", "DHBVN", "WBSEDCL", "MSETCL", "UPCL", "UJVNL",
  "NHPC", "PGCIL", "POWERGRID", "IREDA", "HPPCL", "NVVN", "KPTCL",
  "TSECL", "RVPN", "APTRANSCO", "CESC", "CSPDCL", "UPPCL", "WBGEDCL",
  "KREDL", "HPCL", "AEML", "TGTRANSCO",
];

/**
 * Extract a real authority name from the tender title/NIT.
 */
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
const auth = getAuth(app);
await signInWithEmailAndPassword(
  auth,
  process.env.FIREBASE_SCRAPER_EMAIL,
  process.env.FIREBASE_SCRAPER_PASSWORD
);
const db = getFirestore(app);

/**
 * Search a news site and extract article texts matching the query.
 */
async function searchNews(query) {
  const articles = [];

  for (const urlFn of NEWS_SEARCH_URLS) {
    try {
      const url = urlFn(query);
      const resp = await axios.get(url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 15000,
      });

      const $ = cheerio.load(resp.data, { xmlMode: url.includes("rss") });

      if (url.includes("rss") || url.includes("news.google")) {
        // Google News RSS format
        $("item").each((_i, el) => {
          const title = $(el).find("title").text().trim();
          const link = $(el).find("link").text().trim();
          if (!title || title.length < 15 || !link) return;

          const titleLower = title.toLowerCase();
          const isResult = ["award", "won", "winner", "result", "select", "lowest", "l1", "bid price", "bags", "secures"].some(
            (kw) => titleLower.includes(kw)
          );
          if (isResult) {
            articles.push({ title, link, source: "Google News" });
          }
        });
      } else {
        // HTML search results (Mercom, SaurEnergy, PV Magazine)
        $("article, .post, .entry, .search-result, h2 a, h3 a").each((_i, el) => {
          const linkEl = $(el).is("a") ? $(el) : $(el).find("a").first();
          const title = linkEl.text().trim() || $(el).find("h2, h3, .title").text().trim();
          const link = linkEl.attr("href");

          if (!title || title.length < 20 || !link) return;

          const titleLower = title.toLowerCase();
          const isResult = ["award", "won", "winner", "result", "select", "lowest", "l1", "bid price", "bags", "secures"].some(
            (kw) => titleLower.includes(kw)
          );
          if (isResult) {
            articles.push({ title, link, source: url.split("/")[2] });
          }
        });
      }
    } catch {
      // Skip failed searches
    }
  }

  return articles;
}

/**
 * Fetch an article page and extract the main text content.
 */
async function fetchArticleText(url) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);

    // Remove nav, footer, sidebar, ads
    $("nav, footer, sidebar, .sidebar, .ad, .advertisement, script, style, .related-posts, .comments").remove();

    // Extract article body
    const articleEl = $("article, .entry-content, .post-content, .article-content, .td-post-content, main").first();
    const text = (articleEl.length ? articleEl.text() : $("body").text())
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 10000); // Cap at 10K chars
  } catch {
    return null;
  }
}

/**
 * Slugify company name for Firestore company ID.
 */
function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function main() {
  if (!(await isLlmAvailable())) {
    console.error("Ollama is not running. Start with: ollama serve");
    process.exit(1);
  }

  // Load all tenders
  const snap = await getDocs(collection(db, "tenders"));
  const allTenders = snap.docs.map((d) => ({ nitNumber: d.id, ...d.data() }));

  const targetNit = process.argv[2];

  // Find closed tenders without results
  const candidates = allTenders.filter((t) => {
    if (targetNit) return t.nitNumber === targetNit;
    return (
      (t.tenderStatus === "closed" || (t.daysLeft != null && t.daysLeft < 0)) &&
      !t.awardedTo
    );
  });

  console.log(`\nFound ${candidates.length} closed tenders without results\n`);

  let updated = 0;
  let bidsCreated = 0;

  for (const tender of candidates) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`[${tender.nitNumber}]`);
    console.log(`${(tender.title || "").slice(0, 80)}`);
    console.log(`Authority: ${tender.authority || "?"} | ${tender.powerMW || "?"}MW / ${tender.energyMWh || "?"}MWh`);

    // Detect real authority name from title/NIT (not generic TenderDetail labels)
    const realAuthority = detectAuthority(tender);

    // Build search queries — use real authority, MW, and title keywords
    const queries = [];

    if (realAuthority && tender.powerMW) {
      queries.push(`${realAuthority} ${tender.powerMW}MW BESS tender result winner`);
      queries.push(`${realAuthority} ${tender.energyMWh || ""}MWh battery storage awarded`);
    } else if (realAuthority) {
      queries.push(`${realAuthority} BESS tender result`);
    }

    if (tender.powerMW && tender.energyMWh) {
      queries.push(`${tender.powerMW}MW ${tender.energyMWh}MWh BESS tender result India`);
    }

    if (tender.state && tender.powerMW) {
      queries.push(`${tender.state} ${tender.powerMW}MW BESS tender winner`);
    }

    if (tender.title) {
      // Extract meaningful keywords from title (skip generic words)
      const meaningful = tender.title
        .replace(/tender|for|the|of|and|in|at|by|with|from|setting|up|implementation/gi, "")
        .replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
      if (meaningful.length > 10) {
        queries.push(`${meaningful} tender result awarded`);
      }
    }

    if (queries.length === 0) {
      console.log("  → No good search query, skipping");
      continue;
    }

    // Search news
    console.log(`  Searching: "${queries[0].slice(0, 50)}..."`);
    let allArticles = [];
    for (const q of queries.slice(0, 2)) {
      const articles = await searchNews(q);
      allArticles.push(...articles);
      await new Promise((r) => setTimeout(r, 1000)); // rate limit
    }

    // Deduplicate articles by link
    const seen = new Set();
    allArticles = allArticles.filter((a) => {
      if (seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    });

    if (allArticles.length === 0) {
      console.log("  → No result articles found");
      continue;
    }

    // Filter articles: title must mention authority OR MW OR BESS keywords relevant to this tender
    const tenderKeywords = [
      realAuthority,
      tender.powerMW ? `${tender.powerMW}` : null,
      tender.energyMWh ? `${tender.energyMWh}` : null,
      tender.state,
    ].filter(Boolean).map(k => k.toLowerCase());

    const relevantArticles = allArticles.filter(a => {
      const titleLower = a.title.toLowerCase();
      // Article must mention at least one tender-specific keyword
      return tenderKeywords.some(kw => titleLower.includes(kw)) ||
        (realAuthority && titleLower.includes(realAuthority.toLowerCase()));
    });

    if (relevantArticles.length === 0) {
      console.log(`  Found ${allArticles.length} articles but none match tender keywords, skipping`);
      continue;
    }

    console.log(`  Found ${relevantArticles.length} relevant article(s) (of ${allArticles.length}):`);
    relevantArticles.forEach((a) => console.log(`    - ${a.title.slice(0, 70)} [${a.source}]`));

    // Try each relevant article until we get a valid result
    let result = null;
    let usedArticle = null;

    for (const article of relevantArticles.slice(0, 3)) {
      console.log(`  Fetching: ${article.link.slice(0, 70)}`);
      const articleText = await fetchArticleText(article.link);

      if (!articleText || articleText.length < 200) {
        console.log("  → Article text too short, trying next");
        continue;
      }

      console.log(`  Article: ${articleText.length} chars. Asking LLM...`);
      const llmResult = await extractTenderResult(articleText, tender.title || "");

      if (!llmResult || !llmResult.winners || !Array.isArray(llmResult.winners) || llmResult.winners.length === 0) {
        console.log("  → No winners found in this article, trying next");
        continue;
      }

      // Validate: winner company name should NOT be a generic/unrelated company
      // The article should be about THIS tender, not some random tender
      const winnerName = llmResult.winners[0]?.company || "";
      if (!winnerName || winnerName.length < 2) {
        console.log("  → Empty winner name, trying next");
        continue;
      }

      result = llmResult;
      usedArticle = article;
      break;
    }

    if (!result || !usedArticle) {
      console.log("  → No valid result from any article, skipping");
      continue;
    }

    // Display results
    console.log(`  Result summary: ${result.resultSummary || "-"}`);

    if (result.winners && Array.isArray(result.winners)) {
      console.log(`  Winners:`);
      for (const w of result.winners) {
        console.log(`    - ${w.company}: ${w.capacityMWh || "?"}MWh @ ${w.priceLakhsPerMW || w.priceRsPerKWh || "?"}`);
      }
    }

    // Fix bidders — ensure it's an array
    const bidders = Array.isArray(result.bidders) ? result.bidders : (typeof result.bidders === "string" ? [result.bidders] : []);
    if (bidders.length > 0) {
      console.log(`  All bidders: ${bidders.join(", ")}`);
    }

    if (result.developer) {
      console.log(`  Developer: ${result.developer}`);
    }

    // Update Firestore — tender
    const tenderUpdates = {};
    if (result.winners?.[0]?.company) {
      tenderUpdates.awardedTo = result.winners[0].company;
    }
    if (result.developer && result.developer !== "null") {
      tenderUpdates.developedBy = result.developer;
    }
    if (result.winners?.length > 0 && tenderUpdates.awardedTo) {
      tenderUpdates.tenderStatus = "awarded";
    }

    // Don't write if no real winner identified
    if (!tenderUpdates.awardedTo) {
      console.log("  → No clear winner, skipping Firestore update");
      continue;
    }

    tenderUpdates.lastUpdatedAt = Timestamp.now();

    if (Object.keys(tenderUpdates).length > 1) {
      await updateDoc(doc(db, "tenders", tender.nitNumber), tenderUpdates);
      console.log(`  → Tender updated: status=awarded, awardedTo=${tenderUpdates.awardedTo || "-"}`);
      updated++;
    }

    // Create Bid records for winners
    if (result.winners) {
      for (const w of result.winners) {
        if (!w.company) continue;
        const companyId = slugify(w.company);

        // Ensure company exists
        try {
          await setDoc(
            doc(db, "companies", companyId),
            {
              name: w.company,
              type: "Developer",
              bidsWon: 0,
              bidsLost: 0,
              totalCapacityMWh: 0,
              createdAt: Timestamp.now(),
            },
            { merge: true }
          );
        } catch { /* exists already */ }

        // Create bid record
        await addDoc(collection(db, "bids"), {
          companyId,
          companyName: w.company,
          tenderNit: tender.nitNumber,
          tenderName: tender.authority || tender.nitNumber,
          category: tender.category || null,
          capacityMWh: w.capacityMWh || null,
          priceStandalone: w.priceLakhsPerMW || null,
          priceFDRE: w.priceRsPerKWh || null,
          state: result.state || tender.state || null,
          result: "won",
          reference: article.link,
        });
        bidsCreated++;
        console.log(`  → Bid record: ${w.company} WON`);
      }
    }

    // Create bid records for losers (bidders who didn't win)
    if (bidders.length > 0 && result.winners) {
      const winnerNames = new Set(result.winners.map((w) => w.company?.toLowerCase()));
      for (const bidder of bidders) {
        if (winnerNames.has(bidder.toLowerCase())) continue;
        const companyId = slugify(bidder);

        try {
          await setDoc(
            doc(db, "companies", companyId),
            { name: bidder, type: "Developer", bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: Timestamp.now() },
            { merge: true }
          );
        } catch { /* exists */ }

        await addDoc(collection(db, "bids"), {
          companyId,
          companyName: bidder,
          tenderNit: tender.nitNumber,
          tenderName: tender.authority || tender.nitNumber,
          category: tender.category || null,
          capacityMWh: null,
          priceStandalone: null,
          priceFDRE: null,
          state: result.state || tender.state || null,
          result: "lost",
          reference: article.link,
        });
        bidsCreated++;
        console.log(`  → Bid record: ${bidder} LOST`);
      }
    }

    await new Promise((r) => setTimeout(r, 2000)); // rate limit
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done. Tenders updated: ${updated} | Bid records created: ${bidsCreated}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
