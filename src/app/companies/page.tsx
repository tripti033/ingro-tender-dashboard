"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getCompanies, type Company } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Navbar from "@/components/Navbar";

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

  useEffect(() => {
    getCompanies().then(setCompanies).finally(() => setLoading(false));
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
      <Navbar />
      <div className="px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Companies</h1>

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
