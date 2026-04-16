import axios from "axios";
import * as cheerio from "cheerio";
import { BESS_KEYWORDS } from "../keywords.js";

const NGEL_URL = "https://ngel.in/tender";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape NGEL (NTPC Green Energy Limited) tender page.
 * Simple server-rendered HTML table, no JS needed.
 * Table: Sr.No | Tender No | Description | Start Date | End Date | Bid Opening Date | Remarks (NIT PDF link)
 */
export async function scrapeNgel() {
  const response = await axios.get(NGEL_URL, {
    headers: { "User-Agent": USER_AGENT },
    timeout: 30000,
  });

  const $ = cheerio.load(response.data);
  const tenders = [];

  $("#myTable tbody tr").each((_i, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 6) return;

    const tenderNo = $(cells[1]).text().trim();
    const description = $(cells[2]).text().trim();
    const startDate = $(cells[3]).text().trim();
    const endDate = $(cells[4]).text().trim();
    const bidOpeningDate = $(cells[5]).text().trim();

    // Get NIT PDF link from Remarks column
    const nitLink = $(cells[6]).find("a[href]").attr("href") || null;
    const docUrl = nitLink && nitLink.startsWith("http") ? nitLink : nitLink ? `https://ngel.in${nitLink}` : null;

    if (!tenderNo || !description) return;

    // Filter by BESS keywords
    const fullText = `${tenderNo} ${description}`.toLowerCase();
    const isBess = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
    if (!isBess) return;

    tenders.push({
      nitNumber: tenderNo,
      title: description,
      authority: "NGEL",
      bidDeadline: endDate || null,
      techBidOpeningDate: bidOpeningDate || null,
      documentLink: docUrl,
      documents: docUrl ? [{ name: "NIT Document", url: docUrl, uploadDate: startDate }] : null,
      sourceUrl: NGEL_URL,
      detailUrl: NGEL_URL,
      source: "NGEL",
      state: null,
      location: null,
    });

    // Extract state/location from description
    const stateMatch = description.match(/(?:AT|IN)\s+([A-Z][A-Za-z\s,]+?)(?:\.|$)/);
    if (stateMatch) {
      const loc = stateMatch[1].trim();
      tenders[tenders.length - 1].location = loc;
      // Extract state from location
      const states = ["Uttar Pradesh", "U.P", "Rajasthan", "Karnataka", "Madhya Pradesh", "Gujarat", "Maharashtra", "Tamil Nadu", "Uttarakhand", "Himachal Pradesh", "Punjab", "Haryana", "Kerala", "Odisha", "Telangana", "Andhra Pradesh"];
      for (const s of states) {
        if (loc.toUpperCase().includes(s.toUpperCase()) || description.toUpperCase().includes(s.toUpperCase())) {
          tenders[tenders.length - 1].state = s;
          break;
        }
      }
    }
  });

  console.log(`[NGEL] Found ${tenders.length} BESS tenders out of ${$("#myTable tbody tr").length} total`);
  return tenders;
}
