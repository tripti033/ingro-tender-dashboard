import RSSParser from "rss-parser";

const FEED_URL = "https://mercomindia.com/feed/";

// Keywords to filter BESS-related articles
const BESS_KEYWORDS = [
  "bess",
  "battery energy storage",
  "battery storage",
  "energy storage",
];

// Known authorities to detect from titles
const KNOWN_AUTHORITIES = [
  "SECI",
  "NTPC",
  "GUVNL",
  "MSEDCL",
  "SJVNL",
  "TNGECL",
  "UJVNL",
  "NVVN",
  "RRVUNL",
  "DHBVN",
  "WBSEDCL",
  "MSETCL",
];

/**
 * Scrape Mercom India RSS feed for BESS-related tender announcements.
 * Mercom provides partial data — many fields will be null.
 */
export async function scrapeMercom() {
  const parser = new RSSParser();
  const feed = await parser.parseURL(FEED_URL);

  const tenders = [];

  for (const item of feed.items) {
    const titleLower = (item.title || "").toLowerCase();

    // Filter: only keep items mentioning BESS keywords
    const isBESS = BESS_KEYWORDS.some((kw) => titleLower.includes(kw));
    if (!isBESS) continue;

    const title = item.title || "";

    // Parse MW and MWh from title — pattern like "500 MW/1000 MWh" or "500 MW / 1,000 MWh"
    const mwMatch = title.match(/(\d[\d,]*(?:\.\d+)?)\s*MW(?!h)/i);
    const mwhMatch = title.match(/(\d[\d,]*(?:\.\d+)?)\s*MWh/i);
    const powerMW = mwMatch
      ? parseFloat(mwMatch[1].replace(/,/g, ""))
      : null;
    const energyMWh = mwhMatch
      ? parseFloat(mwhMatch[1].replace(/,/g, ""))
      : null;

    // Detect authority from title
    const authority =
      KNOWN_AUTHORITIES.find((auth) =>
        title.toUpperCase().includes(auth)
      ) || null;

    // Detect category from title
    let category = "Standalone";
    if (/fdre|firm/i.test(title)) category = "FDRE";
    else if (/solar/i.test(title) && /storage/i.test(title))
      category = "S+S";
    else if (/pumped/i.test(title)) category = "PSP";
    else if (/hybrid/i.test(title)) category = "Hybrid";

    tenders.push({
      nitNumber: null, // Mercom rarely has NIT numbers
      title,
      category,
      authority,
      powerMW,
      energyMWh,
      bidDeadline: item.pubDate || item.isoDate || null,
      sourceUrl: item.link || null,
      documentLink: item.link || null,
      source: "Mercom",
    });
  }

  console.log(`[Mercom] Found ${tenders.length} BESS-related items`);
  return tenders;
}
