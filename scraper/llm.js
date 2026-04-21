/**
 * Local LLM wrapper around Ollama HTTP API.
 *
 * Ollama must be running locally (default http://localhost:11434).
 * Set OLLAMA_URL env var to override. Set OLLAMA_MODEL to change model.
 *
 * If Ollama is not running, all functions return null and log a warning.
 * The scraper falls back to regex parsing when LLM is unavailable.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const LLM_TIMEOUT_MS = 90000; // 90s — generous for cold model load

let llmAvailable = null; // cached availability check

/**
 * Check if Ollama is running and the model is available.
 * On first check, sends a warm-up prompt to pre-load the model into RAM.
 * Returns true/false, cached after first call.
 */
export async function isLlmAvailable() {
  if (llmAvailable !== null) return llmAvailable;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      llmAvailable = false;
      return false;
    }

    const data = await resp.json();
    const models = (data.models || []).map((m) => m.name);
    if (!models.some((m) => m.startsWith(OLLAMA_MODEL.split(":")[0]))) {
      console.log(
        `[LLM] Ollama is running but model "${OLLAMA_MODEL}" not found. Available: ${models.join(", ")}`
      );
      llmAvailable = false;
      return false;
    }

    // Warm up — first call loads model into RAM (~10-30s on M2)
    console.log(`[LLM] Warming up model ${OLLAMA_MODEL}...`);
    try {
      const warmResp = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: "Say hi",
          stream: false,
          options: { num_predict: 5 },
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (warmResp.ok) {
        console.log(`[LLM] Model loaded and ready`);
      }
    } catch {
      console.log("[LLM] Warm-up timed out — skipping LLM this run");
      llmAvailable = false;
      return false;
    }

    llmAvailable = true;
    return true;
  } catch {
    console.log("[LLM] Ollama not running — falling back to regex parsing");
    llmAvailable = false;
    return false;
  }
}

/**
 * Call Ollama with a prompt and return the parsed JSON response.
 * Returns null on failure. Uses JSON mode for reliable output.
 */
export async function callLlm(prompt, systemPrompt = null) {
  if (!(await isLlmAvailable())) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const body = {
      model: OLLAMA_MODEL,
      prompt,
      format: "json",
      stream: false,
      options: {
        temperature: 0.1, // low temp for consistent extraction
        num_predict: 1024,
      },
    };
    if (systemPrompt) body.system = systemPrompt;

    const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.log(`[LLM] API error: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (!data.response) {
      console.log(`[LLM] Empty response from model`);
      return null;
    }

    console.log(`[LLM] Response (${data.response.length} chars): ${data.response.slice(0, 300)}`);

    try {
      return JSON.parse(data.response);
    } catch (err) {
      console.log(`[LLM] Failed to parse JSON: ${err.message}`);
      return null;
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("[LLM] Timeout");
    } else {
      console.log(`[LLM] Error: ${err.message}`);
    }
    return null;
  }
}

/**
 * Extract structured fields from a tender title/description.
 * Returns: { powerMW, energyMWh, authority, category, tenderMode, location, state, connectivityType }
 * Any field can be null if not extractable.
 */
export async function extractTenderFields(title, description = "") {
  const text = `${title}\n${description}`.slice(0, 2000);

  const systemPrompt = `You are a data extraction assistant for Indian BESS (Battery Energy Storage System) tenders. Extract structured fields from tender text and respond ONLY with valid JSON. No explanation.`;

  const prompt = `Extract these fields from the tender text below. Return null for missing values.

Fields:
- powerMW: number (MW rating)
- energyMWh: number (MWh energy capacity)
- authority: string (SECI, NTPC, GUVNL, MSEDCL, RRVUNL, UPCL, SJVNL, TNGECL, NHPC, PGCIL, IREDA, UJVNL, WBSEDCL, MSETCL, DHBVN, etc.)
- category: string (must be one of: "Standalone", "FDRE", "S+S", "PSP", "Hybrid")
- tenderMode: string (must be one of: "EPC", "BOOT", "BOO", "BOT", "DBOO", "DBFOO")
- location: string (city or region)
- state: string (Indian state name)
- connectivityType: string ("ISTS" or "STU / ISC")

Tender text:
"""
${text}
"""

JSON:`;

  const result = await callLlm(prompt, systemPrompt);
  if (!result) return null;

  // Clean up — ensure types are correct
  const cleaned = {
    powerMW: typeof result.powerMW === "number" ? result.powerMW : null,
    energyMWh: typeof result.energyMWh === "number" ? result.energyMWh : null,
    authority: typeof result.authority === "string" && result.authority.length > 0 ? result.authority.toUpperCase() : null,
    category: ["Standalone", "FDRE", "S+S", "PSP", "Hybrid"].includes(result.category) ? result.category : null,
    tenderMode: ["EPC", "BOOT", "BOO", "BOT", "DBOO", "DBFOO"].includes(result.tenderMode) ? result.tenderMode : null,
    location: typeof result.location === "string" && result.location.length > 0 ? result.location : null,
    state: typeof result.state === "string" && result.state.length > 0 ? result.state : null,
    connectivityType: ["ISTS", "STU / ISC"].includes(result.connectivityType) ? result.connectivityType : null,
  };

  return cleaned;
}

/**
 * Extract rich technical + financial fields from bid document text (from PDF).
 * Returns the full detail schema — 20+ fields.
 */
export async function extractPdfFields(pdfText, tenderTitle = "") {
  // Extract key sections from the full PDF text instead of just first 12K chars
  // Look for sections that contain the data we need
  const keyPhrases = [
    "EMD", "Earnest Money", "Bid Security",
    "Tender Fee", "Processing Fee", "Document Fee", "Cost of RfS",
    "VGF", "Viability Gap",
    "Performance Bank Guarantee", "PBG",
    "Financial Closure", "SCOD", "Commissioning",
    "Grace Period",
    "Round Trip Efficiency", "RTE",
    "Annual Availability",
    "Daily Cycle",
    "Minimum Bid", "Minimum Capacity", "Minimum Project",
    "Maximum Allocation", "Maximum Capacity",
    "Bidding Structure", "e-Reverse Auction", "Two Envelope",
    "BESPA", "PPA Signing",
    "Grid Connected", "Connectivity", "ISTS", "STU",
    "Contact Person", "Contact Detail", "Email", "Phone",
    "Pre-Bid", "Bid Submission",
    "Success Charge", "Portal Registration",
  ];

  // Extract ~500 chars around each key phrase match
  const chunks = new Set();
  const textLower = pdfText.toLowerCase();
  for (const phrase of keyPhrases) {
    let idx = 0;
    const phraseLower = phrase.toLowerCase();
    while ((idx = textLower.indexOf(phraseLower, idx)) !== -1) {
      const start = Math.max(0, idx - 200);
      const end = Math.min(pdfText.length, idx + 300);
      chunks.add(pdfText.slice(start, end));
      idx += phrase.length;
      if (chunks.size >= 30) break; // cap at 30 chunks
    }
    if (chunks.size >= 30) break;
  }

  // Also include the first 3000 chars (often has summary table)
  const text = [
    pdfText.slice(0, 3000),
    "...",
    ...Array.from(chunks),
  ].join("\n---\n").slice(0, 8000); // 8K chars — sweet spot for 3B model speed + coverage
  console.log(`[LLM] PDF prompt: ${text.length} chars from ${chunks.size} key sections`);

  const systemPrompt = `You are a data extraction assistant for Indian BESS tender documents. You ONLY extract values that appear VERBATIM in the provided text. NEVER invent, guess, or fabricate values. If a value is not literally present in the text, return null for that field. Respond ONLY with valid JSON. No explanation.`;

  const prompt = `Extract fields from this Indian BESS tender document. Tender: "${tenderTitle}"

Return a FLAT JSON object (no nesting) with these keys:
minimumBidSize, maxAllocationPerBidder, gridConnected, roundTripEfficiency, minimumAnnualAvailability, dailyCycles, financialClosure, scodMonths, gracePeriod, tenderProcessingFee, tenderDocumentFee, vgfAmount, emdAmount, pbgAmount, successCharges, paymentSecurityFund, portalRegistrationFee, biddingStructure, bespaSigning, connectivityType, contactPerson, contactEmail, contactPhone, bidSubmissionOnline, bidSubmissionOffline, bidOpeningDate

CRITICAL RULES:
- Only extract values that appear LITERALLY in the text below. Do NOT invent.
- For contactEmail: must be an actual email address present in the text (not "abc@..." or "contact@example.com"). If no email is present, return null.
- For contactPhone: must be an actual phone number present in the text. If none, return null.
- For contactPerson: must be the actual name of a person mentioned in the text. If none, return null.
- All amounts in INR as plain numbers. Strings for text fields. null if not found.
- Better to return null than a guess. Hallucinated values will be rejected.

Example (shape only — your actual values must come from the text):
{"emdAmount": 5000000, "biddingStructure": "Two-Envelope + e-Reverse Auction", "contactEmail": null, "contactPerson": null}

Text:
${text}`;

  const result = await callLlm(prompt, systemPrompt);
  if (!result) return null;

  // Flatten if model returned nested structure
  const flat = {};
  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [innerKey, innerValue] of Object.entries(value)) {
        flat[innerKey] = innerValue;
      }
    } else {
      flat[key] = value;
    }
  }

  // Contact-detail anti-hallucination guardrails. The 3B model likes to
  // invent plausible-looking emails and phone numbers when the doc has none.
  // Only keep contact values that (a) pass a format check and (b) actually
  // appear verbatim somewhere in the PDF text.
  const pdfLower = pdfText.toLowerCase();

  if (flat.contactEmail) {
    const email = String(flat.contactEmail).trim();
    const emailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const placeholders = /^(abc|test|example|contact|info|admin|dummy|xyz)@/i;
    if (
      !emailRe.test(email) ||
      placeholders.test(email) ||
      !pdfLower.includes(email.toLowerCase())
    ) {
      console.log(`[LLM] rejected fabricated contactEmail: ${email}`);
      flat.contactEmail = null;
    }
  }

  if (flat.contactPhone) {
    const phone = String(flat.contactPhone).trim();
    const digitsOnly = phone.replace(/\D/g, "");
    // Also need to check the digits appear as a contiguous run in the source
    const pdfDigits = pdfText.replace(/\D/g, "");
    if (
      digitsOnly.length < 8 ||
      digitsOnly.length > 15 ||
      /^(1234567890|0000000000|9999999999)$/.test(digitsOnly) ||
      !pdfDigits.includes(digitsOnly)
    ) {
      console.log(`[LLM] rejected fabricated contactPhone: ${phone}`);
      flat.contactPhone = null;
    }
  }

  if (flat.contactPerson) {
    const person = String(flat.contactPerson).trim();
    // Reject generic placeholders + any name not appearing in the PDF
    const placeholderName = /^(john doe|jane doe|mr\.?\s+x|contact person|the undersigned|n\.?a\.?|\-+)$/i;
    if (
      person.length < 3 ||
      placeholderName.test(person) ||
      !pdfLower.includes(person.toLowerCase())
    ) {
      console.log(`[LLM] rejected fabricated contactPerson: ${person}`);
      flat.contactPerson = null;
    }
  }

  return flat;
}

/**
 * Extract tender result info from news article text.
 * Returns: { winners[], bidders[], developer, lowestPrice, priceUnit, awardedCapacityMWh, state }
 */
export async function extractTenderResult(newsText, tenderTitle = "") {
  const text = newsText.slice(0, 8000);

  const prompt = `Read this news article about an Indian BESS (Battery Energy Storage System) tender result.
Tender: "${tenderTitle}"

Extract a FLAT JSON with:
- winners: array of objects [{company: string, capacityMWh: number or null, priceLakhsPerMW: number or null, priceRsPerKWh: number or null}]
- bidders: array of strings (all companies that bid, including losers)
- developer: string or null (company that will execute/build the project, if different from winner)
- totalCapacityMWh: number or null
- state: string or null
- tenderAuthority: string or null (SECI, NTPC, GUVNL etc.)
- resultSummary: string (1-2 sentence summary of the result)

Return null for any field not found in the text.

Article text:
${text}`;

  const result = await callLlm(prompt, "You are an expert analyst for Indian BESS tenders. Extract structured data from news articles about tender results. Respond ONLY with valid JSON.");
  if (!result) return null;
  return result;
}

/**
 * Process an industry alert with LLM: score, categorize, extract entities, detect if tender.
 * Returns: { relevanceScore, category, entities, isTenderAnnouncement, draftTender }
 */
export async function processAlert(title, sourceUrl = "") {
  const prompt = `Analyze this Indian energy industry news headline for a BESS (Battery Energy Storage System) company.

Headline: "${title}"
Source: ${sourceUrl}

Return a FLAT JSON with:
- relevanceScore: number 1-10 (10=directly about BESS tender, 7-9=BESS related, 4-6=energy sector relevant, 1-3=barely relevant)
- category: string (must be one of: "Tender Announcement", "Policy/Regulatory", "Market Update", "Technology", "Competition", "Opportunity", "General")
- authorities: array of strings (any mentioned: SECI, NTPC, GUVNL, MSEDCL, MNRE, CEA, PGCIL etc. or null)
- companies: array of strings (any company names mentioned, or null)
- states: array of strings (any Indian states mentioned, or null)
- powerMW: number or null (if MW capacity mentioned)
- energyMWh: number or null (if MWh mentioned)
- isTenderAnnouncement: boolean (true if this headline IS about a new tender being issued/floated)
- oneLinerInsight: string (1 sentence actionable insight for the BESS team)

Example: {"relevanceScore": 8, "category": "Tender Announcement", "authorities": ["SECI"], "companies": null, "states": ["Rajasthan"], "powerMW": 500, "energyMWh": 2000, "isTenderAnnouncement": true, "oneLinerInsight": "New SECI 500MW BESS tender in Rajasthan — check eligibility and bid deadline."}`;

  const result = await callLlm(prompt, "You are an energy industry analyst for an Indian BESS company. Respond ONLY with valid JSON.");
  if (!result) return null;

  // Validate relevanceScore
  if (typeof result.relevanceScore === "number") {
    result.relevanceScore = Math.min(10, Math.max(1, Math.round(result.relevanceScore)));
  }

  // Validate category
  const validCategories = ["Tender Announcement", "Policy/Regulatory", "Market Update", "Technology", "Competition", "Opportunity", "General"];
  if (!validCategories.includes(result.category)) {
    result.category = "General";
  }

  return result;
}

/**
 * Generate a summary paragraph covering important tender info NOT in structured fields.
 * Covers: eligibility criteria, technical specs (battery chemistry, cycle life, warranty),
 * penalty clauses, land/grid requirements, commercial terms, special conditions.
 */
export async function generateTenderSummary(pdfText, tenderTitle = "") {
  // Extract diverse sections from the full text
  const keyPhrases = [
    "eligibility", "qualification", "experience", "net worth",
    "battery chemistry", "lithium", "cycle life", "warranty", "degradation",
    "penalty", "liquidated damages", "delay",
    "land", "site", "right of way",
    "grid connectivity", "transmission", "evacuation",
    "insurance", "force majeure",
    "payment", "tariff", "escalation",
    "scope of work", "deliverables",
    "minimum", "maximum", "shall not", "must",
  ];

  const chunks = new Set();
  const textLower = pdfText.toLowerCase();
  for (const phrase of keyPhrases) {
    let idx = 0;
    while ((idx = textLower.indexOf(phrase, idx)) !== -1) {
      const start = Math.max(0, idx - 150);
      const end = Math.min(pdfText.length, idx + 350);
      chunks.add(pdfText.slice(start, end));
      idx += phrase.length;
      if (chunks.size >= 25) break;
    }
    if (chunks.size >= 25) break;
  }

  const text = [...Array.from(chunks)].join("\n---\n").slice(0, 8000);

  if (text.length < 200) return null;

  const systemPrompt = `You are an expert analyst for Indian BESS (Battery Energy Storage System) tenders. Write concise, factual summaries.`;

  const prompt = `Read these excerpts from a BESS tender document titled "${tenderTitle}".

Write a 3-5 sentence summary covering ONLY the important details that are NOT typically captured in structured fields (like MW, MWh, EMD, dates, fees).

Focus on:
- Eligibility requirements (min experience, net worth, turnover)
- Battery technology requirements (chemistry type, cycle life, warranty period, degradation limits)
- Penalty/LD clauses
- Land and grid connectivity requirements
- Special conditions or unique terms
- Key commercial terms

If the text doesn't have meaningful info beyond basic tender details, respond with just: {"summary": null}

Respond with JSON: {"summary": "your summary text here"}

Text excerpts:
${text}`;

  const result = await callLlm(prompt, systemPrompt);
  if (!result || !result.summary) return null;

  return typeof result.summary === "string" ? result.summary : null;
}
