"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMergeSuggestions, approveMerge, rejectMerge, type MergeSuggestion } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function MergesContent() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [canonicalByGroup, setCanonicalByGroup] = useState<Record<string, string>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMergeSuggestions("pending")
      .then((items) => {
        setSuggestions(items);
        const init: Record<string, string> = {};
        items.forEach((s) => { init[s.id] = s.suggestedCanonicalId; });
        setCanonicalByGroup(init);
      })
      .catch(() => setError("Failed to load suggestions"))
      .finally(() => setLoading(false));
  }, []);

  const handleApprove = async (s: MergeSuggestion) => {
    const canonicalId = canonicalByGroup[s.id];
    const sources = s.companyIds.filter((id) => id !== canonicalId);
    if (sources.length === 0) return;
    if (!confirm(`Merge ${sources.length} companies into "${s.companies.find((c) => c.id === canonicalId)?.name}"? This cannot be undone.`)) return;
    setWorkingId(s.id);
    try {
      await approveMerge(s.id, canonicalId, sources);
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      setError(`Merge failed: ${(e as Error).message}`);
    } finally {
      setWorkingId(null);
    }
  };

  const handleReject = async (s: MergeSuggestion) => {
    setWorkingId(s.id);
    try {
      await rejectMerge(s.id);
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      setError(`Reject failed: ${(e as Error).message}`);
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <button onClick={() => router.push("/companies")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">
          &larr; Back to Companies
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Merge Suggestions</h1>
            <p className="text-sm text-gray-500 mt-1">
              Groups of companies that look like duplicates. Pick the canonical one, then approve.
            </p>
          </div>
          <span className="text-sm text-gray-400">{suggestions.length} pending</span>
        </div>

        {error && <div className="mb-4 bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

        {loading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p>No pending suggestions.</p>
            <p className="text-xs mt-2">Run <code className="bg-gray-100 px-1.5 py-0.5 rounded">node scraper/suggest-merges.js</code> to generate new ones.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {suggestions.map((s) => {
              const canonicalId = canonicalByGroup[s.id];
              const isWorking = workingId === s.id;
              return (
                <div key={s.id} className="bg-white rounded-lg border p-5">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">
                    Normalized key: <span className="font-mono text-gray-600">{s.normalizedKey}</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-gray-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="pb-2 pr-3 w-16">Keep</th>
                          <th className="pb-2 pr-3">Name</th>
                          <th className="pb-2 pr-3 text-right w-24">Bids Won</th>
                          <th className="pb-2 pr-3 text-right w-24">Bids Lost</th>
                          <th className="pb-2 pr-3 text-right w-32">Capacity (MWh)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {s.companies.map((c) => (
                          <tr key={c.id} className={c.id === canonicalId ? "bg-green-50" : ""}>
                            <td className="py-2.5 pr-3">
                              <input
                                type="radio"
                                name={`canonical-${s.id}`}
                                checked={c.id === canonicalId}
                                onChange={() => setCanonicalByGroup((p) => ({ ...p, [s.id]: c.id }))}
                                disabled={isWorking}
                              />
                            </td>
                            <td className="py-2.5 pr-3 font-medium">{c.name}</td>
                            <td className="py-2.5 pr-3 text-right">
                              {c.bidsWon > 0 ? <span className="text-green-600 font-semibold">{c.bidsWon}</span> : <span className="text-gray-300">0</span>}
                            </td>
                            <td className="py-2.5 pr-3 text-right">
                              {c.bidsLost > 0 ? <span className="text-red-500">{c.bidsLost}</span> : <span className="text-gray-300">0</span>}
                            </td>
                            <td className="py-2.5 pr-3 text-right">
                              {c.totalCapacityMWh > 0 ? c.totalCapacityMWh.toLocaleString() : <span className="text-gray-300">{"\u2014"}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => handleApprove(s)}
                      disabled={isWorking}
                      className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] disabled:opacity-50 transition-colors"
                    >
                      {isWorking ? "Merging\u2026" : "Approve merge"}
                    </button>
                    <button
                      onClick={() => handleReject(s)}
                      disabled={isWorking}
                      className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      Not duplicates
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MergesPage() {
  return <AuthGuard><MergesContent /></AuthGuard>;
}
