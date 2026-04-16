"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getActivities, type Activity } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  flag: { icon: "F", color: "bg-blue-100 text-blue-700" },
  edit: { icon: "E", color: "bg-amber-100 text-amber-700" },
  note: { icon: "N", color: "bg-gray-100 text-gray-700" },
  status: { icon: "S", color: "bg-green-100 text-green-700" },
  assign: { icon: "A", color: "bg-indigo-100 text-indigo-700" },
  create: { icon: "+", color: "bg-emerald-100 text-emerald-700" },
  scrape: { icon: "R", color: "bg-cyan-100 text-cyan-700" },
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

function ActivityContent() {
  const router = useRouter();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getActivities(100).then(setActivities).finally(() => setLoading(false));
  }, []);

  // Group by date
  const grouped: { date: string; items: Activity[] }[] = [];
  let currentDate = "";
  for (const a of activities) {
    const dateStr = formatDate(a.createdAt);
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      grouped.push({ date: dateStr, items: [] });
    }
    grouped[grouped.length - 1].items.push(a);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6 max-w-3xl">
        <h1 className="text-xl font-bold text-gray-900 mb-6">Activity Feed</h1>

        {loading ? (
          <div className="space-y-4">{[...Array(8)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : activities.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No activity yet. Actions like editing tenders, changing flags, and status updates will appear here.</div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.date}>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{group.date}</div>
                <div className="space-y-2">
                  {group.items.map((a) => {
                    const typeInfo = TYPE_ICONS[a.type] || TYPE_ICONS.edit;
                    return (
                      <div key={a.id} className="bg-white rounded-lg border px-4 py-3 flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${typeInfo.color}`}>
                          {typeInfo.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">
                            <span className="font-medium text-gray-900">{a.userEmail?.split("@")[0]}</span>
                            {" "}
                            <span className="text-gray-500">{a.description}</span>
                          </div>
                          {a.tenderNit && (
                            <button
                              onClick={() => router.push(`/tender/${encodeURIComponent(a.tenderNit!)}`)}
                              className="text-xs text-[#0D1F3C] hover:underline mt-0.5 truncate block max-w-full"
                            >
                              {a.tenderTitle?.slice(0, 60) || a.tenderNit}
                            </button>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{timeAgo(a.createdAt)}</span>
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
  return <AuthGuard><Sidebar /><ActivityContent /></AuthGuard>;
}
