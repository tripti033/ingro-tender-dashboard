import { NextResponse } from "next/server";
import { initializeApp, getApps, cert, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";

// We use firebase-admin on the server so API routes can read/write regardless
// of client auth state. Service account is provided via env vars for Vercel.
// For local dev without a service account we fall back to the public client
// credentials via REST — but only reads are free, writes require auth.
function getAdminDb() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Server-side extraction needs firebase-admin credentials (FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY) in env. " +
          "Without them, use the CLI script scraper/extract-checklist.js instead.",
      );
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getFirestore(getApp());
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface ExtractedItem {
  bucket: "Envelope-1" | "Cover-2" | "Cover-3" | "Custom";
  document: string;
  reference: string | null;
}

async function downloadPdfAsBase64(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const mime = resp.headers.get("content-type") || "application/pdf";
    const buf = Buffer.from(await resp.arrayBuffer());
    // Gemini inline-data limit is ~20MB base64; reject huge PDFs
    if (buf.length > 18 * 1024 * 1024) return null;
    return { base64: buf.toString("base64"), mime };
  } catch { return null; }
}

async function callGeminiWithPdf(pdfBase64: string, mime: string): Promise<ExtractedItem[] | null> {
  if (!GEMINI_API_KEY) return null;

  const prompt = `You are reading an Indian BESS (Battery Energy Storage System) tender RfP/RfS document.
Find the "Annexures and Supporting Documents" section, the submission checklist,
or any list of documents the bidder must submit (Formats, Annexures, affidavits,
DDs, financial statements, etc.).

Return a JSON array — each element is one document the bidder must submit:
[
  {
    "bucket": "Envelope-1" | "Cover-2" | "Cover-3" | "Custom",
    "document": "short description of what must be submitted",
    "reference": "Format 6.4 / Annexure-E / null"
  }
]

Bucket rules:
- Envelope-1 = physical DDs, EMD, stamp-paper affidavits (costs & securities)
- Cover-2 = electronic technical bid (covering letter, formats, CA certs, financials)
- Cover-3 = electronic financial bid (tariff BoQ)
- Custom = anything that doesn't fit cleanly

Rules:
- Only include items that literally appear in the document text. Do not invent.
- If there is no checklist / annexure section, return an empty array [].
- Keep each "document" string under 200 characters.
- Respond with ONLY the JSON array. No markdown, no prose.`;

  const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mime, data: pdfBase64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.log("[extract-checklist] Gemini error:", resp.status, err.slice(0, 400));
    return null;
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x: ExtractedItem) => x && typeof x.document === "string");
  } catch { return []; }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const nit = url.searchParams.get("nit");
  if (!nit) return NextResponse.json({ error: "Missing ?nit=" }, { status: 400 });
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set on the server" }, { status: 500 });
  }

  let db;
  try { db = getAdminDb(); } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const tenderDoc = await db.collection("tenders").doc(nit).get();
  if (!tenderDoc.exists) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const tender = tenderDoc.data() || {};

  const docLink = tender.documentLink as string | undefined;
  if (!docLink) {
    return NextResponse.json({ error: "This tender has no documentLink to extract from", created: 0 }, { status: 200 });
  }

  const pdf = await downloadPdfAsBase64(docLink);
  if (!pdf) {
    return NextResponse.json({ error: "Could not download the tender PDF (too large, offline, or 404)", created: 0 }, { status: 200 });
  }

  const items = await callGeminiWithPdf(pdf.base64, pdf.mime);
  if (!items || items.length === 0) {
    return NextResponse.json({ created: 0, message: "No checklist items found in document" }, { status: 200 });
  }

  // Skip if target already has items — don't clobber
  const existing = await db.collection("tenders").doc(nit).collection("checklist").limit(1).get();
  if (!existing.empty) {
    return NextResponse.json({ created: 0, message: "Checklist already populated; skipped" }, { status: 200 });
  }

  let created = 0;
  const now = Timestamp.now();
  let order = 10;
  const buckets: Record<string, number> = { "Envelope-1": 10, "Cover-2": 10, "Cover-3": 10, "Custom": 10 };
  for (const raw of items) {
    const bucket = ["Envelope-1", "Cover-2", "Cover-3", "Custom"].includes(raw.bucket) ? raw.bucket : "Custom";
    buckets[bucket] += 10;
    order = buckets[bucket];
    await db.collection("tenders").doc(nit).collection("checklist").add({
      bucket,
      order,
      document: String(raw.document).slice(0, 500),
      reference: raw.reference || null,
      status: "pending",
      remarks: null,
      documentLink: null,
      updatedBy: "gemini-extractor",
      updatedAt: now,
    });
    created++;
  }

  await db.collection("tenders").doc(nit).update({
    checklistExtractedAt: FieldValue.serverTimestamp(),
    checklistExtractedBy: "gemini",
  });

  return NextResponse.json({ created, bucket_counts: buckets });
}
