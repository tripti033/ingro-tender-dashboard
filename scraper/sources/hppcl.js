import { chromium } from "playwright";
import { BESS_KEYWORDS } from "../keywords.js";

const HPPCL_URL = "https://www.hppcl.in/content/650_1_tender.aspx";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Scrape HPPCL (Himachal Pradesh Power Corporation) tender portal.
 * ASP.NET site with postback-based detail pages. Listing has ~10 tenders.
 * Table: S.No | Tender Ref | Title | Start Date | End Date | Extended Date
 * Detail fields: Estimated Cost, EMD, Publication Date, Expiry Date, Contact, Email, PDF link
 */
export async function scrapeHppcl() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const tenders = [];

  try {
    await page.goto(HPPCL_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    // Try to set page size to 30 to get all tenders
    try {
      const dropdown = await page.$("#cphmain_ddlPageSize");
      if (dropdown) {
        await dropdown.selectOption("30");
        await page.waitForTimeout(3000);
      }
    } catch { /* ignore */ }

    // Extract all listing rows
    const rows = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("table tbody tr, table tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length < 5) return;

        const cellTexts = Array.from(cells).map(
          (c) => c.textContent?.trim().replace(/\s+/g, " ") || ""
        );

        // Skip header
        if (cellTexts[0] === "S.No." || cellTexts[0] === "S.No") return;
        if (!/^\d+$/.test(cellTexts[0])) return;

        // Find the title link (postback)
        const titleLink = tr.querySelector('a[id*="LnkTitle"], a[href*="LnkTitle"]');
        const linkId = titleLink?.id || null;

        results.push({ cells: cellTexts, linkId });
      });
      return results;
    });

    console.log(`[HPPCL] Found ${rows.length} total tenders`);

    // Filter by BESS keywords at listing level
    const bessRows = rows.filter((row) => {
      const fullText = row.cells.join(" ").toLowerCase();
      return BESS_KEYWORDS.some((kw) => fullText.includes(kw));
    });

    console.log(`[HPPCL] ${bessRows.length} match BESS keywords`);

    // For each BESS match, extract detail page data via postback
    for (const row of bessRows) {
      try {
        const cells = row.cells;
        const ref = cells[1] || "";
        const title = cells[2] || "";
        const startDate = cells[3] || "";
        const endDate = cells[4] || "";

        const tender = {
          nitNumber: ref || null,
          title,
          authority: "HPPCL",
          state: "Himachal Pradesh",
          location: "Himachal Pradesh",
          bidDeadline: endDate || null,
          pubDate: startDate,
          sourceUrl: HPPCL_URL,
          source: "HPPCL",
          documentLink: null,
        };

        // Click the title link to load detail page (postback)
        if (row.linkId) {
          try {
            await page.click(`#${row.linkId}`, { force: true });
            await page.waitForTimeout(3000);

            const details = await page.evaluate(() => {
              const data = {};
              document.querySelectorAll("table tr").forEach((tr) => {
                const cells = tr.querySelectorAll("td");
                for (let i = 0; i < cells.length - 1; i += 2) {
                  const label = cells[i]?.textContent?.trim().replace(/\s+/g, " ").replace(/:$/, "") || "";
                  const value = cells[i + 1]?.textContent?.trim().replace(/\s+/g, " ") || "";
                  if (label && value && label.length < 80) data[label] = value;
                }
              });

              // Get PDF download link
              const docs = [];
              document.querySelectorAll("a[href]").forEach((a) => {
                const href = a.href;
                const name = a.textContent?.trim() || "";
                if (href.includes("/WriteReadData/Tender/") && href.match(/\.(pdf|doc|xlsx?)$/i)) {
                  if (!docs.some((d) => d.url === href)) {
                    docs.push({ name: name || href.split("/").pop(), url: href, uploadDate: null });
                  }
                }
              });
              data._documents = docs;
              return data;
            });

            // Parse amounts
            const estCost = details["Estimated Cost"] || "";
            const costMatch = estCost.match(/([\d,]+\.?\d*)/);
            if (costMatch) {
              const cost = parseFloat(costMatch[1].replace(/,/g, ""));
              if (cost > 0) tender.totalCost = cost;
            }

            const emd = details["EMD"] || "";
            const emdMatch = emd.match(/([\d,]+\.?\d*)/);
            if (emdMatch) {
              const amt = parseFloat(emdMatch[1].replace(/,/g, ""));
              if (amt > 0) {
                tender.emdAmount = amt;
                tender.emdUnit = "INR";
              }
            }

            tender.description = details["Tender Title"] || tender.title;

            // Documents
            const docs = details._documents || [];
            if (docs.length > 0) {
              tender.documents = docs;
              tender.documentLink = docs[0].url;
            }

            console.log(`[HPPCL] Detail: ${ref} — ${docs.length} docs`);

            // Go back to listing
            try {
              const backBtn = await page.$('a:has-text("Back")');
              if (backBtn) {
                await backBtn.click();
                await page.waitForTimeout(2000);
              } else {
                await page.goto(HPPCL_URL, { waitUntil: "domcontentloaded" });
                await page.waitForTimeout(2000);
              }
            } catch {
              await page.goto(HPPCL_URL, { waitUntil: "domcontentloaded" });
            }
          } catch (err) {
            console.log(`[HPPCL] Detail extraction failed for ${ref}: ${err.message}`);
          }
        }

        tenders.push(tender);
      } catch (err) {
        console.log(`[HPPCL] Row processing failed: ${err.message}`);
      }
    }

    console.log(`[HPPCL] Found ${tenders.length} BESS tenders`);
    return tenders;
  } finally {
    await browser.close();
  }
}
