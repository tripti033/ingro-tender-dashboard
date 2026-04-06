import axios from "axios";
import * as cheerio from "cheerio";

const MSEDCL_URL = "https://www.mahadiscom.in/en/category/tenders/";

const BESS_KEYWORDS = [
  "bess",
  "battery energy storage",
  "battery storage",
  "energy storage",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape MSEDCL (Maharashtra State Electricity Distribution Co.) tender page.
 * Uses axios + cheerio since it's a WordPress site with no JS rendering needed.
 */
export async function scrapeMsedcl() {
  const response = await axios.get(MSEDCL_URL, {
    headers: { "User-Agent": USER_AGENT },
    timeout: 30000,
  });

  const $ = cheerio.load(response.data);
  const tenders = [];

  // WordPress category archive — posts listed as articles or in a list
  $("article, .post, .entry, .tender-item, tr, li").each((_i, el) => {
    const text = $(el).text().trim();
    const textLower = text.toLowerCase();

    // Check if this entry is BESS-related
    const isBESS = BESS_KEYWORDS.some((kw) => textLower.includes(kw));
    if (!isBESS) return;

    // Extract title from heading or link
    const titleEl = $(el).find("h2 a, h3 a, .entry-title a, a").first();
    const title = titleEl.text().trim() || text.slice(0, 200);
    const link = titleEl.attr("href") || null;

    // Extract date
    const dateEl = $(el).find("time, .date, .entry-date, .posted-on");
    const dateText =
      dateEl.attr("datetime") || dateEl.text().trim() || null;

    // Try to extract capacity from title/text
    const mwMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*MW(?!h)/i);
    const mwhMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*MWh/i);
    const powerMW = mwMatch
      ? parseFloat(mwMatch[1].replace(/,/g, ""))
      : null;
    const energyMWh = mwhMatch
      ? parseFloat(mwhMatch[1].replace(/,/g, ""))
      : null;

    tenders.push({
      nitNumber: null,
      title,
      authority: "MSEDCL",
      powerMW,
      energyMWh,
      bidDeadline: dateText,
      documentLink: link,
      sourceUrl: MSEDCL_URL,
      source: "MSEDCL",
    });
  });

  console.log(`[MSEDCL] Found ${tenders.length} BESS-related tenders`);
  return tenders;
}
