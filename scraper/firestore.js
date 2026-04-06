import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  Timestamp,
} from "firebase/firestore";
import {
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";

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
  const errors = [];

  for (const tender of tenders) {
    try {
      const docRef = doc(db, "tenders", tender.nitNumber);
      const docSnap = await getDoc(docRef);

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
          "preBidLink",
        ];

        let hasChanges = false;
        for (const field of fieldsToCheck) {
          if (existing[field] == null && tender[field] != null) {
            updates[field] = tender[field];
            hasChanges = true;
          }
          // Always update dynamic fields
          if (field === "daysLeft" || field === "tenderStatus") {
            if (tender[field] !== existing[field]) {
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
    `[Firestore] New: ${newCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`
  );

  return { newCount, updatedCount, skippedCount, errors };
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
