import axios from "axios";
import * as cheerio from "cheerio";
import { BESS_KEYWORDS } from "../keywords.js";

const UJVNL_URL = "https://ujvnl.com/view-tenders";
const UJVNL_ARCHIVE = "https://ujvnl.com/view-tenders?type=archive";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Parse the main tender table from UJVNL's static HTML page.
 * Column order (column 5 is an HTML-commented placeholder — skipped):
 *   S.No | <a>NIT</a> | UploadDate | ClosingDate | Circle | Address | Classification | Description | <a>Downloads</a>
 */
function parseTenderTable(html, sourceUrl) {
  const $ = cheerio.load(html);
  const tenders = [];

  $("table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 8) return; // header or malformed row

    const nitLink = $(cells[1]).find("a").first();
    const nit = nitLink.text().trim();
    const pdfHref = nitLink.attr("href") || null;
    if (!nit) return;

    const uploadDate = $(cells[2]).text().trim();
    const closingDate = $(cells[3]).text().trim();
    // cells[4] is the circle field (their HTML has a commented-out date col before it)
    const circle = $(cells[4]).text().trim();
    const address = $(cells[5]).text().trim();
    const classification = $(cells[6]).text().trim();
    const description = $(cells[7]).text().trim();
    const downloadLink = $(cells[8]).find("a").first().attr("href") || null;

    // UJVNL mostly posts small civil / hydro / maintenance work. Filter hard
    // for real BESS tenders — match against the strong BESS keywords only,
    // not loose ones like "mwh" or "storage" (they catch water tanks).
    const strongKeywords = BESS_KEYWORDS.filter((kw) =>
      kw.includes("bess") ||
      kw.includes("battery energy") ||
      kw.includes("battery storage") ||
      kw.includes("energy storage system") ||
      kw.includes("lithium") ||
      kw.includes("pumped storage") ||
      kw.includes("fdre")
    );
    const fullText = `${description} ${classification} ${circle}`.toLowerCase();
    const isBESS = strongKeywords.some((kw) => fullText.includes(kw));
    if (!isBESS) return;

    // Parse dates (DD-MM-YYYY → Date)
    const toDate = (s) => {
      const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!m) return null;
      const d = new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+05:30`);
      return isNaN(+d) ? null : d;
    };

    // Capacity hints
    const mwMatch = description.match(/(\d[\d,.]*)\s*MW(?!h)/i);
    const mwhMatch = description.match(/(\d[\d,.]*)\s*MWh/i);

    // Resolve download link to absolute
    let absDownloadLink = null;
    if (downloadLink) {
      absDownloadLink = downloadLink.startsWith("http")
        ? downloadLink
        : `https://ujvnl.com${downloadLink.startsWith("/") ? "" : "/"}${downloadLink}`;
    }

    tenders.push({
      nitNumber: nit,
      title: description.slice(0, 300),
      authority: "UJVNL",
      authorityType: "State Utility",
      state: "Uttarakhand",
      location: circle || null,
      powerMW: mwMatch ? parseFloat(mwMatch[1].replace(/,/g, "")) : null,
      energyMWh: mwhMatch ? parseFloat(mwhMatch[1].replace(/,/g, "")) : null,
      bidDeadline: toDate(closingDate),
      preBidDate: toDate(uploadDate),
      documentLink: pdfHref || absDownloadLink,
      sourceUrl,
      source: "UJVNL",
    });
  });

  return tenders;
}

async function fetchPage(url) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 45000,
    });
    return resp.data;
  } catch (err) {
    console.log(`[UJVNL] Fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Scrape UJVNL (Uttarakhand Jal Vidyut Nigam) tender portal.
 * Static HTML — no Playwright needed. Hits both the live listing and
 * the archive so historically-issued BESS tenders (T-04/T-05/T-06 etc.)
 * are caught even after their closing date.
 */
export async function scrapeUjvnl() {
  const all = [];
  for (const url of [UJVNL_URL, UJVNL_ARCHIVE]) {
    const html = await fetchPage(url);
    if (!html) continue;
    const t = parseTenderTable(html, url);
    all.push(...t);
  }
  // Dedup by NIT in case live + archive both list the same row
  const seen = new Map();
  for (const t of all) if (!seen.has(t.nitNumber)) seen.set(t.nitNumber, t);
  const deduped = [...seen.values()];
  console.log(`[UJVNL] Found ${deduped.length} BESS-related tenders`);
  return deduped;
}
