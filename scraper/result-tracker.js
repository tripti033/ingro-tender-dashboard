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
];

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

      const $ = cheerio.load(resp.data);

      // Extract article titles and links from search results
      $("article, .post, .entry, .search-result, h2 a, h3 a").each((_i, el) => {
        const linkEl = $(el).is("a") ? $(el) : $(el).find("a").first();
        const title = linkEl.text().trim() || $(el).find("h2, h3, .title").text().trim();
        const link = linkEl.attr("href");

        if (!title || title.length < 20 || !link) return;

        // Check if the article is about tender results/awards
        const titleLower = title.toLowerCase();
        const isResult = ["award", "won", "winner", "result", "select", "lowest", "l1", "bid price"].some(
          (kw) => titleLower.includes(kw)
        );

        if (isResult) {
          articles.push({ title, link, source: url.split("/")[2] });
        }
      });
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

    // Build search queries
    const queries = [];
    if (tender.authority && tender.powerMW) {
      queries.push(`${tender.authority} ${tender.powerMW}MW BESS tender result`);
      queries.push(`${tender.authority} ${tender.powerMW}MW battery storage winner`);
    }
    if (tender.nitNumber && !tender.nitNumber.startsWith("TDR-")) {
      queries.push(`${tender.nitNumber} tender result`);
    }
    if (tender.title) {
      // Use first key words from title
      const words = tender.title.split(/\s+/).slice(0, 6).join(" ");
      queries.push(`${words} tender result winner`);
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

    console.log(`  Found ${allArticles.length} result article(s):`);
    allArticles.forEach((a) => console.log(`    - ${a.title.slice(0, 70)} [${a.source}]`));

    // Fetch and process the best article (first one)
    const article = allArticles[0];
    console.log(`  Fetching: ${article.link.slice(0, 70)}`);
    const articleText = await fetchArticleText(article.link);

    if (!articleText || articleText.length < 200) {
      console.log("  → Article text too short, skipping");
      continue;
    }

    console.log(`  Article: ${articleText.length} chars. Asking LLM...`);

    const result = await extractTenderResult(articleText, tender.title || "");
    if (!result) {
      console.log("  → LLM returned null");
      continue;
    }

    // Display results
    console.log(`  Result summary: ${result.resultSummary || "-"}`);

    if (result.winners && result.winners.length > 0) {
      console.log(`  Winners:`);
      for (const w of result.winners) {
        console.log(`    - ${w.company}: ${w.capacityMWh || "?"}MWh @ ${w.priceLakhsPerMW || w.priceRsPerKWh || "?"}`);
      }
    }

    if (result.bidders && result.bidders.length > 0) {
      console.log(`  All bidders: ${result.bidders.join(", ")}`);
    }

    if (result.developer) {
      console.log(`  Developer: ${result.developer}`);
    }

    // Update Firestore — tender
    const tenderUpdates = {};
    if (result.winners?.[0]?.company) {
      tenderUpdates.awardedTo = result.winners[0].company;
    }
    if (result.developer) {
      tenderUpdates.developedBy = result.developer;
    }
    if (result.winners?.length > 0) {
      tenderUpdates.tenderStatus = "awarded";
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
    if (result.bidders && result.winners) {
      const winnerNames = new Set(result.winners.map((w) => w.company?.toLowerCase()));
      for (const bidder of result.bidders) {
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
