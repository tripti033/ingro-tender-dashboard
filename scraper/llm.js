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
const LLM_TIMEOUT_MS = 180000; // 3 min — generous for cold model + larger prompts

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

  const systemPrompt = `You're triaging incoming Indian BESS (Battery Energy Storage System) tenders for a BD team. You see a single tender line — title plus whatever description the scraper captured — and pull out the key facts. Tender titles are written by many different agencies, so wording is inconsistent. Use your judgment: "500MW/2000MWh" and "500 MW / 2000 MWh" and "500 MW with 2 GWh" all mean the same thing. When the text isn't explicit about a field, return null instead of guessing. Respond with ONLY a JSON object.`;

  const prompt = `Here's the tender text:
"""
${text}
"""

Fill in what you can confidently infer:
  powerMW         — MW rating as a number
  energyMWh       — MWh capacity as a number
  authority       — issuing authority acronym (SECI, NTPC, GUVNL, MSEDCL,
                    RRVUNL, UPCL, SJVNL, TNGECL, NHPC, PGCIL, IREDA, UJVNL,
                    WBSEDCL, MSETCL, DHBVN, and similar Indian utilities)
  category        — best-fit among: Standalone, FDRE, S+S, PSP, Hybrid
  tenderMode      — best-fit among: EPC, BOOT, BOO, BOT, DBOO, DBFOO
  location        — city or region mentioned
  state           — Indian state name
  connectivityType — "ISTS" or "STU / ISC"

Notes on judgment:
  - "RfS for firm and dispatchable RE" → category = FDRE
  - "solar + storage" / "solar with BESS" → S+S
  - "pumped storage" / "PSP" → PSP
  - If no solar/wind mention but batteries are the main asset → Standalone
  - Prefer returning null over a wrong guess.`;

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

  const systemPrompt = `You're helping a BD team at an Indian clean-energy firm decide whether to bid on upcoming BESS (Battery Energy Storage System) tenders and prepare their applications. They read hundreds of tender documents a year, so you're their first pair of eyes — extract the structured fields they'll actually use. Be honest: if something isn't in the text, say so with null. Be careful: if two pieces of data look similar (e.g. two emails in different sections), pick the one a careful BD person would actually use. Respond with ONLY a flat JSON object, no prose.`;

  const prompt = `Tender: "${tenderTitle}"

Read the excerpts below and fill in what a careful BD/applications person would want to know. Use your judgment — tender docs are inconsistent and field names vary, so match on meaning, not exact wording.

Expected keys (use null for anything not clearly stated):
  minimumBidSize, maxAllocationPerBidder, gridConnected, roundTripEfficiency, minimumAnnualAvailability, dailyCycles, financialClosure, scodMonths, gracePeriod, tenderProcessingFee, tenderDocumentFee, vgfAmount, emdAmount, pbgAmount, successCharges, paymentSecurityFund, portalRegistrationFee, biddingStructure, bespaSigning, connectivityType, contactPerson, contactEmail, contactPhone, bidSubmissionOnline, bidSubmissionOffline, bidOpeningDate

Conventions:
  - INR amounts as plain numbers (₹5,000 → 5000). No units, no symbols.
  - Everything else as a short string.

Contact fields are the trickiest part. Tender docs often list TWO different
email addresses close together:
  • A SUBMISSION / RESPONSE address — usually a generic/department mailbox
    (e.g. contracts@xxx, tenders@xxx, procurement@xxx). This is where the
    bid gets sent, not who to call.
  • A "DETAILS OF PERSONS TO BE CONTACTED" / "CONTACT PERSON FOR ASSISTANCE"
    section — a named officer with a designation and personal email
    (e.g. "Sh. Pratik Prasun, DGM (C&P), pratikpr@xxx").

contactPerson / contactEmail / contactPhone should describe the NAMED
officer in the second kind of section. If there's only a generic submission
mailbox and no named officer, leave all three null rather than guessing.

Also: if the document mentions something genuinely important for a BD team
that doesn't fit the schema (e.g., an unusual eligibility quirk, a lock-in,
a land-related constraint, a special certification requirement) — feel free
to include it as a short "notes" string. Don't fabricate; only add if it's
clearly in the text.

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
    // Fake examples + generic/department mailboxes that aren't an assigned
    // contact person — we want named-officer emails, not "submission@".
    const placeholders = /^(abc|test|example|contact|info|admin|dummy|xyz|foo|bar|user|someone|name|email|your|contracts?|tenders?|procurement|support|help|helpdesk|cp|cps|cnp|rfs|rfp|eoi|bid|bids|office|enquiry|enquiries|eng|engg|engineering)@/i;
    if (
      !emailRe.test(email) ||
      placeholders.test(email) ||
      !pdfLower.includes(email.toLowerCase())
    ) {
      console.log(`[LLM] rejected generic/fabricated contactEmail: ${email}`);
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
  const prompt = `Help a BD/analyst team at an Indian BESS company triage an incoming news headline. They see a lot of noise from Mercom / PVMagazine / ETEnergyWorld etc. and need you to judge: is this one worth reading?

Headline: "${title}"
Source: ${sourceUrl}

Return a flat JSON object with:
  relevanceScore       — 1-10. Aim for a considered score, not a default.
                         10 = directly about a live BESS tender we'd want to track
                         7-9 = BESS-adjacent (capex, policy, competitor, tech)
                         4-6 = broader energy-sector context
                         1-3 = barely relevant / clickbait
  category             — best-fit among: Tender Announcement, Policy/Regulatory,
                         Market Update, Technology, Competition, Opportunity, General
  authorities          — array of authorities mentioned (SECI, NTPC, GUVNL,
                         MSEDCL, MNRE, CEA, PGCIL, etc.), or null
  companies            — array of company names mentioned, or null
  states               — array of Indian states mentioned, or null
  powerMW              — number if a specific MW capacity is mentioned, else null
  energyMWh            — number if a specific MWh capacity is mentioned, else null
  isTenderAnnouncement — true only if this headline is specifically about a new
                         tender being floated/issued (not an award, not a signing)
  oneLinerInsight      — a tight sentence telling the team what's actionable here
                         (or why this is mostly noise)

If the headline genuinely isn't an energy story at all, low-score it and say so honestly in the insight. If you notice something the fields above don't capture — e.g. a deadline extension, a VGF change, a new state policy — work it into oneLinerInsight; that's exactly the kind of extra-mile observation the team wants.`;

  const result = await callLlm(prompt, "You're an energy-industry analyst helping an Indian BESS BD team decide what to read. Be honest about relevance (low scores are fine), be concrete in the insight. Respond with ONLY valid JSON.");
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
