import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

const NTPC_URL = "https://ntpctender.ntpc.co.in";

const SEARCH_TERMS = [
  "bess",
  "battery energy storage",
  "energy storage",
  "MWh",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape NTPC tender portal using the keyword search form.
 * Form has: input#Keyword (keywords), hidden#Type (Live Tenders), button#btnSearch.
 * Table: S.No | Tender/NIT Ref | Tender Title | NIT Applicable For | Source Of NIT | Closing Date | Tender Details
 */
export async function scrapeNtpc() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map();

  try {
    for (const term of SEARCH_TERMS) {
      try {
        // Load the main page (has the search form)
        await page.goto(NTPC_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2000);

        // Dismiss any popup modal that blocks clicks
        await page.evaluate(() => {
          document.querySelectorAll(".modal.show, .modal.fade.show").forEach((m) => {
            m.classList.remove("show");
            m.style.display = "none";
          });
          document.querySelectorAll(".modal-backdrop").forEach((b) => b.remove());
          document.body.classList.remove("modal-open");
          document.body.style.overflow = "";
        });
        await page.waitForTimeout(500);

        // Fill keyword and submit
        const keywordInput = await page.$("#Keyword");
        if (!keywordInput) {
          console.log("[NTPC] Keyword field not found");
          break;
        }

        await keywordInput.fill(term);
        await page.waitForTimeout(500);

        // Submit the search form via JS (AJAX form — click alone doesn't navigate)
        await page.evaluate(() => {
          const form = document.querySelector("#Keyword")?.closest("form");
          if (form) form.submit();
        });

        // Wait for navigation and results
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Extract table rows
        const rows = await page.evaluate(() => {
          const results = [];
          document.querySelectorAll("table tbody tr, table tr").forEach((tr) => {
            const cells = tr.querySelectorAll("td");
            if (cells.length < 5) return;

            const cellTexts = Array.from(cells).map(
              (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
            );

            // Get the detail page link (pattern: /NITDetails/NITs/{id})
            const detailLink = tr.querySelector('a[href*="NITDetails/NITs"]');
            const detailUrl = detailLink ? detailLink.href : null;

            results.push({ cells: cellTexts, detailUrl });
          });
          return results;
        });

        for (const row of rows) {
          const cells = row.cells;
          // Try to find the right columns — NTPC table can have varying layouts
          // Expected: S.No | Tender/NIT Ref | Tender Title | ... | Source | Closing Date
          const sno = cells[0];

          // Skip header rows
          if (sno === "S.NO." || sno === "S.No." || sno === "S.NO") continue;

          const nitRef = (cells[1] || "").trim();
          // Title can be in column 2 or 3 (sometimes there's an empty column)
          const col2 = (cells[2] || "").trim();
          const col3 = (cells[3] || "").trim();
          const title = col3.length > col2.length ? col3 : col2 || col3;
          const source = cells.length > 4 ? (cells[4] || "").trim() : "NTPC";
          const closingDate = cells.length > 5 ? (cells[5] || "").trim() : "";

          if (!nitRef || nitRef.length < 3) continue;
          if (!title || title.length < 10) continue;

          // Post-filter with BESS keywords
          const fullText = `${title} ${nitRef}`.toLowerCase();
          const isBess = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
          if (!isBess) continue;

          if (!allTenders.has(nitRef)) {
            allTenders.set(nitRef, {
              nitNumber: nitRef,
              title,
              authority: source.includes("NTPC") ? "NTPC" : source || "NTPC",
              bidDeadline: closingDate || null,
              documentLink: null,
              detailUrl: row.detailUrl,
              sourceUrl: NTPC_URL,
              source: "NTPC",
            });
          }
        }

        console.log(`[NTPC] Search "${term}": ${rows.length} rows`);
        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`[NTPC] Search "${term}" failed: ${err.message}`);
      }
    }

    const tenders = Array.from(allTenders.values());

    // Navigate to detail page for each BESS tender to extract docs + extra fields
    for (const tender of tenders) {
      if (tender.detailUrl) {
        try {
          await page.waitForTimeout(2000);
          await extractDetailPage(page, tender);
        } catch (err) {
          console.log(`[NTPC] Detail failed for ${tender.nitNumber}: ${err.message}`);
        }
      }
    }

    console.log(`[NTPC] Found ${tenders.length} BESS tenders total`);
    return tenders;
  } finally {
    await browser.close();
  }
}

/**
 * Navigate to NTPC tender detail page and extract documents + extra fields.
 * Detail URL: /NITDetails/NITs/{id}
 * Fields: Source of NIT, State, NIT No., Description, Closing Date, Bid Opening Date, Contact Info
 * Documents: "NIT Download" PDF link at /Uploads/job_{id}.pdf
 */
async function extractDetailPage(page, tender) {
  await page.goto(tender.detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);

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

    // Get all document download links
    const documents = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      const name = a.textContent?.trim() || "";
      if (
        href.includes("/Uploads/") &&
        href.match(/\.(pdf|doc|xlsx?)$/i)
      ) {
        if (!documents.some((d) => d.url === href)) {
          documents.push({ name: name || href.split("/").pop(), url: href, uploadDate: null });
        }
      }
    });
    data._documents = documents;

    return data;
  });

  // Map to tender fields
  tender.description = details["Brief NIT Description"] || null;
  tender.location = details["State"] || tender.location;
  tender.detailUrl = tender.detailUrl; // keep as sourceUrl

  // Contact info
  const contact = details["Contact Information"] || "";
  const emailMatch = contact.match(/E-mail:\s*([\w.+-]+@[\w.-]+)/i);
  tender.contactEmail = emailMatch ? emailMatch[1] : null;

  // Dates
  const bidOpen = details["Bid Opening Date"];
  if (bidOpen) tender.techBidOpeningDate = bidOpen.split(" ")[0];

  // Documents
  const docs = details._documents || [];
  if (docs.length > 0) {
    tender.documents = docs;
    tender.documentLink = docs[0].url;
  }

  console.log(`[NTPC] Detail: ${tender.nitNumber} — ${docs.length} docs, state: ${tender.location || "-"}`);
}
