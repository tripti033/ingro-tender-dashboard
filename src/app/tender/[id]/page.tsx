"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { type User } from "firebase/auth";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onAuthChange } from "@/lib/auth";
import { updateFlag, updateNote, updateTender, getEditHistory, getBidsByTender, type Tender, type EditHistoryEntry, type Bid } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Navbar from "@/components/Navbar";

const FLAG_OPTIONS = [
  { label: "Watching", color: "border-blue-500 bg-blue-50 text-blue-700" },
  { label: "Applying", color: "border-green-500 bg-green-50 text-green-700" },
  { label: "Not Interested", color: "border-gray-400 bg-gray-50 text-gray-600" },
  { label: "Don\u2019t Qualify", color: "border-red-400 bg-red-50 text-red-700" },
  { label: "Expired", color: "border-gray-400 bg-gray-50 text-gray-500" },
];

const STATUS_PIPELINE = [
  { value: "tender_open", label: "Tender Open", color: "bg-blue-500" },
  { value: "bidding_open", label: "Bidding Open", color: "bg-amber-500" },
  { value: "active", label: "Active", color: "bg-green-500" },
  { value: "closing_soon", label: "Closing Soon", color: "bg-orange-500" },
  { value: "assigned", label: "Assigned", color: "bg-indigo-500" },
  { value: "signed_ppa", label: "Signed PPA", color: "bg-emerald-500" },
  { value: "closed", label: "Closed", color: "bg-gray-400" },
  { value: "cancelled", label: "Cancelled", color: "bg-red-500" },
  { value: "awarded", label: "Awarded", color: "bg-teal-500" },
];

const INGRO_TEAM = ["Aman", "Ankit", "Tripti", "Khushi", "Virendra"];

const CATEGORY_OPTIONS = ["Standalone", "FDRE", "S+S", "PSP", "Hybrid", "Pump Storage Plant"];
const MODE_OPTIONS = ["EPC", "BOOT", "BOO", "BOT", "DBOO", "DBFOO", "BOQ"];
const CONNECTIVITY_OPTIONS = ["STU / ISC", "ISTS"];

// ── Helpers ──

function formatFullDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return "\u2014"; }
}

function formatShortDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "\u2014"; }
}

function tsToInputValue(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toISOString().slice(0, 10);
  } catch { return ""; }
}

function inputToTimestamp(val: string): Timestamp | null {
  if (!val) return null;
  const d = new Date(val + "T12:00:00+05:30");
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

function formatINR(val: number | null): string {
  if (val == null) return "\u2014";
  if (val >= 10000000) return `\u20B9${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `\u20B9${(val / 100000).toFixed(2)} L`;
  return `\u20B9${val.toLocaleString("en-IN")}`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { active: "bg-green-100 text-green-800", closing_soon: "bg-amber-100 text-amber-800", closed: "bg-red-100 text-red-800", awarded: "bg-blue-100 text-blue-800" };
  const labels: Record<string, string> = { active: "Active", closing_soon: "Closing Soon", closed: "Closed", awarded: "Awarded" };
  return <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${styles[status] || "bg-gray-100 text-gray-700"}`}>{labels[status] || status}</span>;
}

// ── Display Row (view mode) ──

function Row({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-2.5 border-b border-gray-100 ${highlight ? "bg-yellow-50 -mx-5 px-5" : ""}`}>
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%]">{value || "\u2014"}</span>
    </div>
  );
}

// ── Edit Row components ──

function EditText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 gap-3">
      <label className="text-gray-500 text-sm shrink-0">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || "\u2014"}
        className="text-sm font-medium text-right border rounded px-2 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
    </div>
  );
}

function EditNumber({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 gap-3">
      <label className="text-gray-500 text-sm shrink-0">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || "0"} step="any"
        className="text-sm font-medium text-right border rounded px-2 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
    </div>
  );
}

function EditSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 gap-3">
      <label className="text-gray-500 text-sm shrink-0">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="text-sm font-medium text-right border rounded px-2 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20">
        <option value="">— Select —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function EditDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 gap-3">
      <label className="text-gray-500 text-sm shrink-0">{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)}
        className="text-sm font-medium text-right border rounded px-2 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Main Component ──

function TenderDetailContent() {
  const router = useRouter();
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const [user, setUser] = useState<User | null>(null);
  const [tender, setTender] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  // Edit history
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([]);
  const [tenderBids, setTenderBids] = useState<Bid[]>([]);

  // Flag & note
  const [selectedFlag, setSelectedFlag] = useState("");
  const [flagSaved, setFlagSaved] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { return onAuthChange(setUser); }, []);

  // Load edit history and bids
  useEffect(() => {
    if (id) {
      getEditHistory(id).then(setEditHistory).catch(() => {});
      getBidsByTender(id).then(setTenderBids).catch(() => {});
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "tenders", id));
        if (snap.exists()) setTender({ nitNumber: snap.id, ...snap.data() } as Tender);
        else setError("Tender not found.");
      } catch { setError("Failed to load tender."); }
      finally { setLoading(false); }
    })();
  }, [id]);

  useEffect(() => {
    if (tender && user) {
      setSelectedFlag(tender.flags?.[user.uid] || "");
      setNoteText(tender.notes?.[user.uid] || "");
    }
  }, [tender, user]);

  // Populate form from tender when entering edit mode
  const startEditing = useCallback(() => {
    if (!tender) return;
    const t = tender;
    setForm({
      title: t.title || "",
      category: t.category || "",
      tenderMode: t.tenderMode || "",
      authority: t.authority || "",
      location: t.location || "",
      powerMW: t.powerMW != null ? String(t.powerMW) : "",
      energyMWh: t.energyMWh != null ? String(t.energyMWh) : "",
      connectivityType: t.connectivityType || "",
      biddingStructure: t.biddingStructure || "",
      bespaSigning: t.bespaSigning || "",
      assignedTo: t.assignedTo || "",
      preBidDate: tsToInputValue(t.preBidDate),
      preBidLink: t.preBidLink || "",
      bidDeadline: tsToInputValue(t.bidDeadline),
      emdDeadline: tsToInputValue(t.emdDeadline),
      techBidOpeningDate: tsToInputValue(t.techBidOpeningDate),
      financialBidOpeningDate: tsToInputValue(t.financialBidOpeningDate),
      documentLink: t.documentLink || "",
      // Technical
      minimumBidSize: t.minimumBidSize || "",
      maxAllocationPerBidder: t.maxAllocationPerBidder || "",
      gridConnected: t.gridConnected || "",
      roundTripEfficiency: t.roundTripEfficiency || "",
      minimumAnnualAvailability: t.minimumAnnualAvailability || "",
      dailyCycles: t.dailyCycles != null ? String(t.dailyCycles) : "",
      // Financial
      financialClosure: t.financialClosure || "",
      scodMonths: t.scodMonths || "",
      gracePeriod: t.gracePeriod || "",
      tenderProcessingFee: t.tenderProcessingFee != null ? String(t.tenderProcessingFee) : "",
      tenderDocumentFee: t.tenderDocumentFee != null ? String(t.tenderDocumentFee) : "",
      vgfAmount: t.vgfAmount != null ? String(t.vgfAmount) : "",
      emdAmount: t.emdAmount != null ? String(t.emdAmount) : "",
      pbgAmount: t.pbgAmount != null ? String(t.pbgAmount) : "",
      successCharges: t.successCharges != null ? String(t.successCharges) : "",
      paymentSecurityFund: t.paymentSecurityFund != null ? String(t.paymentSecurityFund) : "",
      portalRegistrationFee: t.portalRegistrationFee != null ? String(t.portalRegistrationFee) : "",
      totalCost: t.totalCost != null ? String(t.totalCost) : "",
      sourceUrl: t.sourceUrl || "",
    });
    setEditing(true);
    setSaveMsg(null);
  }, [tender]);

  const handleSave = async () => {
    if (!tender) return;
    setSaving(true);
    setSaveMsg(null);

    const parseNum = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

    const powerMW = parseNum(form.powerMW);
    const energyMWh = parseNum(form.energyMWh);
    const bidDeadline = inputToTimestamp(form.bidDeadline);

    // Compute daysLeft and tenderStatus
    let daysLeft: number | null = null;
    let tenderStatus = "active";
    if (bidDeadline) {
      daysLeft = Math.ceil((bidDeadline.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) tenderStatus = "closed";
      else if (daysLeft <= 7) tenderStatus = "closing_soon";
    }

    const updates: Partial<Tender> = {
      title: form.title || tender.title,
      category: form.category || null,
      tenderMode: form.tenderMode || null,
      authority: form.authority || null,
      location: form.location || null,
      powerMW,
      energyMWh,
      durationHours: powerMW && energyMWh ? Math.round((energyMWh / powerMW) * 100) / 100 : null,
      connectivityType: form.connectivityType || null,
      biddingStructure: form.biddingStructure || null,
      bespaSigning: form.bespaSigning || null,
      preBidDate: inputToTimestamp(form.preBidDate),
      preBidLink: form.preBidLink || null,
      bidDeadline,
      emdDeadline: inputToTimestamp(form.emdDeadline),
      techBidOpeningDate: inputToTimestamp(form.techBidOpeningDate),
      financialBidOpeningDate: inputToTimestamp(form.financialBidOpeningDate),
      documentLink: form.documentLink || null,
      minimumBidSize: form.minimumBidSize || null,
      maxAllocationPerBidder: form.maxAllocationPerBidder || null,
      gridConnected: form.gridConnected || null,
      roundTripEfficiency: form.roundTripEfficiency || null,
      minimumAnnualAvailability: form.minimumAnnualAvailability || null,
      dailyCycles: parseNum(form.dailyCycles),
      financialClosure: form.financialClosure || null,
      scodMonths: form.scodMonths || null,
      gracePeriod: form.gracePeriod || null,
      tenderProcessingFee: parseNum(form.tenderProcessingFee),
      tenderDocumentFee: parseNum(form.tenderDocumentFee),
      vgfAmount: parseNum(form.vgfAmount),
      vgfEligible: !!parseNum(form.vgfAmount),
      emdAmount: parseNum(form.emdAmount),
      pbgAmount: parseNum(form.pbgAmount),
      successCharges: parseNum(form.successCharges),
      paymentSecurityFund: parseNum(form.paymentSecurityFund),
      portalRegistrationFee: parseNum(form.portalRegistrationFee),
      totalCost: parseNum(form.totalCost),
      sourceUrl: form.sourceUrl || null,
      assignedTo: form.assignedTo || null,
      daysLeft,
      tenderStatus,
    };

    try {
      await updateTender(tender.nitNumber, updates, tender, user?.email || "unknown", user?.uid || "");
      setTender({ ...tender, ...updates } as Tender);
      setEditing(false);
      setSaveMsg("Saved successfully");
      // Refresh edit history
      getEditHistory(id).then(setEditHistory).catch(() => {});
      setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const f = (key: string) => form[key] || "";
  const sf = (key: string) => (v: string) => setForm((p) => ({ ...p, [key]: v }));

  const handleFlagSelect = async (flag: string) => {
    if (!user || !tender) return;
    const newFlag = flag === selectedFlag ? "" : flag;
    setSelectedFlag(newFlag);
    try { await updateFlag(tender.nitNumber, user.uid, newFlag); setFlagSaved(true); setTimeout(() => setFlagSaved(false), 2000); } catch { /* */ }
  };

  const handleSaveNote = async () => {
    if (!user || !tender) return;
    try { await updateNote(tender.nitNumber, user.uid, noteText); setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2000); } catch { /* */ }
  };

  if (loading) return <div className="min-h-screen bg-gray-50"><Navbar /><div className="flex items-center justify-center py-32"><div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-[#0D1F3C]" /></div></div>;

  if (error || !tender) return (
    <div className="min-h-screen bg-gray-50"><Navbar /><div className="max-w-4xl mx-auto px-6 py-12">
      <button onClick={() => router.push("/dashboard")} className="text-[#0D1F3C] hover:underline text-sm mb-6">&larr; All Tenders</button>
      <p className="text-red-600">{error || "Tender not found."}</p>
    </div></div>
  );

  const t = tender;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => router.push("/dashboard")} className="text-[#0D1F3C] hover:underline text-sm">&larr; All Tenders</button>
          {!editing ? (
            <button onClick={startEditing} className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors">
              Edit Tender
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => setEditing(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 transition-colors">
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        {saveMsg && <div className={`mb-4 text-sm px-4 py-2 rounded-lg ${saveMsg.includes("Failed") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{saveMsg}</div>}

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t.title || t.nitNumber}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <code onClick={() => { navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="text-sm bg-gray-100 px-3 py-1 rounded font-mono cursor-pointer hover:bg-gray-200" title="Click to copy">{t.nitNumber}</code>
            {copied && <span className="text-xs text-green-600">Copied!</span>}
            <StatusBadge status={t.tenderStatus} />
            {t.daysLeft != null && t.daysLeft >= 0 && <span className="text-sm text-gray-500">{t.daysLeft} days left</span>}
            {t.assignedTo && <span className="text-sm bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{t.assignedTo}</span>}
          </div>

          {/* Status Pipeline — only show for non-terminal statuses */}
          {!["closed", "cancelled", "awarded"].includes(t.tenderStatus) && (
          <div className="flex items-center gap-1 mt-4 overflow-x-auto pb-1">
            {STATUS_PIPELINE.map((s, i) => {
              const isActive = t.tenderStatus === s.value;
              return (
                <button key={s.value}
                  onClick={async () => {
                    if (!user) return;
                    await updateTender(t.nitNumber, { tenderStatus: s.value } as Partial<Tender>, t, user.email || "", user.uid);
                    setTender({ ...t, tenderStatus: s.value });
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                    isActive ? `${s.color} text-white shadow-sm` : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  {s.label}
                </button>
              );
            })}
          </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1 — Basic + Dates */}
          <div className="space-y-6">
            <Section title="Basic Details">
              {editing ? (
                <>
                  <EditText label="Title" value={f("title")} onChange={sf("title")} />
                  <EditText label="Authority" value={f("authority")} onChange={sf("authority")} />
                  <EditSelect label="Category" value={f("category")} onChange={sf("category")} options={CATEGORY_OPTIONS} />
                  <EditSelect label="Tender Mode" value={f("tenderMode")} onChange={sf("tenderMode")} options={MODE_OPTIONS} />
                  <EditText label="Location" value={f("location")} onChange={sf("location")} />
                  <EditNumber label="Power (MW)" value={f("powerMW")} onChange={sf("powerMW")} />
                  <EditNumber label="Energy (MWh)" value={f("energyMWh")} onChange={sf("energyMWh")} />
                  <EditSelect label="Connectivity" value={f("connectivityType")} onChange={sf("connectivityType")} options={CONNECTIVITY_OPTIONS} />
                  <EditText label="Bidding Structure" value={f("biddingStructure")} onChange={sf("biddingStructure")} />
                  <EditText label="BESPA Signing" value={f("bespaSigning")} onChange={sf("bespaSigning")} />
                  <EditSelect label="Assigned To" value={f("assignedTo")} onChange={sf("assignedTo")} options={INGRO_TEAM} />
                </>
              ) : (
                <>
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
                  <Row label="Assigned To" value={t.assignedTo ? (
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium">{t.assignedTo}</span>
                  ) : null} />
                </>
              )}
            </Section>

            <Section title="Key Dates">
              {editing ? (
                <>
                  <EditDate label="Pre-Bid Meeting" value={f("preBidDate")} onChange={sf("preBidDate")} />
                  <EditText label="Pre-Bid Link" value={f("preBidLink")} onChange={sf("preBidLink")} placeholder="https://..." />
                  <EditDate label="Bid Deadline" value={f("bidDeadline")} onChange={sf("bidDeadline")} />
                  <EditDate label="EMD Deadline" value={f("emdDeadline")} onChange={sf("emdDeadline")} />
                  <EditDate label="Tech Bid Opening" value={f("techBidOpeningDate")} onChange={sf("techBidOpeningDate")} />
                  <EditDate label="Financial Bid Opening" value={f("financialBidOpeningDate")} onChange={sf("financialBidOpeningDate")} />
                  <EditText label="Bid Documents Link" value={f("documentLink")} onChange={sf("documentLink")} placeholder="https://..." />
                  <EditText label="Source URL" value={f("sourceUrl")} onChange={sf("sourceUrl")} placeholder="https://..." />
                </>
              ) : (
                <>
                  <Row label="Pre-Bid Meeting" value={formatFullDate(t.preBidDate)} />
                  <Row label="Bid Deadline" value={formatFullDate(t.bidDeadline)} highlight />
                  <Row label="EMD Deadline" value={formatFullDate(t.emdDeadline)} />
                  <Row label="Tech Bid Opening" value={formatFullDate(t.techBidOpeningDate)} />
                  <Row label="Financial Bid Opening" value={formatFullDate(t.financialBidOpeningDate)} />
                </>
              )}
            </Section>

            {!editing && (
              <Section title="Documents & Links">
                {/* All documents */}
                {t.documents && t.documents.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {t.documents.map((d, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                        <a href={d.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm text-[#0D1F3C] hover:underline flex items-center gap-1.5 min-w-0">
                          <span className="shrink-0">{d.name.endsWith(".pdf") ? "\uD83D\uDCC4" : "\uD83D\uDCCE"}</span>
                          <span className="truncate">{d.name}</span>
                        </a>
                        {d.uploadDate && <span className="text-xs text-gray-400 shrink-0 ml-2">{d.uploadDate.split(" ")[0]}</span>}
                      </div>
                    ))}
                  </div>
                ) : t.documentLink ? (
                  <div className="mb-4">
                    <a href={t.documentLink} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52]">
                      Bid Documents &rarr;
                    </a>
                  </div>
                ) : null}
                {/* Other links */}
                <div className="flex flex-wrap gap-3">
                  {t.preBidLink && <a href={t.preBidLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 border border-[#0D1F3C] text-[#0D1F3C] px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Pre-bid Meeting &rarr;</a>}
                  {t.sourceUrl && <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-[#0D1F3C] hover:underline py-2">View Source &rarr;</a>}
                </div>
              </Section>
            )}
          </div>

          {/* Column 2 — Technical + Financial */}
          <div className="space-y-6">
            <Section title="Technical Details">
              {editing ? (
                <>
                  <EditText label="Min Bid Size" value={f("minimumBidSize")} onChange={sf("minimumBidSize")} placeholder="50 MW x 2h = 100 MWh" />
                  <EditText label="Max per Bidder" value={f("maxAllocationPerBidder")} onChange={sf("maxAllocationPerBidder")} placeholder="500 MW / 1000 MWh" />
                  <EditSelect label="Grid Connected" value={f("gridConnected")} onChange={sf("gridConnected")} options={["Yes", "No"]} />
                  <EditText label="Round Trip Efficiency" value={f("roundTripEfficiency")} onChange={sf("roundTripEfficiency")} placeholder="≥85%" />
                  <EditText label="Min Annual Availability" value={f("minimumAnnualAvailability")} onChange={sf("minimumAnnualAvailability")} placeholder="≥95%" />
                  <EditNumber label="Daily Cycles" value={f("dailyCycles")} onChange={sf("dailyCycles")} placeholder="2" />
                </>
              ) : (
                <>
                  <Row label="Min Bid Size" value={t.minimumBidSize} />
                  <Row label="Max per Bidder" value={t.maxAllocationPerBidder} />
                  <Row label="Grid Connected" value={t.gridConnected} />
                  <Row label="Round Trip Efficiency" value={t.roundTripEfficiency} />
                  <Row label="Min Annual Availability" value={t.minimumAnnualAvailability} />
                  <Row label="Daily Cycles" value={t.dailyCycles != null ? String(t.dailyCycles) : null} />
                </>
              )}
            </Section>

            <Section title="Financial Details">
              {editing ? (
                <>
                  <EditText label="Financial Closure" value={f("financialClosure")} onChange={sf("financialClosure")} placeholder="12 Months" />
                  <EditText label="SCOD / CoD" value={f("scodMonths")} onChange={sf("scodMonths")} placeholder="18 Months" />
                  <EditText label="Grace Period" value={f("gracePeriod")} onChange={sf("gracePeriod")} placeholder="9 Months" />
                  <EditNumber label="VGF Amount (INR)" value={f("vgfAmount")} onChange={sf("vgfAmount")} />
                  <EditNumber label="EMD (INR)" value={f("emdAmount")} onChange={sf("emdAmount")} />
                  <EditNumber label="PBG (INR)" value={f("pbgAmount")} onChange={sf("pbgAmount")} />
                  <EditNumber label="Processing Fee (INR)" value={f("tenderProcessingFee")} onChange={sf("tenderProcessingFee")} />
                  <EditNumber label="Document Fee (INR)" value={f("tenderDocumentFee")} onChange={sf("tenderDocumentFee")} />
                  <EditNumber label="Success Charges (INR)" value={f("successCharges")} onChange={sf("successCharges")} />
                  <EditNumber label="Payment Security (INR)" value={f("paymentSecurityFund")} onChange={sf("paymentSecurityFund")} />
                  <EditNumber label="Portal Reg Fee (INR)" value={f("portalRegistrationFee")} onChange={sf("portalRegistrationFee")} />
                  <EditNumber label="Total Cost (INR)" value={f("totalCost")} onChange={sf("totalCost")} />
                </>
              ) : (
                <>
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
                </>
              )}
            </Section>
          </div>

          {/* Column 3 — Team Actions */}
          <div className="space-y-6">
            {/* Bids on this tender */}
            {tenderBids.length > 0 && (
              <Section title={`Bids (${tenderBids.length})`}>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {tenderBids.map((b) => (
                    <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <button onClick={() => router.push(`/company/${encodeURIComponent(b.companyId)}`)}
                          className="text-sm font-medium text-[#0D1F3C] hover:underline">{b.companyName}</button>
                        <div className="text-xs text-gray-400">
                          {b.capacityMWh ? `${b.capacityMWh} MWh` : ""}
                          {b.priceStandalone ? ` \u00B7 ${b.priceStandalone} L/MW` : ""}
                          {b.priceFDRE ? ` \u00B7 ${b.priceFDRE} Rs/KWh` : ""}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        b.result === "won" ? "bg-green-100 text-green-800" : b.result === "lost" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                      }`}>{b.result}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Your Flag">
              <div className="space-y-2">
                {FLAG_OPTIONS.map((opt) => (
                  <button key={opt.label} onClick={() => handleFlagSelect(opt.label)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${selectedFlag === opt.label ? opt.color : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {flagSaved && <p className="text-xs text-green-600 mt-2">Saved</p>}
            </Section>

            <Section title="Your Notes">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20 resize-none" placeholder="Add private notes..." />
              <div className="flex items-center gap-3 mt-2">
                <button onClick={handleSaveNote} className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52]">Save Note</button>
                {noteSaved && <span className="text-xs text-green-600">Saved</span>}
              </div>
            </Section>

            <Section title="Sources">
              <div className="flex flex-wrap gap-2">
                {(t.sources || []).map((src) => <span key={src} className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{src}</span>)}
              </div>
            </Section>

            <Section title="Metadata">
              <Row label="First seen" value={formatShortDate(t.firstSeenAt)} />
              <Row label="Last updated" value={formatShortDate(t.lastUpdatedAt)} />
            </Section>

            {/* Edit History */}
            {editHistory.length > 0 && (
              <Section title={`Recent Edits (${editHistory.length})`}>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {editHistory.map((entry) => (
                    <div key={entry.id} className="border-b border-gray-100 pb-3 last:border-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-gray-700">
                          {entry.editedBy}
                        </span>
                        <span className="text-xs text-gray-400">
                          {entry.editedAt && typeof entry.editedAt.toDate === "function"
                            ? entry.editedAt.toDate().toLocaleDateString("en-IN", {
                                day: "2-digit", month: "short", year: "numeric",
                                hour: "2-digit", minute: "2-digit",
                              })
                            : "\u2014"}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {Object.entries(entry.changes || {}).map(([field, change]) => (
                          <div key={field} className="text-xs text-gray-500">
                            <span className="font-medium text-gray-600">{field}</span>
                            {": "}
                            <span className="text-red-400 line-through">
                              {change.from != null ? String(change.from) : "empty"}
                            </span>
                            {" \u2192 "}
                            <span className="text-green-600">
                              {change.to != null ? String(change.to) : "empty"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TenderDetailPage() {
  return <AuthGuard><TenderDetailContent /></AuthGuard>;
}
