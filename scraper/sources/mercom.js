import RSSParser from "rss-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import { BESS_KEYWORDS } from "../keywords.js";

// Multiple RSS feeds and news sources for BESS industry alerts
const RSS_FEEDS = [
  { name: "Mercom", url: "https://mercomindia.com/feed/" },
  { name: "SaurEnergy", url: "https://www.saurenergy.com/solar-energy-news/feed" },
  { name: "PVMagazine", url: "https://www.pv-magazine-india.com/feed/" },
  { name: "ETEnergyWorld", url: "https://energy.economictimes.indiatimes.com/rss/topstories" },
];

// Mercom archive page for BESS-specific articles
const MERCOM_SEARCH_URL = "https://mercomindia.com/?s=battery+energy+storage";

// Known authorities to detect from titles
const KNOWN_AUTHORITIES = [
  "SECI", "NTPC", "GUVNL", "MSEDCL", "SJVNL", "TNGECL",
  "UJVNL", "NVVN", "RRVUNL", "DHBVN", "WBSEDCL", "MSETCL",
  "NHPC", "PGCIL", "POWERGRID", "MNRE", "CEA",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Check if text matches any BESS keyword (case-insensitive).
 */
function isBessRelated(text) {
  const lower = text.toLowerCase();
  return BESS_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Scrape multiple RSS feeds and Mercom search results for BESS alerts.
 */
export async function scrapeMercom() {
  const alerts = [];
  const seen = new Set();

  // 1. Scrape RSS feeds
  const parser = new RSSParser();
  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      for (const item of result.items) {
        const title = item.title || "";
        const description = item.contentSnippet || item.content || "";
        const fullText = `${title} ${description}`;

        if (!isBessRelated(fullText)) continue;

        const key = title.toLowerCase().slice(0, 60);
        if (seen.has(key)) continue;
        seen.add(key);

        // Parse MW and MWh from title
        const mwMatch = title.match(/(\d[\d,]*(?:\.\d+)?)\s*MW(?!h)/i);
        const mwhMatch = title.match(/(\d[\d,]*(?:\.\d+)?)\s*MWh/i);

        // Detect authority
        const authority =
          KNOWN_AUTHORITIES.find((auth) =>
            title.toUpperCase().includes(auth)
          ) || null;

        // Detect category
        let category = "Standalone";
        if (/fdre|firm/i.test(title)) category = "FDRE";
        else if (/solar/i.test(title) && /storage/i.test(title)) category = "S+S";
        else if (/pumped/i.test(title)) category = "PSP";
        else if (/hybrid/i.test(title)) category = "Hybrid";

        alerts.push({
          title,
          category,
          authority,
          powerMW: mwMatch ? parseFloat(mwMatch[1].replace(/,/g, "")) : null,
          energyMWh: mwhMatch ? parseFloat(mwhMatch[1].replace(/,/g, "")) : null,
          bidDeadline: item.pubDate || item.isoDate || null,
          sourceUrl: item.link || null,
          documentLink: item.link || null,
          source: feed.name,
        });
      }
      console.log(`[${feed.name}] RSS scanned — ${result.items.length} items`);
    } catch (err) {
      console.log(`[${feed.name}] RSS failed: ${err.message}`);
    }
  }

  // 2. Scrape Mercom search results page for more BESS articles
  try {
    const resp = await axios.get(MERCOM_SEARCH_URL, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 15000,
    });
    const $ = cheerio.load(resp.data);

    $("article, .post, .entry").each((_i, el) => {
      const titleEl = $(el).find("h2 a, h3 a, .entry-title a").first();
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || null;
      const dateText = $(el).find("time").attr("datetime") ||
        $(el).find(".date, .entry-date").text().trim() || null;

      if (!title || title.length < 15) return;
      if (!isBessRelated(title)) return;

      const key = title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return;
      seen.add(key);

      const mwMatch = title.match(/(\d[\d,]*(?:\.\d+)?)\s*MW(?!h)/i);
      const mwhMatch = title.match(/(\d[\d,]*(?:\.\d+)?)\s*MWh/i);
      const authority =
        KNOWN_AUTHORITIES.find((auth) => title.toUpperCase().includes(auth)) || null;

      alerts.push({
        title,
        category: "Standalone",
        authority,
        powerMW: mwMatch ? parseFloat(mwMatch[1].replace(/,/g, "")) : null,
        energyMWh: mwhMatch ? parseFloat(mwhMatch[1].replace(/,/g, "")) : null,
        bidDeadline: dateText,
        sourceUrl: link,
        documentLink: link,
        source: "Mercom",
      });
    });
    console.log(`[Mercom] Search page scraped`);
  } catch (err) {
    console.log(`[Mercom] Search page failed: ${err.message}`);
  }

  console.log(`[Alerts] Found ${alerts.length} BESS-related items total`);
  return alerts;
}
