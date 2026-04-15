import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://www.tenderdetail.com/Indian-tender/bess-tenders";

// Limit to first N pages (11 tenders/page). 10 pages = 110 latest BESS tenders.
// Full scrape of 697 would take ~64 pages which is too slow for every 3 hours.
const MAX_PAGES = 10;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape tenderdetail.com — aggregator site with 697 BESS tenders.
 * Free listing data (no login), uses axios + cheerio (SSR HTML).
 * Categorised by: tender title, authority type, city, state, due date, tender value, EMD, doc fees.
 */
export async function scrapeTenderDetail() {
  const allTenders = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    try {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?p=${pageNum}`;
      const response = await axios.get(url, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 30000,
      });

      const $ = cheerio.load(response.data);
      const cards = $(".tender_row");

      if (cards.length === 0) {
        console.log(`[TenderDetail] Page ${pageNum}: no more results, stopping`);
        break;
      }

      cards.each((_i, card) => {
        const $card = $(card);

        // Tender ID (internal tenderdetail ID)
        const tdrId = $card.find(".m-tender-id").text().trim();

        // Title link with NIT ref in title attribute
        const titleLink = $card.find("a.m-brief").first();
        const fullTitle = (titleLink.attr("title") || titleLink.text().trim()).replace(/\s+/g, " ");
        const detailUrl = titleLink.attr("href") || "";

        // Extract NIT ref — it's usually the first segment before " - "
        let nitNumber = null;
        let title = fullTitle;
        const dashMatch = fullTitle.match(/^([^-]+?-[^-]+?)\s*-\s*(.+)$/);
        if (dashMatch && dashMatch[1].length < 80) {
          nitNumber = dashMatch[1].trim();
          title = dashMatch[2].trim();
        }

        // Authority type + city + state from workDesc spans
        // Structure: <strong>TYPE <span>- city</span> <span>- state</span></strong>
        const workDesc = $card.find(".workDesc").first();
        const innerSpans = workDesc.find("span span");
        let city = "";
        let state = "";
        innerSpans.each((i, s) => {
          const text = $(s).text().trim().replace(/^-\s*/, "");
          if (i === 0) city = text;
          else if (i === 1) state = text;
        });

        // Authority type — strip the city/state spans from strong text
        const strongText = workDesc.find("strong").first().text().replace(/\s+/g, " ").trim();
        const authorityType = strongText.replace(/- \w[\w ]*- \w[\w ]*$/, "").replace(/-\s*\w[\w ]*\s*$/, "").trim() || strongText;

        // Full text with normalised whitespace for regex
        const cardText = $card.text().replace(/\s+/g, " ");

        // Due date
        const dueDateMatch = cardText.match(/Due Date\s*:\s*([A-Za-z]{3,}\s+\d{1,2},?\s*\d{4})/i);
        const dueDate = dueDateMatch ? dueDateMatch[1].trim() : null;

        // Tender value
        const valueMatch = cardText.match(/Tender Value\s*:\s*([\d,.]+\s*(?:Lakhs?|Crores?|Cr))/i);
        const tenderValueStr = valueMatch ? valueMatch[1].trim() : null;

        // Parse tender value to number
        let tenderValueINR = null;
        if (tenderValueStr && !tenderValueStr.toLowerCase().includes("ref")) {
          const numMatch = tenderValueStr.match(/([\d,]+\.?\d*)/);
          if (numMatch) {
            let val = parseFloat(numMatch[1].replace(/,/g, ""));
            if (/crore/i.test(tenderValueStr)) val *= 10000000;
            else if (/lakh/i.test(tenderValueStr)) val *= 100000;
            tenderValueINR = val;
          }
        }

        if (!title || title.length < 10) return;

        allTenders.push({
          nitNumber: nitNumber || `TDR-${tdrId}`,
          title,
          authority: authorityType || "TenderDetail",
          authorityType: authorityType || null,
          state: state || null,
          location: city && state ? `${city}, ${state}` : city || state || null,
          bidDeadline: dueDate,
          totalCost: tenderValueINR,
          documentLink: detailUrl || null,
          sourceUrl: detailUrl || url,
          source: "TenderDetail",
        });
      });

      // Small delay to be polite
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.log(`[TenderDetail] Page ${pageNum} failed: ${err.message}`);
    }
  }

  // Deduplicate within source by NIT number
  const seen = new Set();
  const unique = allTenders.filter((t) => {
    if (seen.has(t.nitNumber)) return false;
    seen.add(t.nitNumber);
    return true;
  });

  console.log(`[TenderDetail] Found ${unique.length} BESS tenders (scanned ${MAX_PAGES} pages)`);
  return unique;
}
