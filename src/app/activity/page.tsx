"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getActivities, type Activity } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  flag: { icon: "F", color: "bg-blue-100 text-blue-700" },
  edit: { icon: "E", color: "bg-amber-100 text-amber-700" },
  note: { icon: "N", color: "bg-gray-800 text-gray-300" },
  status: { icon: "S", color: "bg-green-100 text-green-700" },
  assign: { icon: "A", color: "bg-indigo-100 text-indigo-700" },
  create: { icon: "+", color: "bg-emerald-100 text-emerald-700" },
  scrape: { icon: "R", color: "bg-cyan-100 text-cyan-700" },
  merge: { icon: "M", color: "bg-purple-100 text-purple-700" },
};

function timeAgo(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch { return ""; }
}

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
}

interface TenderGroup {
  key: string;                 // tenderNit OR a synthetic id for non-tender activities
  tenderNit: string | null;
  tenderTitle: string | null;
  items: Activity[];
  latest: Activity;
}

function ActivityContent() {
  const router = useRouter();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getActivities(200).then(setActivities).finally(() => setLoading(false));
  }, []);

  // Group activities first by date, then within each date group, by tender.
  // "Group by tender" means: all events on the same tender on the same day
  // collapse into one card with a count + expandable list.
  const dateGroups = useMemo(() => {
    type DateGroup = { date: string; tenderGroups: TenderGroup[] };
    const out: DateGroup[] = [];
    let currentDate = "";
    let currentDg: DateGroup | null = null;

    for (const a of activities) {
      const dStr = formatDate(a.createdAt);
      if (dStr !== currentDate) {
        currentDate = dStr;
        currentDg = { date: dStr, tenderGroups: [] };
        out.push(currentDg);
      }
      const dg = currentDg!;
      // Merge consecutive activities on the same tender within the same date
      const groupKey = a.tenderNit ? `${dStr}::${a.tenderNit}` : `${dStr}::no-tender::${a.id}`;
      const existing = dg.tenderGroups.find((g) => g.key === groupKey);
      if (existing) {
        existing.items.push(a);
      } else {
        dg.tenderGroups.push({
          key: groupKey,
          tenderNit: a.tenderNit,
          tenderTitle: a.tenderTitle,
          items: [a],
          latest: a,
        });
      }
    }
    return out;
  }, [activities]);

  const toggle = (k: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-body)] text-gray-100">
      <Sidebar />
      <div className="sidebar-content px-6 py-6 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-100">Activity Feed</h1>
          <div className="flex items-center gap-3 text-xs">
            <button
              onClick={() => setExpanded(new Set(dateGroups.flatMap((dg) => dg.tenderGroups.map((g) => g.key))))}
              className="text-gray-500 hover:text-gray-200"
            >
              Expand all
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="text-gray-500 hover:text-gray-200"
            >
              Collapse all
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">{[...Array(8)].map((_, i) => <div key={i} className="h-16 bg-gray-800 rounded animate-pulse" />)}</div>
        ) : activities.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No activity yet. Actions like editing tenders, changing flags, and status updates will appear here.</div>
        ) : (
          <div className="space-y-6">
            {dateGroups.map((dg) => (
              <div key={dg.date}>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{dg.date}</div>
                <div className="space-y-2">
                  {dg.tenderGroups.map((g) => {
                    // Single-event group: render compactly without expansion
                    if (g.items.length === 1) {
                      const a = g.items[0];
                      const typeInfo = TYPE_ICONS[a.type] || TYPE_ICONS.edit;
                      return (
                        <div key={g.key} className="bg-[var(--bg-card)] rounded-lg border px-4 py-3 flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${typeInfo.color}`}>
                            {typeInfo.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">
                              <span className="font-medium text-gray-100">{a.userEmail?.split("@")[0]}</span>
                              {" "}
                              <span className="text-gray-500">{a.description}</span>
                            </div>
                            {a.tenderNit && (
                              <button
                                onClick={() => router.push(`/tender/${encodeURIComponent(a.tenderNit!)}?from=/activity`)}
                                className="text-xs text-[#0D1F3C] hover:underline mt-0.5 truncate block max-w-full"
                              >
                                {a.tenderTitle?.slice(0, 60) || a.tenderNit}
                              </button>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">{timeAgo(a.createdAt)}</span>
                        </div>
                      );
                    }

                    // Multi-event group: collapsible header + indented timeline
                    const isOpen = expanded.has(g.key);
                    const uniqueUsers = new Set(g.items.map((i) => (i.userEmail || "").split("@")[0]));
                    return (
                      <div key={g.key} className="bg-[var(--bg-card)] rounded-lg border overflow-hidden">
                        <button
                          onClick={() => toggle(g.key)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-subtle)] transition-colors text-left"
                        >
                          <span className={`text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                          <div className="flex-1 min-w-0">
                            {g.tenderNit ? (
                              <div className="text-sm font-medium text-gray-100 truncate">
                                {g.tenderTitle || g.tenderNit}
                              </div>
                            ) : (
                              <div className="text-sm font-medium text-gray-100">Other actions</div>
                            )}
                            <div className="text-xs text-gray-500 mt-0.5">
                              <span className="font-medium text-gray-300">{g.items.length} change{g.items.length === 1 ? "" : "s"}</span>
                              {" — "}
                              {Array.from(uniqueUsers).slice(0, 2).join(", ")}
                              {uniqueUsers.size > 2 && ` +${uniqueUsers.size - 2} more`}
                            </div>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">{timeAgo(g.latest.createdAt)}</span>
                        </button>

                        {isOpen && (
                          <div className="border-t bg-[var(--bg-subtle)]/50 px-4 py-2">
                            <ul className="space-y-1.5 ml-2">
                              {g.items.map((a) => {
                                const typeInfo = TYPE_ICONS[a.type] || TYPE_ICONS.edit;
                                return (
                                  <li key={a.id} className="flex items-start gap-2 text-sm py-1">
                                    <span className="text-gray-300 shrink-0 mt-0.5">↳</span>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${typeInfo.color}`}>
                                      {typeInfo.icon}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <span className="font-medium text-gray-300">{a.userEmail?.split("@")[0]}</span>
                                      {" "}
                                      <span className="text-gray-600">{a.description}</span>
                                    </div>
                                    <span className="text-xs text-gray-400 shrink-0">{timeAgo(a.createdAt)}</span>
                                  </li>
                                );
                              })}
                            </ul>
                            {g.tenderNit && (
                              <button
                                onClick={() => router.push(`/tender/${encodeURIComponent(g.tenderNit!)}?from=/activity`)}
                                className="text-xs text-[#0D1F3C] hover:underline mt-2 ml-2"
                              >
                                Open tender &rarr;
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ActivityPage() {
  return <AuthGuard><ActivityContent /></AuthGuard>;
}
