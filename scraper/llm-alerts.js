/**
 * Process alerts with LLM — adds relevance score, category, entities, insight.
 * Also auto-creates draft tenders from tender announcements.
 *
 * Usage:
 *   node scraper/llm-alerts.js           # Process all un-scored alerts
 *   node scraper/llm-alerts.js --all     # Re-process all alerts
 *
 * Requires Ollama running locally.
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, setDoc, Timestamp } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { processAlert, isLlmAvailable } from "./llm.js";

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, process.env.FIREBASE_SCRAPER_EMAIL, process.env.FIREBASE_SCRAPER_PASSWORD);
const db = getFirestore(app);

async function main() {
  if (!(await isLlmAvailable())) {
    console.error("Ollama is not running. Start with: ollama serve");
    process.exit(1);
  }

  const reprocessAll = process.argv.includes("--all");

  const snap = await getDocs(collection(db, "alerts"));
  const alerts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const candidates = alerts.filter((a) => {
    if (reprocessAll) return true;
    return !a.relevanceScore; // Only process un-scored alerts
  });

  console.log(`Processing ${candidates.length} of ${alerts.length} alerts\n`);

  let processed = 0;
  let draftsCreated = 0;

  for (const alert of candidates) {
    const title = alert.title || "";
    if (!title || title.length < 10) continue;

    console.log(`[${processed + 1}/${candidates.length}] ${title.slice(0, 80)}`);

    const result = await processAlert(title, alert.sourceUrl || "");
    if (!result) {
      console.log("  → LLM returned null, skipping");
      continue;
    }

    // Update alert in Firestore
    const updates = {
      relevanceScore: result.relevanceScore || null,
      alertCategory: result.category || null,
      authorities: result.authorities || null,
      companies: result.companies || null,
      states: result.states || null,
      isTenderAnnouncement: result.isTenderAnnouncement || false,
      oneLinerInsight: result.oneLinerInsight || null,
    };

    // Also update powerMW/energyMWh if LLM found them and existing is null
    if (result.powerMW && !alert.powerMW) updates.powerMW = result.powerMW;
    if (result.energyMWh && !alert.energyMWh) updates.energyMWh = result.energyMWh;
    if (result.authorities?.length && !alert.authority) updates.authority = result.authorities[0];

    await updateDoc(doc(db, "alerts", alert.id), updates);

    const score = result.relevanceScore || 0;
    const scoreBar = "=".repeat(score) + " ".repeat(10 - score);
    console.log(`  Score: [${scoreBar}] ${score}/10 | ${result.category}`);
    if (result.oneLinerInsight) console.log(`  Insight: ${result.oneLinerInsight}`);

    // Auto-create draft tender if this IS a tender announcement
    if (result.isTenderAnnouncement && score >= 7) {
      console.log(`  → TENDER ANNOUNCEMENT detected! Creating draft...`);

      const nitNumber = `DRAFT-${Date.now()}`;
      try {
        await setDoc(doc(db, "tenders", nitNumber), {
          nitNumber,
          title: title,
          authority: result.authorities?.[0] || null,
          category: null,
          tenderMode: null,
          powerMW: result.powerMW || null,
          energyMWh: result.energyMWh || null,
          state: result.states?.[0] || null,
          location: result.states?.[0] || null,
          sourceUrl: alert.sourceUrl || null,
          documentLink: null,
          tenderStatus: "tender_open",
          daysLeft: null,
          sources: ["Alert Auto-Draft"],
          flags: {},
          notes: {},
          readBy: {},
          awardedTo: null,
          developedBy: null,
          firstSeenAt: Timestamp.now(),
          lastUpdatedAt: Timestamp.now(),
        });
        draftsCreated++;
        console.log(`  → Draft created: ${nitNumber}`);
      } catch (err) {
        console.log(`  → Draft creation failed: ${err.message}`);
      }
    }

    processed++;
  }

  console.log(`\nDone. Processed: ${processed} | Drafts created: ${draftsCreated}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
