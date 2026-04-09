import { chromium } from "playwright";

const SECI_URL = "https://www.seci.co.in/view/publish/tender?tender=all";

import { BESS_KEYWORDS } from "../keywords.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape SECI (Solar Energy Corporation of India) tender portal.
 * SECI is a JS SPA — we intercept API/XHR responses and also
 * try multiple wait strategies to capture rendered content.
 */
export async function scrapeSeci() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  // Collect API responses that may contain tender data
  const apiResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (
      response.request().resourceType() === "xhr" ||
      response.request().resourceType() === "fetch" ||
      url.includes("tender") ||
      url.includes("api")
    ) {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("json")) {
          const json = await response.json();
          apiResponses.push({ url, data: json });
        }
      } catch {
        // Not JSON or already consumed — skip
      }
    }
  });

  try {
    await page.goto(SECI_URL, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    // Wait for any of these selectors that might hold tender data
    await page
      .waitForSelector(
        "table tbody tr, .tender-list, .card, [class*='tender'], [class*='list']",
        { timeout: 20000 }
      )
      .catch(() => {});

    // Extra wait for late-rendering SPAs
    await page.waitForTimeout(5000);

    // Strategy 1: Extract from rendered DOM (tables, lists, cards)
    const domTenders = await page.evaluate(() => {
      const results = [];

      // Tables
      document.querySelectorAll("table").forEach((table) => {
        table.querySelectorAll("tbody tr, tr").forEach((tr) => {
          const cells = tr.querySelectorAll("td");
          if (cells.length < 2) return;
          const cellTexts = Array.from(cells).map(
            (c) => c.textContent?.trim() || ""
          );
          const link =
            Array.from(tr.querySelectorAll("a[href]"))
              .map((a) => a.href)
              .find(
                (h) =>
                  h.includes(".pdf") ||
                  h.includes("download") ||
                  h.includes("document") ||
                  h.includes("tender")
              ) || null;
          results.push({ cells: cellTexts, docLink: link });
        });
      });

      // Cards / divs that might hold tender info
      document
        .querySelectorAll(
          ".card, [class*='tender'], [class*='list-item'], article"
        )
        .forEach((el) => {
          const text = el.textContent?.trim() || "";
          if (text.length > 20) {
            const link = el.querySelector("a[href]")?.href || null;
            results.push({ cells: [text], docLink: link });
          }
        });

      return results;
    });

    // Strategy 2: Parse tenders from intercepted API responses
    const apiTenders = [];
    for (const resp of apiResponses) {
      const items = extractTendersFromJson(resp.data);
      apiTenders.push(...items);
    }

    // Combine both strategies
    const allRows = [...domTenders, ...apiTenders];
    const tenders = [];

    for (const row of allRows) {
      const fullText = (row.cells || []).join(" ").toLowerCase();

      const isBESS = BESS_KEYWORDS.some((kw) => fullText.includes(kw));
      if (!isBESS) continue;

      // Extract NIT number
      const cellText = (row.cells || []).join(" ");
      const nitMatch = cellText.match(
        /(?:NIT|SECI|Tender)\s*(?:No\.?|#)?\s*[:.]?\s*([\w/\-. ]+\d[\w/\-. ]*)/i
      );
      const nitNumber = nitMatch ? nitMatch[1].trim() : null;

      const title = row.title ||
        (row.cells || []).reduce(
          (a, b) => (a.length > b.length ? a : b),
          ""
        ) ||
        "";

      // Extract closing date
      const dateMatch = cellText.match(
        /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/
      );

      tenders.push({
        nitNumber,
        title,
        authority: "SECI",
        bidDeadline: row.bidDeadline || (dateMatch ? dateMatch[1] : null),
        documentLink: row.docLink || null,
        sourceUrl: SECI_URL,
        source: "SECI",
      });
    }

    console.log(
      `[SECI] Found ${tenders.length} BESS tenders (DOM: ${domTenders.length} rows, API: ${apiTenders.length} items intercepted)`
    );
    return tenders;
  } finally {
    await browser.close();
  }
}

/**
 * Recursively extract tender-like objects from a JSON API response.
 * Looks for arrays of objects with title/name/description fields.
 */
function extractTendersFromJson(data) {
  const results = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const text =
          item.title ||
          item.name ||
          item.tender_title ||
          item.tenderTitle ||
          item.description ||
          "";
        if (text) {
          results.push({
            cells: [
              item.nit_no || item.nitNo || item.tender_no || "",
              text,
              item.closing_date || item.closingDate || item.deadline || "",
            ],
            title: text,
            bidDeadline:
              item.closing_date ||
              item.closingDate ||
              item.deadline ||
              item.bid_deadline ||
              null,
            docLink:
              item.document_link ||
              item.documentLink ||
              item.pdf_link ||
              item.link ||
              null,
          });
        }
      }
    }
  } else if (data && typeof data === "object") {
    // Check nested keys that commonly hold arrays
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        results.push(...extractTendersFromJson(data[key]));
      }
    }
  }

  return results;
}
