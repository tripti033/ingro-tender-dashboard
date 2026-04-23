import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  Timestamp,
} from "firebase/firestore";
import {
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { findParentNit } from "./corrigendum.js";

let db = null;
let authenticated = false;

/**
 * Initialise Firebase client SDK and sign in with the scraper service account.
 * Uses email/password auth with a dedicated @ingroenergy.com account
 * so all writes pass Firestore security rules.
 */
export async function initFirestore() {
  if (db && authenticated) return db;

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      "Missing Firebase config. Ensure NEXT_PUBLIC_FIREBASE_API_KEY and FIREBASE_PROJECT_ID are set in .env"
    );
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);

  // Sign in with the dedicated scraper account
  const email = process.env.FIREBASE_SCRAPER_EMAIL;
  const password = process.env.FIREBASE_SCRAPER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Missing FIREBASE_SCRAPER_EMAIL or FIREBASE_SCRAPER_PASSWORD in .env"
    );
  }

  const auth = getAuth(app);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  console.log(`[Firestore] Signed in as ${cred.user.email}`);
  authenticated = true;

  return db;
}

/**
 * Re-export Timestamp so other modules can use it without importing firebase directly.
 */
export { Timestamp };

/**
 * Write normalised tenders to Firestore.
 * - New tenders: set() full document with firstSeenAt = now
 * - Existing tenders: update() only changed fields, merge sources, update lastUpdatedAt
 *
 * Returns { newCount, updatedCount, skippedCount, errors }
 */
export async function writeTenders(tenders) {
  const db = await initFirestore();
  const now = Timestamp.now();

  let newCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let corrigendaLinked = 0;
  const errors = [];

  // One-time load of every existing tender so we can resolve parent NITs for
  // corrigenda that don't self-declare their parent. We only pull the handful
  // of fields needed for fuzzy matching.
  const existingSnap = await getDocs(collection(db, "tenders"));
  const existingLite = existingSnap.docs.map((d) => {
    const t = d.data();
    return {
      nitNumber: d.id,
      title: t.title || "",
      authority: t.authority || null,
      powerMW: t.powerMW ?? null,
      energyMWh: t.energyMWh ?? null,
      isCorrigendum: !!t.isCorrigendum,
    };
  });

  for (const tender of tenders) {
    try {
      // Resolve corrigendum → parent link. If source didn't set corrigendumOf,
      // try fuzzy match against the known existing tenders (+ other rows
      // already seen in this batch).
      if (tender.isCorrigendum && !tender.corrigendumOf) {
        const pool = existingLite.concat(
          tenders
            .filter((t) => t !== tender && !t.isCorrigendum)
            .map((t) => ({
              nitNumber: t.nitNumber, title: t.title || "",
              authority: t.authority || null, powerMW: t.powerMW ?? null,
              energyMWh: t.energyMWh ?? null, isCorrigendum: false,
            })),
        );
        tender.corrigendumOf = findParentNit(tender, pool);
      }

      // Drop corrigenda whose parent we can't find. An unlinked corrigendum
      // is useless (no "View parent" target, no tender-under-amendment context)
      // and clutters the UI. The parent may show up in a later scrape — the
      // corrigendum will then too, and it'll link correctly.
      if (tender.isCorrigendum) {
        const parentId = tender.corrigendumOf;
        const parentInBatch = parentId && tenders.some(
          (t) => t !== tender && !t.isCorrigendum && t.nitNumber === parentId,
        );
        const parentInDb = parentId && existingLite.some((t) => t.nitNumber === parentId);
        if (!parentId || (!parentInBatch && !parentInDb)) {
          skippedCount++;
          console.log(`[Corrigendum] skip orphan ${tender.nitNumber} (no parent found)`);
          continue;
        }
      }

      const docRef = doc(db, "tenders", tender.nitNumber);
      const docSnap = await getDoc(docRef);

      // Mirror the corrigendum into the parent's subcollection + push a new
      // deadline up if one was issued.
      if (tender.isCorrigendum && tender.corrigendumOf) {
        try {
          const parentRef = doc(db, "tenders", tender.corrigendumOf);
          const parentSnap = await getDoc(parentRef);
          if (parentSnap.exists()) {
            const parent = parentSnap.data();
            const corrRef = doc(collection(parentRef, "corrigenda"), tender.nitNumber);
            await setDoc(corrRef, {
              parentNit: tender.corrigendumOf,
              childNit: tender.nitNumber,
              title: tender.title,
              issuedAt: tender.firstSeenAt || now,
              bidDeadline: tender.bidDeadline || null,
              emdDeadline: tender.emdDeadline || null,
              documentLink: tender.documentLink || null,
              source: (tender.sources || [])[0] || null,
              summary: null,
              changes: [],
              extractedAt: null,
            }, { merge: true });

            // If the corrigendum has a newer deadline than the parent, adopt it
            const parentDl = parent.bidDeadline;
            const newDl = tender.bidDeadline;
            if (newDl && (!parentDl || (newDl.toMillis && parentDl.toMillis && newDl.toMillis() > parentDl.toMillis()))) {
              await updateDoc(parentRef, {
                bidDeadline: newDl,
                lastUpdatedAt: now,
                corrigendumCount: (parent.corrigendumCount || 0) + 1,
              });
            } else {
              await updateDoc(parentRef, {
                corrigendumCount: (parent.corrigendumCount || 0) + 1,
                lastUpdatedAt: now,
              });
            }
            corrigendaLinked++;
          }
        } catch (err) {
          console.log(`[Corrigendum] failed to link ${tender.nitNumber} → ${tender.corrigendumOf}: ${err.message}`);
        }
      }

      if (!docSnap.exists()) {
        // New tender — write full document
        await setDoc(docRef, {
          ...tender,
          firstSeenAt: now,
          lastUpdatedAt: now,
        });
        newCount++;
      } else {
        // Existing tender — update changed fields and merge sources
        const existing = docSnap.data();

        // Merge sources arrays
        const mergedSources = Array.from(
          new Set([...(existing.sources || []), ...(tender.sources || [])])
        );

        // Build update object: only fields that changed or were null
        const updates = { lastUpdatedAt: now, sources: mergedSources };

        const fieldsToCheck = [
          "title",
          "category",
          "tenderMode",
          "authorityType",
          "state",
          "location",
          "powerMW",
          "energyMWh",
          "durationHours",
          "connectivityType",
          "emdAmount",
          "emdUnit",
          "vgfEligible",
          "biddingStructure",
          "bidDeadline",
          "emdDeadline",
          "preBidDate",
          "techBidOpeningDate",
          "financialBidOpeningDate",
          "bespaSigning",
          "daysLeft",
          "tenderStatus",
          "documentLink",
          "documents",
          "preBidLink",
          "sourceUrl",
          "isCorrigendum",
          "corrigendumOf",
        ];

        let hasChanges = false;
        for (const field of fieldsToCheck) {
          if (existing[field] == null && tender[field] != null) {
            updates[field] = tender[field];
            hasChanges = true;
          }
          // Always update dynamic fields, URLs, and documents
          if (["daysLeft", "tenderStatus", "sourceUrl", "documentLink", "documents"].includes(field)) {
            if (tender[field] != null && tender[field] !== existing[field]) {
              updates[field] = tender[field];
              hasChanges = true;
            }
          }
        }

        if (hasChanges || mergedSources.length > (existing.sources || []).length) {
          await updateDoc(docRef, updates);
          updatedCount++;
        } else {
          skippedCount++;
        }
      }
    } catch (err) {
      const msg = `Error writing tender ${tender.nitNumber}: ${err.message}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `[Firestore] New: ${newCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, Corrigenda linked: ${corrigendaLinked}, Errors: ${errors.length}`
  );

  return { newCount, updatedCount, skippedCount, corrigendaLinked, errors };
}

/**
 * Write Mercom alerts to the alerts collection.
 * Uses sourceUrl as a dedup key — skip if already exists.
 * Returns number of new alerts written.
 */
export async function writeAlerts(rawAlerts) {
  const db = await initFirestore();
  const now = Timestamp.now();
  let written = 0;

  for (const { raw, source } of rawAlerts) {
    try {
      // Use a slug of the title as document ID for dedup
      const id = (raw.title || "")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 8)
        .join("-")
        .toLowerCase()
        .slice(0, 60);

      if (!id) continue;

      const docRef = doc(db, "alerts", id);
      const existing = await getDoc(docRef);

      if (!existing.exists()) {
        await setDoc(docRef, {
          title: raw.title || "",
          source,
          sourceUrl: raw.sourceUrl || raw.documentLink || null,
          publishedAt: raw.bidDeadline ? Timestamp.fromDate(new Date(raw.bidDeadline)) : now,
          authority: raw.authority || null,
          powerMW: raw.powerMW || null,
          energyMWh: raw.energyMWh || null,
          category: raw.category || null,
          createdAt: now,
        });
        written++;
      }
    } catch (err) {
      console.error(`[Firestore] Alert write error: ${err.message}`);
    }
  }

  console.log(`[Firestore] Alerts: ${written} new, ${rawAlerts.length - written} skipped`);
  return written;
}

/**
 * Write an ingestion log entry for this scraper run.
 */
export async function writeIngestionLog(logEntry) {
  const db = await initFirestore();
  const logsCol = collection(db, "ingestion_log");
  await addDoc(logsCol, {
    ...logEntry,
    runAt: Timestamp.now(),
  });
  console.log("[Firestore] Ingestion log written");
}
