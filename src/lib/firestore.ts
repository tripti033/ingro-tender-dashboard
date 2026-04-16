import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  setDoc,
  addDoc,
  deleteDoc,
  Timestamp,
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

// ── Tender ──

export interface Tender {
  nitNumber: string;
  title: string;
  category: string | null;
  tenderMode: string | null;
  authority: string | null;
  authorityType: string | null;
  state: string | null;
  location: string | null;
  powerMW: number | null;
  energyMWh: number | null;
  durationHours: number | null;
  connectivityType: string | null;
  biddingStructure: string | null;
  bespaSigning: string | null;
  preBidDate: Timestamp | null;
  preBidLink: string | null;
  bidDeadline: Timestamp | null;
  emdDeadline: Timestamp | null;
  techBidOpeningDate: Timestamp | null;
  financialBidOpeningDate: Timestamp | null;
  documentLink: string | null;
  minimumBidSize: string | null;
  maxAllocationPerBidder: string | null;
  gridConnected: string | null;
  roundTripEfficiency: string | null;
  minimumAnnualAvailability: string | null;
  dailyCycles: number | null;
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
  documents: { name: string; url: string; uploadDate: string | null }[] | null;

  // Contact Info (from PDF extraction)
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;

  // Additional dates (from PDF — more precise)
  bidSubmissionOnline: string | null;
  bidSubmissionOffline: string | null;
  bidOpeningDate: string | null;

  daysLeft: number | null;
  tenderStatus: string;
  sourceUrl: string | null;
  sources: string[];
  assignedTo: string | null;
  flags: Record<string, string>;
  notes: Record<string, string>;
  firstSeenAt: Timestamp | null;
  lastUpdatedAt: Timestamp | null;
}

const JUNK_TITLE_PATTERNS = [
  /^screen reader/i, /^search\s*\|/i, /^\d{2}-\w{3}-\d{4}\s*search/i,
  /^mis reports/i, /^visitor no/i, /^active tenders$/i, /^tenders by/i, /^contents owned/i,
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
  editedBy: string;
  editedByUid: string;
  editedAt: Timestamp;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export async function updateTender(
  tenderId: string,
  data: Partial<Tender>,
  oldTender: Tender,
  userEmail: string,
  userUid: string
) {
  const ref = doc(db, "tenders", tenderId);
  await updateDoc(ref, { ...data, lastUpdatedAt: Timestamp.now() });

  const skipFields = new Set(["lastUpdatedAt", "flags", "notes", "daysLeft", "tenderStatus", "durationHours", "vgfEligible", "nitNumber", "sources", "firstSeenAt"]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const formatVal = (v: unknown) => {
    if (v == null) return null;
    if (typeof (v as { toDate?: () => Date }).toDate === "function")
      return (v as Timestamp).toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return v;
  };
  for (const key of Object.keys(data) as (keyof Tender)[]) {
    if (skipFields.has(key)) continue;
    const oldNorm = oldTender[key] ?? null;
    const newNorm = data[key] ?? null;
    if (oldNorm === null && newNorm === null) continue;
    // For Timestamps, compare by date string (day level) not milliseconds
    const isOldTs = oldNorm && typeof (oldNorm as { toDate?: () => Date }).toDate === "function";
    const isNewTs = newNorm && typeof (newNorm as { toDate?: () => Date }).toDate === "function";
    if (isOldTs && isNewTs) {
      const oldDay = (oldNorm as Timestamp).toDate().toISOString().slice(0, 10);
      const newDay = (newNorm as Timestamp).toDate().toISOString().slice(0, 10);
      if (oldDay === newDay) continue; // Same date — skip
    }
    const oldCmp = isOldTs ? (oldNorm as Timestamp).toMillis() : oldNorm;
    const newCmp = isNewTs ? (newNorm as Timestamp).toMillis() : newNorm;
    if (oldCmp !== newCmp) changes[key] = { from: formatVal(oldNorm), to: formatVal(newNorm) };
  }
  if (Object.keys(changes).length > 0) {
    await addDoc(collection(db, "tenders", tenderId, "editHistory"), {
      editedBy: userEmail, editedByUid: userUid, editedAt: Timestamp.now(), changes,
    });
  }
}

export async function getEditHistory(tenderId: string, max = 20): Promise<EditHistoryEntry[]> {
  const q = query(collection(db, "tenders", tenderId, "editHistory"), orderBy("editedAt", "desc"), limit(max));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as EditHistoryEntry);
}

export async function updateFlag(tenderId: string, uid: string, flag: string) {
  await updateDoc(doc(db, "tenders", tenderId), { [`flags.${uid}`]: flag, lastUpdatedAt: Timestamp.now() });
}

export async function updateNote(tenderId: string, uid: string, note: string) {
  await updateDoc(doc(db, "tenders", tenderId), { [`notes.${uid}`]: note, lastUpdatedAt: Timestamp.now() });
}

// ── Alerts ──

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
  const q = query(collection(db, "alerts"), orderBy("createdAt", "desc"), limit(max));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Alert);
}

// ── Companies ──

export interface Company {
  id: string;
  name: string;
  type: "Developer" | "Board" | "Private" | "Other";
  bidsWon: number;
  bidsLost: number;
  totalCapacityMWh: number;
  createdAt: Timestamp | null;
}

export async function getCompanies(): Promise<Company[]> {
  const snapshot = await getDocs(collection(db, "companies"));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Company);
}

export async function getCompany(id: string): Promise<Company | null> {
  const snap = await getDoc(doc(db, "companies", id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Company) : null;
}

export async function updateCompany(id: string, data: Partial<Company>) {
  await updateDoc(doc(db, "companies", id), data);
}

// ── Contacts ──

export interface Contact {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
}

export async function getContacts(): Promise<Contact[]> {
  const snapshot = await getDocs(collection(db, "contacts"));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact);
}

export async function getContactsByCompany(companyId: string): Promise<Contact[]> {
  const q = query(collection(db, "contacts"), where("companyId", "==", companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact);
}

export async function addContact(data: Omit<Contact, "id">): Promise<string> {
  const ref = await addDoc(collection(db, "contacts"), data);
  return ref.id;
}

export async function updateContact(id: string, data: Partial<Contact>) {
  await updateDoc(doc(db, "contacts", id), data);
}

export async function deleteContact(id: string) {
  await deleteDoc(doc(db, "contacts", id));
}

// ── Bids ──

export interface Bid {
  id: string;
  companyId: string;
  companyName: string;
  tenderNit: string;
  tenderName: string;
  category: string | null;
  capacityMWh: number | null;
  priceStandalone: number | null;  // Lakhs/MW
  priceFDRE: number | null;       // Rs/KWh
  state: string | null;
  result: "won" | "lost" | "pending";
  reference: string | null;
}

export async function getBids(): Promise<Bid[]> {
  const snapshot = await getDocs(collection(db, "bids"));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Bid);
}

export async function getBidsByCompany(companyId: string): Promise<Bid[]> {
  const q = query(collection(db, "bids"), where("companyId", "==", companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Bid);
}

export async function getBidsByTender(tenderNit: string): Promise<Bid[]> {
  const q = query(collection(db, "bids"), where("tenderNit", "==", tenderNit));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Bid);
}
