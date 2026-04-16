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

  const systemPrompt = `You are a data extraction assistant for Indian BESS (Battery Energy Storage System) bid documents. Extract structured fields from tender RfS/RfP document excerpts and respond ONLY with valid JSON. No explanation. Use null for missing values.`;

  const prompt = `Extract fields from this Indian BESS tender document. Tender: "${tenderTitle}"

Return a FLAT JSON object (no nesting) with these keys:
minimumBidSize, maxAllocationPerBidder, gridConnected, roundTripEfficiency, minimumAnnualAvailability, dailyCycles, financialClosure, scodMonths, gracePeriod, tenderProcessingFee, tenderDocumentFee, vgfAmount, emdAmount, pbgAmount, successCharges, paymentSecurityFund, portalRegistrationFee, biddingStructure, bespaSigning, connectivityType, contactPerson, contactEmail, contactPhone, bidSubmissionOnline, bidSubmissionOffline, bidOpeningDate

Rules: All amounts in INR as plain numbers. Strings for text fields. null if not found.

Example: {"emdAmount": 5000000, "biddingStructure": "Two-Envelope + e-Reverse Auction", "roundTripEfficiency": ">=85%", "contactEmail": "abc@seci.co.in"}

Text:
${text}`;

  const result = await callLlm(prompt, systemPrompt);
  if (!result) return null;

  // Flatten if model returned nested structure
  const flat = {};
  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Nested — flatten it
      for (const [innerKey, innerValue] of Object.entries(value)) {
        flat[innerKey] = innerValue;
      }
    } else {
      flat[key] = value;
    }
  }

  return flat;
}
