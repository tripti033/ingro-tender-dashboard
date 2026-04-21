import { Timestamp } from "./firestore.js";
import { extractTenderFields, isLlmAvailable } from "./llm.js";
import { isCorrigendum as detectCorrigendum } from "./corrigendum.js";

/**
 * Parse a date string in various formats into a JS Date object.
 * Handles: "15-06-2025", "June 15, 2025", "15/06/2025", ISO strings, Unix ms timestamps.
 */
function parseDate(value) {
  if (!value) return null;

  // Already a Date
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  // Unix timestamp in milliseconds
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value !== "string") return null;

  const str = value.trim();

  // ISO 8601 or standard Date.parse-able strings
  const isoDate = new Date(str);
  if (!isNaN(isoDate.getTime()) && str.includes("-") && str.length > 8) {
    return isoDate;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const ddmmyyyy = str.match(
    /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/
  );
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const d = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day)
    );
    return isNaN(d.getTime()) ? null : d;
  }

  // "Month DD, YYYY" — e.g. "June 15, 2025"
  const monthName = str.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/
  );
  if (monthName) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback: let Date.parse try
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Convert a JS Date to a Firestore Timestamp, or return null.
 */
function toTimestamp(value) {
  const date = parseDate(value);
  if (!date) return null;
  return Timestamp.fromDate(date);
}

/**
 * Sanitise a NIT number for use as a Firestore document ID.
 * Replaces spaces, slashes, dots with dashes and uppercases.
 */
function sanitiseNit(nit) {
  if (!nit) return null;
  return nit
    .trim()
    .replace(/[\s/\\.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

/**
 * Generate a synthetic NIT number when the source doesn't provide one.
 * Format: SOURCE-YYYYMMDD-SLUGIFIED-TITLE (first 5 words)
 */
function generateNit(source, title, date) {
  const d = parseDate(date) || new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");

  const slug = (title || "unknown")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .toUpperCase();

  return `${source.toUpperCase()}-${dateStr}-${slug}`;
}

/**
 * Extract MW and MWh values from text using regex.
 */
function extractCapacity(text) {
  if (!text) return { powerMW: null, energyMWh: null };

  const mwMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*MW(?!h)/i);
  const mwhMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*MWh/i);

  return {
    powerMW: mwMatch ? parseFloat(mwMatch[1].replace(/,/g, "")) : null,
    energyMWh: mwhMatch
      ? parseFloat(mwhMatch[1].replace(/,/g, ""))
      : null,
  };
}

/**
 * Detect tender category from text.
 */
function detectCategory(text) {
  if (!text) return "Standalone";
  if (/fdre|firm\s+.*dispatch/i.test(text)) return "FDRE";
  if (/solar/i.test(text) && /storage/i.test(text)) return "S+S";
  if (/pumped/i.test(text)) return "PSP";
  if (/hybrid/i.test(text)) return "Hybrid";
  return "Standalone";
}

/**
 * Detect tender mode from text.
 */
function detectTenderMode(text) {
  if (!text) return null;
  if (/\bEPC\b/i.test(text)) return "EPC";
  if (/\bBOOT\b/i.test(text)) return "BOOT";
  if (/\bBOO\b/i.test(text)) return "BOO";
  if (/\bBOT\b/i.test(text)) return "BOT";
  return null;
}

/**
 * Detect authority type (Central, State, PSU).
 */
function detectAuthorityType(authority) {
  const central = ["SECI", "NTPC", "SJVNL", "NVVN", "UJVNL", "NHPC", "PGCIL", "POWERGRID", "MNRE", "CEA", "IREDA", "NGEL"];
  const state = ["GUVNL", "MSEDCL", "TNGECL", "RRVUNL", "DHBVN", "WBSEDCL", "MSETCL", "UPCL", "UJVNL", "PTCUL", "HPPCL"];
  const marketplace = ["eProcure", "GeM"];

  if (!authority) return null;
  if (central.includes(authority)) return "Central";
  if (state.includes(authority)) return "State";
  if (marketplace.includes(authority)) return "Central";
  return "PSU";
}

/**
 * Normalise a raw tender object from any source into the unified Firestore schema.
 */
export function normaliseToSchema(rawTender, source) {
  const title = rawTender.title || "";
  const fullText = `${title} ${rawTender.description || ""}`;

  // Sanitise or generate NIT number
  let nitNumber = sanitiseNit(rawTender.nitNumber);
  if (!nitNumber) {
    nitNumber = generateNit(source, title, rawTender.bidDeadline);
  }

  // Extract capacity — prefer raw values, fall back to text extraction
  const extracted = extractCapacity(fullText);
  const powerMW = rawTender.powerMW ?? extracted.powerMW;
  const energyMWh = rawTender.energyMWh ?? extracted.energyMWh;

  // Compute duration
  const durationHours =
    powerMW && energyMWh ? Math.round((energyMWh / powerMW) * 100) / 100 : null;

  // Parse bid deadline and compute days left
  const bidDeadlineDate = parseDate(rawTender.bidDeadline);
  const bidDeadline = toTimestamp(rawTender.bidDeadline);
  let daysLeft = null;
  if (bidDeadlineDate) {
    const now = new Date();
    daysLeft = Math.ceil(
      (bidDeadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // Determine tender status based on days left
  let tenderStatus = "active";
  if (daysLeft !== null) {
    if (daysLeft < 0) tenderStatus = "closed";
    else if (daysLeft <= 7) tenderStatus = "closing_soon";
  }

  const authority = rawTender.authority || source;

  return {
    nitNumber,
    title,
    category: rawTender.category || detectCategory(fullText),
    tenderMode: rawTender.tenderMode || detectTenderMode(fullText),
    authority,
    authorityType: detectAuthorityType(authority),
    state: rawTender.state || null,
    location: rawTender.location || null,
    powerMW,
    energyMWh,
    durationHours,
    connectivityType: rawTender.connectivityType || null,
    emdAmount: rawTender.emdAmount || null,
    emdUnit: rawTender.emdUnit || null,
    vgfEligible: /vgf/i.test(fullText),
    biddingStructure: rawTender.biddingStructure || null,
    bidDeadline,
    emdDeadline: toTimestamp(rawTender.emdDeadline),
    preBidDate: toTimestamp(rawTender.preBidDate),
    techBidOpeningDate: toTimestamp(rawTender.techBidOpeningDate),
    financialBidOpeningDate: toTimestamp(rawTender.financialBidOpeningDate),
    bespaSigning: toTimestamp(rawTender.bespaSigning),
    daysLeft,
    tenderStatus,
    documentLink: rawTender.documentLink || null,
    documents: rawTender.documents || null,
    preBidLink: rawTender.preBidLink || null,
    sourceUrl: rawTender.detailUrl || rawTender.sourceUrl || null,
    sources: [source],
    flags: {},
    notes: {},
    firstSeenAt: Timestamp.now(),
    lastUpdatedAt: Timestamp.now(),
    // Corrigendum fields. Scrapers that know their own schema (e.g. TenderWizard)
    // pre-fill these; otherwise we detect from title. Parent NIT is resolved
    // later by the writer which has access to the full existing dataset.
    isCorrigendum: rawTender.isCorrigendum != null
      ? !!rawTender.isCorrigendum
      : detectCorrigendum(title, nitNumber),
    corrigendumOf: rawTender.corrigendumOf || null,
  };
}

/**
 * Normalise a raw tender with LLM fallback for weak regex extraction.
 * Uses LLM when powerMW, energyMWh, category, or location couldn't be regex-extracted.
 * Falls back gracefully to regex-only if LLM is not available.
 */
export async function normaliseWithLlm(rawTender, source) {
  // First pass: regex extraction
  const normalised = normaliseToSchema(rawTender, source);

  // Check if LLM is available (cached check after first call)
  const hasLlm = await isLlmAvailable();
  if (!hasLlm) return normalised;

  // Determine if we should ask the LLM — only for gaps
  const hasGaps =
    normalised.powerMW == null ||
    normalised.energyMWh == null ||
    !normalised.category ||
    !normalised.state ||
    !normalised.tenderMode ||
    (normalised.authority && ["TenderDetail", "eProcure", "GeM"].includes(normalised.authority));

  if (!hasGaps) return normalised;

  // Ask the LLM to fill in the gaps
  const llmResult = await extractTenderFields(
    rawTender.title || "",
    rawTender.description || ""
  );
  if (!llmResult) return normalised;

  // Merge — prefer regex values, fill in nulls with LLM values
  if (normalised.powerMW == null && llmResult.powerMW != null)
    normalised.powerMW = llmResult.powerMW;
  if (normalised.energyMWh == null && llmResult.energyMWh != null)
    normalised.energyMWh = llmResult.energyMWh;
  if ((!normalised.category || normalised.category === "Standalone") && llmResult.category)
    normalised.category = llmResult.category;
  if (!normalised.tenderMode && llmResult.tenderMode)
    normalised.tenderMode = llmResult.tenderMode;
  if (!normalised.state && llmResult.state)
    normalised.state = llmResult.state;
  if (!normalised.location && llmResult.location)
    normalised.location = llmResult.location;
  if (!normalised.connectivityType && llmResult.connectivityType)
    normalised.connectivityType = llmResult.connectivityType;

  // LLM may identify authority better than regex for generic sources
  if (llmResult.authority && ["TenderDetail", "eProcure", "GeM"].includes(normalised.authority)) {
    normalised.authority = llmResult.authority;
    normalised.authorityType = detectAuthorityType(llmResult.authority);
  }

  // Recompute derived fields
  if (normalised.powerMW && normalised.energyMWh) {
    normalised.durationHours = Math.round((normalised.energyMWh / normalised.powerMW) * 100) / 100;
  }

  return normalised;
}
