"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { type User } from "firebase/auth";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onAuthChange } from "@/lib/auth";
import { updateFlag, updateNote, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Navbar from "@/components/Navbar";

const FLAG_OPTIONS = [
  { label: "Watching", color: "border-blue-500 bg-blue-50 text-blue-700" },
  { label: "Applying", color: "border-green-500 bg-green-50 text-green-700" },
  { label: "Not Interested", color: "border-gray-400 bg-gray-50 text-gray-600" },
  { label: "Don\u2019t Qualify", color: "border-red-400 bg-red-50 text-red-700" },
  { label: "Expired", color: "border-gray-400 bg-gray-50 text-gray-500" },
];

function formatFullDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", {
      weekday: "short", day: "numeric", month: "long", year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch { return "\u2014"; }
}

function formatShortDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "\u2014"; }
}

function formatINR(val: number | null): string {
  if (val == null) return "\u2014";
  if (val >= 10000000) return `\u20B9${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `\u20B9${(val / 100000).toFixed(2)} L`;
  return `\u20B9${val.toLocaleString("en-IN")}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    closing_soon: "bg-amber-100 text-amber-800",
    closed: "bg-red-100 text-red-800",
    awarded: "bg-blue-100 text-blue-800",
  };
  const labels: Record<string, string> = {
    active: "Active", closing_soon: "Closing Soon", closed: "Closed", awarded: "Awarded",
  };
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${styles[status] || "bg-gray-100 text-gray-700"}`}>
      {labels[status] || status}
    </span>
  );
}

function Row({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-2.5 border-b border-gray-100 ${highlight ? "bg-yellow-50 -mx-5 px-5" : ""}`}>
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%]">{value || "\u2014"}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-5">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

function TenderDetailContent() {
  const router = useRouter();
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const [user, setUser] = useState<User | null>(null);
  const [tender, setTender] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<string>("");
  const [flagSaved, setFlagSaved] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { return onAuthChange(setUser); }, []);

  useEffect(() => {
    async function fetch() {
      try {
        const snap = await getDoc(doc(db, "tenders", id));
        if (snap.exists()) setTender({ nitNumber: snap.id, ...snap.data() } as Tender);
        else setError("Tender not found.");
      } catch { setError("Failed to load tender."); }
      finally { setLoading(false); }
    }
    fetch();
  }, [id]);

  useEffect(() => {
    if (tender && user) {
      setSelectedFlag(tender.flags?.[user.uid] || "");
      setNoteText(tender.notes?.[user.uid] || "");
    }
  }, [tender, user]);

  const handleFlagSelect = async (flag: string) => {
    if (!user || !tender) return;
    const newFlag = flag === selectedFlag ? "" : flag;
    setSelectedFlag(newFlag);
    setFlagSaved(false);
    try {
      await updateFlag(tender.nitNumber, user.uid, newFlag);
      setFlagSaved(true);
      setTimeout(() => setFlagSaved(false), 2000);
    } catch { /* */ }
  };

  const handleSaveNote = async () => {
    if (!user || !tender) return;
    try {
      await updateNote(tender.nitNumber, user.uid, noteText);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch { /* */ }
  };

  const handleCopyNit = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center py-32">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-[#0D1F3C]" />
        </div>
      </div>
    );
  }

  if (error || !tender) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-4xl mx-auto px-6 py-12">
          <button onClick={() => router.push("/dashboard")} className="text-[#0D1F3C] hover:underline text-sm mb-6 inline-block">&larr; All Tenders</button>
          <p className="text-red-600">{error || "Tender not found."}</p>
        </div>
      </div>
    );
  }

  const t = tender;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-6">
        <button onClick={() => router.push("/dashboard")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">&larr; All Tenders</button>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t.title || t.nitNumber}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <code onClick={handleCopyNit} className="text-sm bg-gray-100 px-3 py-1 rounded font-mono cursor-pointer hover:bg-gray-200" title="Click to copy">{t.nitNumber}</code>
            {copied && <span className="text-xs text-green-600">Copied!</span>}
            <StatusBadge status={t.tenderStatus} />
            {t.daysLeft != null && t.daysLeft >= 0 && (
              <span className="text-sm text-gray-500">{t.daysLeft} days left</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1 — Basic + Dates */}
          <div className="space-y-6">
            <Section title="Basic Details">
              <Row label="Authority" value={t.authority} />
              <Row label="Category" value={t.category} />
              <Row label="Tender Mode" value={t.tenderMode} />
              <Row label="Location" value={t.location} />
              <Row label="Power Capacity" value={t.powerMW != null ? `${t.powerMW.toLocaleString()} MW` : null} />
              <Row label="Energy Capacity" value={t.energyMWh != null ? `${t.energyMWh.toLocaleString()} MWh` : null} />
              <Row label="Duration" value={t.durationHours != null ? `${t.durationHours}h` : null} />
              <Row label="Connectivity" value={t.connectivityType} />
              <Row label="Bidding Structure" value={t.biddingStructure} />
              <Row label="BESPA Signing" value={t.bespaSigning} />
            </Section>

            <Section title="Key Dates">
              <Row label="Pre-Bid Meeting" value={formatFullDate(t.preBidDate)} />
              <Row label="Bid Deadline" value={formatFullDate(t.bidDeadline)} highlight />
              <Row label="EMD Deadline" value={formatFullDate(t.emdDeadline)} />
              <Row label="Tech Bid Opening" value={formatFullDate(t.techBidOpeningDate)} />
              <Row label="Financial Bid Opening" value={formatFullDate(t.financialBidOpeningDate)} />
            </Section>

            <Section title="Links">
              <div className="flex flex-wrap gap-3">
                {t.documentLink && (
                  <a href={t.documentLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52]">
                    Bid Documents &rarr;
                  </a>
                )}
                {t.preBidLink && (
                  <a href={t.preBidLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 border border-[#0D1F3C] text-[#0D1F3C] px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
                    Pre-bid Meeting &rarr;
                  </a>
                )}
                {t.sourceUrl && (
                  <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-[#0D1F3C] hover:underline py-2">
                    View Source &rarr;
                  </a>
                )}
              </div>
            </Section>
          </div>

          {/* Column 2 — Technical + Financial */}
          <div className="space-y-6">
            <Section title="Technical Details">
              <Row label="Min Bid Size" value={t.minimumBidSize} />
              <Row label="Max per Bidder" value={t.maxAllocationPerBidder} />
              <Row label="Grid Connected" value={t.gridConnected} />
              <Row label="Round Trip Efficiency" value={t.roundTripEfficiency} />
              <Row label="Min Annual Availability" value={t.minimumAnnualAvailability} />
              <Row label="Daily Cycles" value={t.dailyCycles != null ? String(t.dailyCycles) : null} />
            </Section>

            <Section title="Financial Details">
              <Row label="Financial Closure" value={t.financialClosure} />
              <Row label="SCOD / CoD" value={t.scodMonths} />
              <Row label="Grace Period" value={t.gracePeriod} />
              <Row label="VGF Amount" value={formatINR(t.vgfAmount)} highlight={!!t.vgfAmount} />
              <Row label="EMD (Refundable)" value={formatINR(t.emdAmount)} />
              <Row label="PBG (Refundable)" value={formatINR(t.pbgAmount)} />
              <Row label="Tender Processing Fee" value={formatINR(t.tenderProcessingFee)} />
              <Row label="Tender Document Fee" value={formatINR(t.tenderDocumentFee)} />
              <Row label="Success Charges" value={formatINR(t.successCharges)} />
              <Row label="Payment Security Fund" value={formatINR(t.paymentSecurityFund)} />
              <Row label="Portal Registration Fee" value={formatINR(t.portalRegistrationFee)} />
              <Row label="Total Cost" value={formatINR(t.totalCost)} highlight />
            </Section>
          </div>

          {/* Column 3 — Team Actions */}
          <div className="space-y-6">
            <Section title="Your Flag">
              <div className="space-y-2">
                {FLAG_OPTIONS.map((opt) => (
                  <button key={opt.label} onClick={() => handleFlagSelect(opt.label)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                      selectedFlag === opt.label ? opt.color : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {flagSaved && <p className="text-xs text-green-600 mt-2">Saved</p>}
            </Section>

            <Section title="Your Notes">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20 resize-none"
                placeholder="Add private notes..." />
              <div className="flex items-center gap-3 mt-2">
                <button onClick={handleSaveNote} className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52]">
                  Save Note
                </button>
                {noteSaved && <span className="text-xs text-green-600">Saved</span>}
              </div>
            </Section>

            <Section title="Sources">
              <div className="flex flex-wrap gap-2">
                {(t.sources || []).map((src) => (
                  <span key={src} className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{src}</span>
                ))}
              </div>
            </Section>

            <Section title="Metadata">
              <Row label="First seen" value={formatShortDate(t.firstSeenAt)} />
              <Row label="Last updated" value={formatShortDate(t.lastUpdatedAt)} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TenderDetailPage() {
  return <AuthGuard><TenderDetailContent /></AuthGuard>;
}
