import axios from "axios";
import { BESS_KEYWORDS } from "../keywords.js";
import { isCorrigendum } from "../corrigendum.js";

const TW_API = "https://www.tenderwizard.in/ROOTAPP/servlet/asl.tw.homepage.controller.HomePageAjaxController";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/**
 * Organizations whose tender portals are hosted on TenderWizard.
 * The portal URL pattern is:
 *   https://www.tenderwizard.in/ROOTAPP/Mobility/index.html?dc=<ENCRYPTED_COMPANY_ID>
 * but the underlying API accepts the plain DB_COMPANY code.
 *
 * HPPCL is the only confirmed one. To add another org: open its TenderWizard URL,
 * check the network tab for `DB_COMPANY=XXX` in the HomePageAjaxController call,
 * and add the code here.
 */
const TW_ORGS = [
  { code: "HPPCL", authority: "HPPCL", state: "Himachal Pradesh" },
];

function parseRupees(str) {
  if (!str) return null;
  // "&#8377 23,78,320.00" → 2378320.0
  const m = String(str).replace(/&#8377|\u20B9|Rs\.?|INR|,/gi, "").trim();
  const n = parseFloat(m);
  return isNaN(n) ? null : n;
}

function parseTwDate(str) {
  if (!str) return null;
  // "29-04-2026 15:00" → Date
  let m = str.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00"] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00+05:30`);
    return isNaN(+d) ? null : d;
  }
  // "Apr 24, 2026 11:30:00 AM" (corrigendum endpoint format)
  const d = new Date(str);
  return isNaN(+d) ? null : d;
}

function publishedUrl(pathStr) {
  if (!pathStr) return null;
  // "T:\\images2\\tenderuploads\\HPPCL\\HPPCL\\400538\\NIT.pdf"
  // → https://www.tenderwizard.in/images2/tenderuploads/HPPCL/HPPCL/400538/NIT.pdf
  const clean = String(pathStr).replace(/^T:\\?/, "").replace(/\\/g, "/");
  if (!clean) return null;
  const trimmed = clean.replace(/^\/+/, "");
  return `https://www.tenderwizard.in/${trimmed}`;
}

async function fetchOrgCorrigenda(org) {
  const url = `${TW_API}?activity=CORRIGENDUMS&DB_COMPANY=${encodeURIComponent(org.code)}`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      timeout: 30000,
    });
    const list = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const tenders = [];
    for (const row of list) {
      const desc = row["DESCOFWORK"] || "";
      const textLower = desc.toLowerCase();
      const isBESS = BESS_KEYWORDS.some((kw) => textLower.includes(kw));
      if (!isBESS) continue;

      const parentNit = row["TENDERNUMBER"] || null;
      const corrRef = row["TST_CORS_BUYER_REF_NO"] || `corr-${row["R"] || ""}`;
      if (!parentNit) continue;
      // Compose a unique child NIT. Using "__" as a separator that's unlikely
      // to appear naturally, so we can always split parent/child later.
      const childNit = `${parentNit}__${corrRef}`.slice(0, 150);

      tenders.push({
        nitNumber: childNit,
        title: `Corrigendum (${corrRef}) — ${desc}`.slice(0, 300),
        authority: org.authority,
        state: org.state,
        location: null,
        powerMW: null,
        energyMWh: null,
        bidDeadline: parseTwDate(row["RECEIPTOFTENDTODATE"]),
        emdDeadline: parseTwDate(row["RECVOFAPPTODATE"]),
        totalCost: (() => { const n = parseFloat(String(row["ESTIMATEDCOST"] || "").replace(/[^0-9.]/g, "")); return isNaN(n) ? null : n; })(),
        documentLink: null,
        sourceUrl: `https://www.tenderwizard.in/ROOTAPP/Mobility/index.html?dc=${encodeURIComponent(org.code)}`,
        source: `TenderWizard-${org.code}`,
        isCorrigendum: true,
        corrigendumOf: parentNit,
      });
    }
    console.log(`[TenderWizard/${org.code}] Found ${tenders.length} BESS-related corrigenda`);
    return tenders;
  } catch (err) {
    console.log(`[TenderWizard/${org.code}] Corrigenda error: ${err.message}`);
    return [];
  }
}

async function fetchOrgTenders(org) {
  const url = `${TW_API}?activity=TENDER_SCROLL_HOMEPAGE&DB_COMPANY=${encodeURIComponent(org.code)}`;
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      timeout: 30000,
    });
    const list = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const tenders = [];

    for (const row of list) {
      const desc = row["Tender Description"] || row["Line Number"] || "";
      const title = `${row["Tender Number"] || ""} - ${desc}`.trim().replace(/^-\s*/, "");
      const textLower = `${title} ${row["COT"] || ""} ${row["Tender Region"] || ""}`.toLowerCase();
      const isBESS = BESS_KEYWORDS.some((kw) => textLower.includes(kw));
      if (!isBESS) continue;

      const deadline = parseTwDate(row["Tender Closing Date & Time"]);
      const docList = Array.isArray(row["Published_Documents"]) ? row["Published_Documents"] : [];
      const docUrl = docList.length > 0 ? publishedUrl(docList[0]) : null;

      const mw = desc.match(/(\d[\d,.]*)\s*MW(?!h)/i);
      const mwh = desc.match(/(\d[\d,.]*)\s*MWh/i);

      tenders.push({
        nitNumber: row["Tender Number"] || null,
        title: title.slice(0, 300),
        authority: org.authority,
        state: org.state,
        location: row["Tender Region"] || null,
        powerMW: mw ? parseFloat(mw[1].replace(/,/g, "")) : null,
        energyMWh: mwh ? parseFloat(mwh[1].replace(/,/g, "")) : null,
        bidDeadline: deadline,
        emdAmount: parseRupees(row["EMD"]),
        totalCost: parseRupees(row["Estimated Cost"]),
        documentLink: docUrl,
        sourceUrl: `https://www.tenderwizard.in/ROOTAPP/Mobility/index.html?dc=${encodeURIComponent(org.code)}`,
        source: `TenderWizard-${org.code}`,
        isCorrigendum: isCorrigendum(title, row["Tender Number"]),
      });
    }
    console.log(`[TenderWizard/${org.code}] Found ${tenders.length} BESS-related tenders (of ${list.length} total)`);
    return tenders;
  } catch (err) {
    console.log(`[TenderWizard/${org.code}] Error: ${err.message}`);
    return [];
  }
}

/**
 * Scrape all configured TenderWizard-hosted organizations and return
 * BESS-related tenders. Uses the HomePageAjaxController JSON API directly —
 * no browser automation needed.
 */
export async function scrapeTenderWizard() {
  const all = [];
  for (const org of TW_ORGS) {
    const t = await fetchOrgTenders(org);
    all.push(...t);
    const c = await fetchOrgCorrigenda(org);
    all.push(...c);
  }
  console.log(`[TenderWizard] Total across all orgs: ${all.length}`);
  return all;
}
