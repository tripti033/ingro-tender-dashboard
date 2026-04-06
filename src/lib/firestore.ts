import {
  collection,
  getDocs,
  doc,
  updateDoc,
  Timestamp,
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

export async function getTenders(): Promise<Tender[]> {
  const snapshot = await getDocs(collection(db, "tenders"));
  return snapshot.docs.map((d) => ({ nitNumber: d.id, ...d.data() }) as Tender);
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
