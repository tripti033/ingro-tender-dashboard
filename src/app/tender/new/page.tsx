"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const CATEGORIES = ["Standalone", "FDRE", "S+S", "PSP", "Hybrid", "Pump Storage Plant"];
const MODES = ["EPC", "BOOT", "BOO", "BOT", "DBOO", "DBFOO", "BOQ"];
const CONNECTIVITY = ["STU / ISC", "ISTS"];
const INGRO_TEAM = ["Aman", "Ankit", "Tripti", "Khushi", "Virendra"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-gray-100">
      <label className="text-sm text-gray-500 w-40 shrink-0">{label}</label>
      {children}
    </div>
  );
}

function NewTenderContent() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const f = (key: string) => form[key] || "";
  const sf = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

  const inputClass = "text-sm border rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20";

  const handleSubmit = async () => {
    if (!f("title")) { setError("Title is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const parseNum = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

      const nitNumber = await createTender({
        nitNumber: f("nitNumber") || undefined,
        title: f("title"),
        authority: f("authority") || null,
        category: f("category") || null,
        tenderMode: f("tenderMode") || null,
        location: f("location") || null,
        state: f("state") || null,
        powerMW: parseNum(f("powerMW")),
        energyMWh: parseNum(f("energyMWh")),
        connectivityType: f("connectivityType") || null,
        biddingStructure: f("biddingStructure") || null,
        assignedTo: f("assignedTo") || null,
        documentLink: f("documentLink") || null,
        sourceUrl: f("sourceUrl") || null,
        emdAmount: parseNum(f("emdAmount")),
        tenderStatus: "active",
        daysLeft: null,
        awardedTo: null,
        developedBy: null,
      });
      router.push(`/tender/${encodeURIComponent(nitNumber)}`);
    } catch (err) {
      setError("Failed to create tender. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content max-w-3xl mx-auto px-6 py-6">
        <button onClick={() => router.push("/dashboard")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">
          &larr; All Tenders
        </button>

        <h1 className="text-xl font-bold text-gray-900 mb-6">New Tender</h1>

        {error && <div className="mb-4 bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

        <div className="bg-white rounded-lg border p-6 space-y-0">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Basic Details</h2>
          <Field label="NIT Number"><input type="text" value={f("nitNumber")} onChange={sf("nitNumber")} placeholder="e.g. SECI-2025-TN000015" className={inputClass} /></Field>
          <Field label="Title *"><input type="text" value={f("title")} onChange={sf("title")} placeholder="Tender title" className={inputClass} /></Field>
          <Field label="Authority"><input type="text" value={f("authority")} onChange={sf("authority")} placeholder="SECI, NTPC, GUVNL..." className={inputClass} /></Field>
          <Field label="Category">
            <select value={f("category")} onChange={sf("category")} className={inputClass}>
              <option value="">Select</option>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Tender Mode">
            <select value={f("tenderMode")} onChange={sf("tenderMode")} className={inputClass}>
              <option value="">Select</option>
              {MODES.map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Location"><input type="text" value={f("location")} onChange={sf("location")} placeholder="City, State" className={inputClass} /></Field>
          <Field label="State"><input type="text" value={f("state")} onChange={sf("state")} placeholder="Rajasthan, Gujarat..." className={inputClass} /></Field>
          <Field label="Power (MW)"><input type="number" value={f("powerMW")} onChange={sf("powerMW")} placeholder="0" className={inputClass} /></Field>
          <Field label="Energy (MWh)"><input type="number" value={f("energyMWh")} onChange={sf("energyMWh")} placeholder="0" className={inputClass} /></Field>
          <Field label="Connectivity">
            <select value={f("connectivityType")} onChange={sf("connectivityType")} className={inputClass}>
              <option value="">Select</option>
              {CONNECTIVITY.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Bidding Structure"><input type="text" value={f("biddingStructure")} onChange={sf("biddingStructure")} placeholder="Two-Envelope + e-RA" className={inputClass} /></Field>
          <Field label="EMD Amount (INR)"><input type="number" value={f("emdAmount")} onChange={sf("emdAmount")} placeholder="0" className={inputClass} /></Field>
          <Field label="Assigned To">
            <select value={f("assignedTo")} onChange={sf("assignedTo")} className={inputClass}>
              <option value="">Select</option>
              {INGRO_TEAM.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>

          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-6 mb-4">Links</h2>
          <Field label="Document Link"><input type="text" value={f("documentLink")} onChange={sf("documentLink")} placeholder="https://..." className={inputClass} /></Field>
          <Field label="Source URL"><input type="text" value={f("sourceUrl")} onChange={sf("sourceUrl")} placeholder="https://..." className={inputClass} /></Field>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={handleSubmit} disabled={saving}
            className="bg-[#0D1F3C] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#162d52] disabled:opacity-50 transition-colors">
            {saving ? "Creating..." : "Create Tender"}
          </button>
          <button onClick={() => router.push("/dashboard")}
            className="border border-gray-300 text-gray-600 px-6 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NewTenderPage() {
  return <AuthGuard><NewTenderContent /></AuthGuard>;
}
