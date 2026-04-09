import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  Timestamp,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "./firebase";

export interface Tender {
  nitNumber: string;
  title: string;

  // Basic Details
  category: string | null;            // Standalone | FDRE | S+S | PSP | Hybrid
  tenderMode: string | null;          // EPC | BOOT | BOO | BOT | DBOO | DBFOO | BOQ
  authority: string | null;
  authorityType: string | null;       // Central | State | PSU
  state: string | null;
  location: string | null;
  powerMW: number | null;
  energyMWh: number | null;
  durationHours: number | null;
  connectivityType: string | null;    // STU / ISC | ISTS
  biddingStructure: string | null;
  bespaSigning: string | null;

  // Key Dates
  preBidDate: Timestamp | null;
  preBidLink: string | null;
  bidDeadline: Timestamp | null;
  emdDeadline: Timestamp | null;
  techBidOpeningDate: Timestamp | null;
  financialBidOpeningDate: Timestamp | null;
  documentLink: string | null;

  // Technical Details
  minimumBidSize: string | null;
  maxAllocationPerBidder: string | null;
  gridConnected: string | null;
  roundTripEfficiency: string | null;
  minimumAnnualAvailability: string | null;
  dailyCycles: number | null;

  // Financial Details
  financialClosure: string | null;
  scodMonths: string | null;
  gracePeriod: string | null;
  tenderProcessingFee: number | null;
  tenderDocumentFee: number | null;
  vgfAmount: number | null;
  vgfEligible: boolean;
  emdAmount: number | null;
  emdUnit: string | null;
  pbgAmount: number | null;
  successCharges: number | null;
  paymentSecurityFund: number | null;
  portalRegistrationFee: number | null;
  totalCost: number | null;

  // Status
  daysLeft: number | null;
  tenderStatus: string;               // active | closing_soon | closed | awarded

  // Sources & Links
  sourceUrl: string | null;
  sources: string[];

  // Team
  flags: Record<string, string>;
  notes: Record<string, string>;

  // Metadata
  firstSeenAt: Timestamp | null;
  lastUpdatedAt: Timestamp | null;
}

// Patterns that indicate junk/nav data, not real tenders
const JUNK_TITLE_PATTERNS = [
  /^screen reader/i,
  /^search\s*\|/i,
  /^\d{2}-\w{3}-\d{4}\s*search/i,
  /^mis reports/i,
  /^visitor no/i,
  /^active tenders$/i,
  /^tenders by/i,
  /^contents owned/i,
];

export async function getTenders(): Promise<Tender[]> {
  const snapshot = await getDocs(collection(db, "tenders"));
  return snapshot.docs
    .map((d) => ({ nitNumber: d.id, ...d.data() }) as Tender)
    .filter((t) => {
      const title = t.title || "";
      if (title.length < 10) return false;
      return !JUNK_TITLE_PATTERNS.some((p) => p.test(title));
    });
}

export interface EditHistoryEntry {
  id: string;
  editedBy: string;        // user email
  editedByUid: string;
  editedAt: Timestamp;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Update a tender and log an edit history entry with what changed.
 */
export async function updateTender(
  tenderId: string,
  data: Partial<Tender>,
  oldTender: Tender,
  userEmail: string,
  userUid: string
) {
  const ref = doc(db, "tenders", tenderId);
  await updateDoc(ref, {
    ...data,
    lastUpdatedAt: Timestamp.now(),
  });

  // Build a diff of what changed — skip computed/meta fields and unchanged values
  const skipFields = new Set(["lastUpdatedAt", "flags", "notes", "daysLeft", "tenderStatus", "durationHours", "vgfEligible", "nitNumber", "sources", "firstSeenAt"]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  const formatVal = (v: unknown) => {
    if (v == null) return null;
    if (typeof (v as { toDate?: () => Date }).toDate === "function") {
      return (v as Timestamp).toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
    return v;
  };

  for (const key of Object.keys(data) as (keyof Tender)[]) {
    if (skipFields.has(key)) continue;

    const oldVal = oldTender[key];
    const newVal = data[key];

    // Treat null and undefined as the same (both = "empty")
    const oldNorm = oldVal ?? null;
    const newNorm = newVal ?? null;

    // Both empty — skip
    if (oldNorm === null && newNorm === null) continue;

    // Compare Timestamps by ms
    const oldMs = oldNorm && typeof (oldNorm as { toMillis?: () => number }).toMillis === "function"
      ? (oldNorm as Timestamp).toMillis() : oldNorm;
    const newMs = newNorm && typeof (newNorm as { toMillis?: () => number }).toMillis === "function"
      ? (newNorm as Timestamp).toMillis() : newNorm;

    if (oldMs !== newMs) {
      changes[key] = { from: formatVal(oldNorm), to: formatVal(newNorm) };
    }
  }

  // Only write history if something actually changed
  if (Object.keys(changes).length > 0) {
    const historyCol = collection(db, "tenders", tenderId, "editHistory");
    await addDoc(historyCol, {
      editedBy: userEmail,
      editedByUid: userUid,
      editedAt: Timestamp.now(),
      changes,
    });
  }
}

/**
 * Get edit history for a tender, most recent first.
 */
export async function getEditHistory(tenderId: string, max = 20): Promise<EditHistoryEntry[]> {
  const q = query(
    collection(db, "tenders", tenderId, "editHistory"),
    orderBy("editedAt", "desc"),
    limit(max)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as EditHistoryEntry);
}

export async function updateFlag(
  tenderId: string,
  uid: string,
  flag: string
) {
  const ref = doc(db, "tenders", tenderId);
  await updateDoc(ref, {
    [`flags.${uid}`]: flag,
    lastUpdatedAt: Timestamp.now(),
  });
}

export interface Alert {
  id: string;
  title: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: Timestamp | null;
  authority: string | null;
  powerMW: number | null;
  energyMWh: number | null;
  category: string | null;
  createdAt: Timestamp | null;
}

export async function getAlerts(max = 20): Promise<Alert[]> {
  const q = query(
    collection(db, "alerts"),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Alert);
}

export async function updateNote(
  tenderId: string,
  uid: string,
  note: string
) {
  const ref = doc(db, "tenders", tenderId);
  await updateDoc(ref, {
    [`notes.${uid}`]: note,
    lastUpdatedAt: Timestamp.now(),
  });
}
