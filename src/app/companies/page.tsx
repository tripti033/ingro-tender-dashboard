"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getCompanies, addCompany, getMergeSuggestions, type Company } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const TYPE_OPTIONS = ["All", "Developer", "Board", "Private", "Other"];
const SORT_OPTIONS = ["Name (A-Z)", "Bids Won (desc)", "Bids Lost (desc)", "Capacity (desc)"];

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    Developer: "bg-blue-100 text-blue-800",
    Board: "bg-green-100 text-green-800",
    Private: "bg-purple-100 text-purple-800",
    Other: "bg-gray-100 text-gray-700",
  };
  return colors[type] || colors.Other;
}

function CompaniesContent() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Bids Won (desc)");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "Developer" as "Developer" | "Board" | "Private" | "Other" });
  const [saving, setSaving] = useState(false);
  const [pendingMerges, setPendingMerges] = useState(0);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await addCompany({ name: form.name.trim(), type: form.type, bidsWon: 0, bidsLost: 0, totalCapacityMWh: 0, createdAt: null });
      const updated = await getCompanies();
      setCompanies(updated);
      setForm({ name: "", type: "Developer" });
      setShowAdd(false);
    } catch { /* */ }
    finally { setSaving(false); }
  };

  useEffect(() => {
    getCompanies().then(setCompanies).finally(() => setLoading(false));
    getMergeSuggestions("pending").then((s) => setPendingMerges(s.length)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let result = [...companies];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (typeFilter !== "All") result = result.filter((c) => c.type === typeFilter);
    result.sort((a, b) => {
      switch (sortBy) {
        case "Name (A-Z)": return a.name.localeCompare(b.name);
        case "Bids Won (desc)": return (b.bidsWon || 0) - (a.bidsWon || 0);
        case "Bids Lost (desc)": return (b.bidsLost || 0) - (a.bidsLost || 0);
        case "Capacity (desc)": return (b.totalCapacityMWh || 0) - (a.totalCapacityMWh || 0);
        default: return 0;
      }
    });
    return result;
  }, [companies, search, typeFilter, sortBy]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Companies</h1>
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors">
            {showAdd ? "Cancel" : "+ Add Company"}
          </button>
        </div>

        {pendingMerges > 0 && (
          <button
            onClick={() => router.push("/companies/merges")}
            className="w-full mb-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm flex items-center justify-between hover:bg-amber-100 transition-colors"
          >
            <span>
              <strong>{pendingMerges}</strong> possible duplicate group{pendingMerges === 1 ? "" : "s"} detected.
              <span className="text-amber-700"> Review and merge &rarr;</span>
            </span>
            <span className="text-amber-600">&rarr;</span>
          </button>
        )}

        {showAdd && (
          <div className="bg-white rounded-lg border p-5 mb-4">
            <div className="flex items-center gap-3">
              <input type="text" placeholder="Company Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "Developer" | "Board" | "Private" | "Other" })}
                className="border rounded-lg px-3 py-2 text-sm">
                <option>Developer</option><option>Board</option><option>Private</option><option>Other</option>
              </select>
              <button onClick={handleAdd} disabled={saving || !form.name.trim()}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {saving ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input type="text" placeholder="Search company..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            {SORT_OPTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="text-sm text-gray-400 ml-auto">
            {filtered.length} of {companies.length} companies
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No companies match your search</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Company Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Bids Won</th>
                  <th className="px-4 py-3 text-right">Bids Lost</th>
                  <th className="px-4 py-3 text-right">Total Capacity (MWh)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/company/${encodeURIComponent(c.id)}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge(c.type)}`}>{c.type}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.bidsWon > 0 ? <span className="text-green-600 font-semibold">{c.bidsWon}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.bidsLost > 0 ? <span className="text-red-500">{c.bidsLost}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.totalCapacityMWh > 0 ? c.totalCapacityMWh.toLocaleString() : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  return <AuthGuard><CompaniesContent /></AuthGuard>;
}
