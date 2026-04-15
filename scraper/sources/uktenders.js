import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

const UKTENDERS_URL = "https://uktenders.gov.in/nicgep/app";

const SEARCH_TERMS = [
  "BESS",
  "battery energy storage",
  "energy storage",
  "battery storage",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape uktenders.gov.in (Uttarakhand State Tender Portal) for BESS tenders.
 * Uses the homepage SearchDescription quick-search which does NOT require CAPTCHA.
 * Then clicks into each result to extract detail page data.
 */
export async function scrapeUktenders() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map();

  try {
    for (const term of SEARCH_TERMS) {
      try {
        await page.goto(UKTENDERS_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2000);

        // Fill the homepage search field
        const searchInput = await page.$("#SearchDescription");
        if (!searchInput) {
          console.log("[uktenders] SearchDescription field not found");
          break;
        }

        await searchInput.fill(term);
        await page.waitForTimeout(500);

        // Click Go with force (results load inline, URL doesn't change)
        const goBtn = await page.$("#Go");
        if (goBtn) {
          await goBtn.click({ force: true });
        } else {
          await searchInput.press("Enter");
        }

        await page.waitForTimeout(5000);

        // Extract result rows — find the table with the correct header row
        // Columns: S.No | e-Published Date | Closing Date | Opening Date | Title/Ref/TenderID | Organisation
        const rows = await page.evaluate(() => {
          const results = [];

          // Find rows that look like data rows (exactly 6 cells, S.No like "1." or "1")
          document.querySelectorAll("table tr").forEach((tr) => {
            const cells = tr.querySelectorAll("td");
            if (cells.length !== 6) return;

            const cellTexts = Array.from(cells).map(
              (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
            );

            // S.No format: "1.", "2.", "10." etc. (numbers with optional dot)
            if (!/^\d+\.?$/.test(cellTexts[0])) return;

            // Skip header row
            if (cellTexts[1] === "e-Published Date") return;

            // Get the title link — it's an anchor inside the title cell
            const titleCell = cells[4];
            const titleLink = titleCell?.querySelector('a[href*="DirectLink"]');
            const detailUrl = titleLink ? titleLink.href : null;

            results.push({ cells: cellTexts, detailUrl });
          });
          return results;
        });

        for (const row of rows) {
          const cells = row.cells;
          if (cells.length < 6) continue;

          const pubDate = cells[1] || "";
          const closingDate = cells[2] || "";
          const openingDate = cells[3] || "";
          const titleRefCell = cells[4] || "";
          const orgChain = cells[5] || "";

          if (!titleRefCell || titleRefCell.length < 10) continue;

          // Format: "[Title text] [ref-no] [tender-id]"
          // Extract bracketed sections
          const brackets = titleRefCell.match(/\[([^\]]+)\]/g) || [];
          let title = "";
          let nitNumber = null;

          if (brackets.length >= 1) {
            title = brackets[0].replace(/^\[|\]$/g, "").trim();
          }
          if (brackets.length >= 3) {
            // Last bracket is usually the tender ID
            nitNumber = brackets[brackets.length - 1].replace(/^\[|\]$/g, "").trim();
          } else if (brackets.length === 2) {
            nitNumber = brackets[1].replace(/^\[|\]$/g, "").trim();
          }

          if (!title) title = titleRefCell.replace(/\[|\]/g, "").trim();

          if (!title || title.length < 10) continue;

          // Post-filter with BESS keywords (should already match but double-check)
          const fullText = `${title} ${titleRefCell}`.toLowerCase();
          const isBess = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
          if (!isBess) continue;

          // Detect authority from org chain
          let authority = "UPCL"; // Uttarakhand Power Corporation Limited — most BESS tenders
          if (orgChain.toUpperCase().includes("UJVNL")) authority = "UJVNL";
          else if (orgChain.toUpperCase().includes("PTCUL")) authority = "PTCUL";
          else if (orgChain.toUpperCase().includes("UPCL")) authority = "UPCL";

          const key = nitNumber || title.slice(0, 60);
          if (!allTenders.has(key)) {
            allTenders.set(key, {
              nitNumber,
              title,
              authority,
              state: "Uttarakhand",
              location: "Uttarakhand",
              bidDeadline: closingDate || null,
              techBidOpeningDate: openingDate || null,
              documentLink: null,
              detailUrl: row.detailUrl,
              sourceUrl: row.detailUrl || UKTENDERS_URL,
              source: "uktenders",
              orgChain,
              pubDate,
            });
          }
        }

        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`[uktenders] Search "${term}" failed: ${err.message}`);
      }
    }

    const tenders = Array.from(allTenders.values());
    console.log(`[uktenders] Found ${tenders.length} BESS tenders`);

    // Try to extract detail page data for each tender
    for (const tender of tenders) {
      if (tender.detailUrl) {
        try {
          await page.waitForTimeout(2000);
          await extractDetailPage(page, tender);
        } catch (err) {
          console.log(`[uktenders] Detail failed for ${tender.nitNumber}: ${err.message}`);
        }
      }
    }

    return tenders;
  } finally {
    await browser.close();
  }
}

/**
 * Navigate to uktenders detail page and extract structured data.
 * Detail page has: Basic Details, Payment Instruments, Tender Fee, EMD Details,
 * Work Item Details, Critical Dates, Tender Documents.
 */
async function extractDetailPage(page, tender) {
  await page.goto(tender.detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  const details = await page.evaluate(() => {
    const data = {};

    // Extract label:value pairs from all tables
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td");
      for (let i = 0; i < cells.length - 1; i += 2) {
        const label = cells[i]?.textContent?.trim().replace(/\s+/g, " ").replace(/:$/, "") || "";
        const value = cells[i + 1]?.textContent?.trim().replace(/\s+/g, " ") || "";
        if (label && value && label.length < 80) data[label] = value;
      }
    });

    // Get all document download links (PDFs)
    const documents = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      const name = a.textContent?.trim() || "";
      if (
        href.match(/\.(pdf|doc|xlsx?|zip)$/i) ||
        href.includes("downloadFile") ||
        href.includes("showDocument")
      ) {
        if (!documents.some((d) => d.url === href) && name.length < 200) {
          documents.push({ name: name || href.split("/").pop(), url: href, uploadDate: null });
        }
      }
    });
    data._documents = documents;

    return data;
  });

  // Map fields
  tender.description = details["Title"] || details["Work Description"] || null;

  // Financial
  const tenderFee = details["Tender Fee in \u20B9"] || details["Tender Fee"] || null;
  if (tenderFee) {
    const match = tenderFee.match(/([\d,]+)/);
    if (match) tender.tenderProcessingFee = parseFloat(match[1].replace(/,/g, ""));
  }

  const emdAmount = details["EMD Amount in \u20B9"] || details["EMD Amount"] || null;
  if (emdAmount) {
    const match = emdAmount.match(/([\d,]+)/);
    if (match) {
      tender.emdAmount = parseFloat(match[1].replace(/,/g, ""));
      tender.emdUnit = "INR";
    }
  }

  // Product category
  tender.category = details["Product Category"] || tender.category;

  // Contract type / tender type
  tender.tenderMode = details["Contract Type"] || details["Tender Type"] || tender.tenderMode;

  // Location from pincode/location
  tender.location = details["Location"] || tender.location;

  // Dates
  const pubDate = details["Published Date"];
  if (pubDate) tender.pubDate = pubDate;

  const preBid = details["Pre Bid Meeting Date"];
  if (preBid && preBid !== "NA") tender.preBidDate = preBid.split(" ")[0];

  const bidSubmissionEnd = details["Bid Submission End Date"];
  if (bidSubmissionEnd) tender.bidDeadline = bidSubmissionEnd;

  const bidOpening = details["Bid Opening Date"];
  if (bidOpening) tender.techBidOpeningDate = bidOpening;

  // Documents
  const docs = details._documents || [];
  if (docs.length > 0) {
    tender.documents = docs;
    tender.documentLink = docs[0].url;
  }

  console.log(
    `[uktenders] Detail: ${tender.nitNumber || tender.title.slice(0, 40)} — ${docs.length} docs, EMD: ${tender.emdAmount || "-"}`
  );
}
