import axios from "axios";
import * as cheerio from "cheerio";
import { BESS_KEYWORDS } from "../keywords.js";

const MEDA_URL = "https://www.mahaurja.maharashtra.gov.in/Site/1607/Tenders-Or-EOI";
const MEDA_BASE = "https://www.mahaurja.maharashtra.gov.in";
// Culture switch endpoint sets a session cookie that makes the server render
// all subsequent pages in English. Without this, the HTML comes back Marathi-only.
const MEDA_CULTURE_EN = "https://www.mahaurja.maharashtra.gov.in/HeaderMain/ChangeCurrentCulture/1";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// MEDA-specific English terms beyond the global BESS keyword list.
// MEDA uses "lithium ferro phosphate battery bank", "LiFePO4 BMS",
// "battery backup" etc. for small off-grid solar+storage installations.
const BESS_KEYWORDS_MEDA_EN = [
  "lithium ferro",
  "lifepo4",
  "lifepo",
  "battery bank",
  "battery backup",
];

// Marathi fallback — if the English switch fails, still catch BESS tenders.
const BESS_KEYWORDS_MR = [
  "बॅटरी",          // battery
  "लिथियम",         // lithium
  "ऊर्जा साठवण",   // energy storage
  "साठवण प्रणाली", // storage system
  "बीएमएस",         // BMS
  "पंप स्टोरेज",   // pumped storage
  "पंप्ड स्टोरेज", // pumped storage (alt)
  "एमडब्ल्यूएच",   // MWh (transliterated)
];

/**
 * Scrape MEDA (Maharashtra Energy Development Agency) tenders page.
 *
 * Server renders Marathi by default. We hit the culture-switch endpoint
 * first to get a session cookie that flips output to English, then fetch
 * the tenders table with that cookie.
 *
 * Static HTML so axios + cheerio is sufficient — no Playwright needed.
 */
export async function scrapeMeda() {
  // Step 1 — establish an English-language session
  const cultureResp = await axios.get(MEDA_CULTURE_EN, {
    headers: { "User-Agent": USER_AGENT },
    timeout: 30000,
    maxRedirects: 0,
    validateStatus: (s) => s < 500, // accept 302/redirects
  });
  const setCookies = cultureResp.headers["set-cookie"] || [];
  const cookieHeader = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  // Step 2 — fetch tenders with the English-session cookie
  const response = await axios.get(MEDA_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    timeout: 45000,
  });

  const $ = cheerio.load(response.data);
  const tenders = [];
  const seenNits = new Set();

  $("table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return; // header or malformed row

    const particulars = $(cells[0]).text().replace(/\s+/g, " ").trim();
    const detailsCell = $(cells[1]);
    if (!particulars) return;

    // BESS filter — match global BESS terms, MEDA-specific English, or Marathi
    const particularsLower = particulars.toLowerCase();
    const isBESS =
      BESS_KEYWORDS.some((kw) => particularsLower.includes(kw)) ||
      BESS_KEYWORDS_MEDA_EN.some((kw) => particularsLower.includes(kw)) ||
      BESS_KEYWORDS_MR.some((kw) => particulars.includes(kw));
    if (!isBESS) return;

    // First PDF link in Details cell (language-independent, has NIT in filename)
    const docLink = detailsCell
      .find("a[href]")
      .map((_j, a) => $(a).attr("href"))
      .get()
      .find((h) => h && !h.startsWith("#") && !h.startsWith("javascript:")) || null;

    // Extract NIT — prefer PDF filename (e.g. 2026_MEDA_1293598_1.pdf),
    // fall back to inline pattern in particulars text.
    let nitNumber = null;
    if (docLink) {
      const fileMatch = docLink.match(/\/([^/]+?)\.pdf\b/i);
      if (fileMatch) nitNumber = fileMatch[1];
    }
    if (!nitNumber) {
      const inline = particulars.match(/\b(\d{4}_MEDA_\d+_\d+)\b/i);
      if (inline) nitNumber = inline[1];
    }
    if (!nitNumber || seenNits.has(nitNumber)) return;
    seenNits.add(nitNumber);

    const documentLink = docLink
      ? (docLink.startsWith("http") ? docLink : `${MEDA_BASE}${docLink.startsWith("/") ? "" : "/"}${docLink}`)
      : null;

    // Capacity hints — MEDA uses MW/MWh for large tenders and kW/kWp for
    // small off-grid installs; convert kW/kWp to MW for uniformity.
    const mwMatch = particulars.match(/(\d[\d,]*(?:\.\d+)?)\s*MW(?!h)/i);
    const mwhMatch = particulars.match(/(\d[\d,]*(?:\.\d+)?)\s*MWh/i);
    const kwMatch = !mwMatch ? particulars.match(/(\d[\d,]*(?:\.\d+)?)\s*k[wW]p?\b/) : null;
    const powerMW = mwMatch
      ? parseFloat(mwMatch[1].replace(/,/g, ""))
      : kwMatch ? parseFloat(kwMatch[1].replace(/,/g, "")) / 1000 : null;
    const energyMWh = mwhMatch ? parseFloat(mwhMatch[1].replace(/,/g, "")) : null;

    tenders.push({
      nitNumber,
      title: particulars.slice(0, 300),
      authority: "MEDA",
      state: "Maharashtra",
      powerMW,
      energyMWh,
      bidDeadline: null,
      documentLink,
      sourceUrl: MEDA_URL,
      source: "MEDA",
    });
  });

  console.log(`[MEDA] Found ${tenders.length} BESS-related tenders`);
  return tenders;
}
