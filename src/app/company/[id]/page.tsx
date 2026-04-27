"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getCompany, getBidsByCompany, getContactsByCompany, type Company, type Bid, type Contact } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-lg border p-5">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    Developer: "bg-blue-100 text-blue-800",
    Board: "bg-green-100 text-green-800",
    Private: "bg-purple-100 text-purple-800",
  };
  return colors[type] || "bg-gray-800 text-gray-300";
}

function CompanyProfileContent() {
  const router = useRouter();
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const [company, setCompany] = useState<Company | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [bidFilter, setBidFilter] = useState<"all" | "won" | "lost">("all");

  useEffect(() => {
    Promise.all([
      getCompany(id).then(setCompany),
      getBidsByCompany(id).then(setBids),
      getContactsByCompany(id).then(setContacts),
    ]).finally(() => setLoading(false));
  }, [id]);

  const filteredBids = bids.filter((b) => bidFilter === "all" || b.result === bidFilter);
  const won = bids.filter((b) => b.result === "won");
  const lost = bids.filter((b) => b.result === "lost");

  if (loading) return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100"><Sidebar />
      <div className="sidebar-content flex items-center justify-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-800 border-t-[#0D1F3C]" />
      </div>
    </div>
  );

  if (!company) return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100"><Sidebar />
      <div className="sidebar-content max-w-4xl mx-auto px-6 py-12">
        <button onClick={() => router.push("/companies")} className="text-[#0D1F3C] hover:underline text-sm mb-6">&larr; All Companies</button>
        <p className="text-red-600">Company not found.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />
      <div className="sidebar-content max-w-6xl mx-auto px-6 py-6">
        <button onClick={() => router.push("/companies")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">&larr; All Companies</button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-100">{company.name}</h1>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${typeBadge(company.type)}`}>{company.type}</span>
          </div>
          {/* Stats row */}
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{won.length}</div>
              <div className="text-xs text-gray-500">Bids Won</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{lost.length}</div>
              <div className="text-xs text-gray-500">Bids Lost</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-200">{bids.length}</div>
              <div className="text-xs text-gray-500">Total Bids</div>
            </div>
            {company.totalCapacityMWh > 0 && (
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{company.totalCapacityMWh.toLocaleString()}</div>
                <div className="text-xs text-gray-500">MWh Won</div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Bids — takes 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            <Section title={`Bidding History (${bids.length})`}>
              <div className="flex gap-2 mb-4">
                {(["all", "won", "lost"] as const).map((f) => (
                  <button key={f} onClick={() => setBidFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      bidFilter === f ? "bg-[#0D1F3C] text-white" : "bg-gray-800 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {f === "all" ? `All (${bids.length})` : f === "won" ? `Won (${won.length})` : `Lost (${lost.length})`}
                  </button>
                ))}
              </div>
              {filteredBids.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">No bids found</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-subtle)] text-left text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-3 py-2">Tender</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2 text-right">MWh</th>
                        <th className="px-3 py-2 text-right">Price (L/MW)</th>
                        <th className="px-3 py-2 text-right">Price (Rs/KWh)</th>
                        <th className="px-3 py-2">State</th>
                        <th className="px-3 py-2">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredBids.map((b) => (
                        <tr key={b.id} className="hover:bg-[var(--bg-subtle)]">
                          <td className="px-3 py-2 font-mono text-xs max-w-[200px] truncate" title={b.tenderNit}>
                            {b.tenderName || b.tenderNit || "\u2014"}
                          </td>
                          <td className="px-3 py-2 text-xs">{b.category || "\u2014"}</td>
                          <td className="px-3 py-2 text-right">{b.capacityMWh != null ? b.capacityMWh.toLocaleString() : "\u2014"}</td>
                          <td className="px-3 py-2 text-right">{b.priceStandalone != null ? b.priceStandalone.toFixed(2) : "\u2014"}</td>
                          <td className="px-3 py-2 text-right">{b.priceFDRE != null ? b.priceFDRE.toFixed(2) : "\u2014"}</td>
                          <td className="px-3 py-2 text-xs">{b.state || "\u2014"}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              b.result === "won" ? "bg-green-100 text-green-800" : b.result === "lost" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                            }`}>{b.result}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>

          {/* Contacts — right column */}
          <div className="space-y-6">
            <Section title={`Contacts (${contacts.length})`}>
              {contacts.length === 0 ? (
                <p className="text-sm text-gray-400 py-4">No contacts found</p>
              ) : (
                <div className="space-y-3">
                  {contacts.map((c) => (
                    <div key={c.id} className="border-b border-gray-800 pb-3 last:border-0">
                      <div className="font-medium text-sm">{c.name}</div>
                      {c.designation && <div className="text-xs text-gray-500">{c.designation}</div>}
                      {c.email && <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:underline block">{c.email}</a>}
                      {c.phone && <div className="text-xs text-gray-500">{c.phone}</div>}
                      {c.location && <div className="text-xs text-gray-400">{c.location}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CompanyProfilePage() {
  return <AuthGuard><CompanyProfileContent /></AuthGuard>;
}
