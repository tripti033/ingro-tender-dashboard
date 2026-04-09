import {
  collection,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "./firebase";

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
  emdAmount: number | null;
  emdUnit: string | null;
  vgfEligible: boolean;
  biddingStructure: string | null;
  bidDeadline: Timestamp | null;
  emdDeadline: Timestamp | null;
  preBidDate: Timestamp | null;
  techBidOpeningDate: Timestamp | null;
  financialBidOpeningDate: Timestamp | null;
  bespaSigning: Timestamp | null;
  daysLeft: number | null;
  tenderStatus: string;
  documentLink: string | null;
  preBidLink: string | null;
  sourceUrl: string | null;
  sources: string[];
  flags: Record<string, string>;
  notes: Record<string, string>;
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
