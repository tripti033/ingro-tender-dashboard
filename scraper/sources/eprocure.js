import { chromium } from "playwright";

const EPROCURE_URL = "https://eprocure.gov.in/eprocure/app";

// Multiple search terms to maximize coverage
const SEARCH_TERMS = [
  "battery energy storage",
  "BESS",
  "energy storage system",
  "battery storage",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Minimum title length to filter out nav/junk rows
const MIN_TITLE_LENGTH = 30;

// Words that indicate a row is navigation, not a tender
const JUNK_PATTERNS = [
  /^screen reader/i,
  /^search$/i,
  /^active tenders$/i,
  /^tenders by/i,
  /^corrigendum$/i,
  /^mis reports/i,
  /^bid awards/i,
  /^home$/i,
  /^help$/i,
  /^contact/i,
  /^sitemap/i,
  /^login/i,
];

/**
 * Scrape eProcure (Central Public Procurement Portal) for BESS tenders.
 * Uses the homepage SearchDescription field which does NOT require CAPTCHA.
 */
export async function scrapeEprocure() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const allTenders = new Map();

  try {
    for (const term of SEARCH_TERMS) {
      try {
        await page.goto(EPROCURE_URL, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);

        const searchInput = await page.$("#SearchDescription");
        if (!searchInput) break;

        await searchInput.fill(term);
        await page.waitForTimeout(500);

        const submitBtn = await page.$("#Go");
        if (submitBtn) {
          await submitBtn.click();
        } else {
          await searchInput.press("Enter");
        }

        await page.waitForTimeout(3000);

        // Extract rows — look specifically for the Tender List table
        // which has columns: S.No | e-Published Date | Closing Date | Opening Date | Title and Ref.No./Tender ID | Organisation Chain
        const rows = await page.evaluate(() => {
          const results = [];
          const tables = document.querySelectorAll("table");

          for (const table of tables) {
            const trs = table.querySelectorAll("tr");
            let isResultTable = false;

            for (const tr of trs) {
              const cells = tr.querySelectorAll("td");
              const ths = tr.querySelectorAll("th, td.list_header");

              // Detect if this is the header row of the results table
              const headerText = Array.from(ths.length > 0 ? ths : cells)
                .map((c) => c.textContent?.trim() || "")
                .join(" ");
              if (
                headerText.includes("e-Published Date") &&
                headerText.includes("Closing Date")
              ) {
                isResultTable = true;
                continue;
              }

              if (!isResultTable || cells.length < 5) continue;

              const cellTexts = Array.from(cells).map(
                (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
              );

              // S.No should be a number
              const sno = cellTexts[0];
              if (!/^\d+$/.test(sno)) continue;

              const links = tr.querySelectorAll("a[href]");
              const docLink =
                Array.from(links)
                  .map((a) => a.href)
                  .find(
                    (h) =>
                      h.includes("tender") ||
                      h.includes("View") ||
                      h.includes(".pdf")
                  ) || null;

              results.push({ cells: cellTexts, docLink });
            }
          }
          return results;
        });

        for (const row of rows) {
          const cells = row.cells;

          // Column layout: [0]=S.No [1]=e-Published Date [2]=Closing Date [3]=Opening Date [4]=Title+Ref [5]=Org Chain
          const titleRefCell = cells[4] || "";
          const orgChain = cells[5] || "";
          const closingDate = cells[2] || null;

          // Skip junk
          if (titleRefCell.length < MIN_TITLE_LENGTH) continue;
          if (JUNK_PATTERNS.some((p) => p.test(titleRefCell))) continue;
          if (titleRefCell.includes("No Tenders found")) continue;

          // Extract tender ID from the title+ref cell
          const nitMatch = titleRefCell.match(
            /(?:Tender\s*ID|Ref\.?\s*No\.?|NIT)\s*[:.]?\s*([\w/\-. ]+\d[\w/\-. ]*)/i
          );
          const nitNumber = nitMatch ? nitMatch[1].trim() : null;

          // Clean title — remove the ref/ID portion
          let title = titleRefCell;
          if (nitMatch) {
            title = titleRefCell.replace(nitMatch[0], "").trim();
          }
          // Remove leading/trailing junk characters
          title = title.replace(/^[\s|,.-]+|[\s|,.-]+$/g, "").trim();

          if (!title || title.length < 15) continue;

          // Detect authority from org chain
          let authority = "eProcure";
          const knownAuthorities = [
            "SECI", "NTPC", "GUVNL", "MSEDCL", "SJVNL",
            "NHPC", "PGCIL", "POWERGRID", "MNRE", "CEA",
          ];
          for (const auth of knownAuthorities) {
            if (orgChain.toUpperCase().includes(auth)) {
              authority = auth;
              break;
            }
          }

          const key = nitNumber || title.slice(0, 60);
          if (!allTenders.has(key)) {
            allTenders.set(key, {
              nitNumber,
              title,
              authority,
              bidDeadline: closingDate,
              documentLink: row.docLink,
              sourceUrl: EPROCURE_URL,
              source: "eProcure",
            });
          }
        }

        await page.waitForTimeout(2000);
      } catch (err) {
        console.log(`[eProcure] Search "${term}" failed: ${err.message}`);
      }
    }

    const tenders = Array.from(allTenders.values());
    console.log(
      `[eProcure] Found ${tenders.length} BESS tenders (searched ${SEARCH_TERMS.length} terms)`
    );
    return tenders;
  } finally {
    await browser.close();
  }
}
