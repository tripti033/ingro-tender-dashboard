"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getTenders, type Tender } from "@/lib/firestore";

type ReminderType = "closing" | "preBid" | "techBid" | "financialBid" | "bidOpening" | "emdDeadline";

interface Reminder {
  type: ReminderType;
  tender: Tender;
  date: Date;
  days: number;
}

const TYPE_LABEL: Record<ReminderType, string> = {
  closing: "Bid Deadline",
  preBid: "Pre-Bid Meeting",
  techBid: "Tech Bid Opening",
  financialBid: "Financial Bid Opening",
  bidOpening: "Bid Opening",
  emdDeadline: "EMD Deadline",
};

const TYPE_COLOR: Record<ReminderType, string> = {
  closing: "bg-red-100 text-red-700",
  preBid: "bg-indigo-100 text-indigo-700",
  techBid: "bg-amber-100 text-amber-700",
  financialBid: "bg-emerald-100 text-emerald-700",
  bidOpening: "bg-purple-100 text-purple-700",
  emdDeadline: "bg-pink-100 text-pink-700",
};

function toDate(v: unknown): Date | null {
  if (!v) return null;
  try {
    if (typeof (v as { toDate?: () => Date }).toDate === "function") return (v as { toDate: () => Date }).toDate();
    const d = new Date(v as string);
    return isNaN(+d) ? null : d;
  } catch { return null; }
}

function daysFromNow(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function ReminderBell({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Background fetch on mount. Don't block.
    getTenders().then((tenders) => {
      const items: Reminder[] = [];
      for (const t of tenders) {
        if (t.tenderStatus === "closed" || t.tenderStatus === "awarded" || t.tenderStatus === "cancelled") continue;

        // Bid deadline — 4 days before (0..4 inclusive)
        const bd = toDate(t.bidDeadline);
        if (bd) {
          const days = daysFromNow(bd);
          if (days >= 0 && days <= 4) items.push({ type: "closing", tender: t, date: bd, days });
        }

        // Other dates — 1 day before (0 or 1)
        const checks: [ReminderType, unknown][] = [
          ["preBid", t.preBidDate],
          ["techBid", t.techBidOpeningDate],
          ["financialBid", t.financialBidOpeningDate],
          ["bidOpening", t.bidOpeningDate],
          ["emdDeadline", t.emdDeadline],
        ];
        for (const [type, raw] of checks) {
          const d = toDate(raw);
          if (!d) continue;
          const days = daysFromNow(d);
          if (days === 0 || days === 1) items.push({ type, tender: t, date: d, days });
        }
      }
      items.sort((a, b) => a.days - b.days || a.date.getTime() - b.date.getTime());
      setReminders(items);
    }).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const count = reminders.length;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        title={`${count} reminder${count === 1 ? "" : "s"}`}
        className="relative text-gray-400 hover:text-white p-1.5 rounded hover:bg-[#1a1d24]/10 transition-colors"
      >
        {/* Alarm-clock icon — visually distinct from the Alerts bell nav item */}
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5l3-2m15 2l-3-2" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed top-16 bg-[#1a1d24] rounded-lg shadow-xl border border-gray-800 w-96 max-h-[75vh] overflow-y-auto z-[60]"
          style={{ left: collapsed ? "4.5rem" : "14.5rem" }}
        >
          <div className="sticky top-0 bg-[#1a1d24] border-b px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-100">Reminders</h3>
            <span className="text-xs text-gray-400">{count} item{count === 1 ? "" : "s"}</span>
          </div>
          {count === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">
              No upcoming reminders.<br />
              <span className="text-xs">Bid deadlines (4d out) and meetings (1d out) will show here.</span>
            </div>
          ) : (
            <div className="divide-y">
              {reminders.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/tender/${encodeURIComponent(r.tender.nitNumber)}`);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-[#13161c] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${TYPE_COLOR[r.type]}`}>
                      {TYPE_LABEL[r.type]}
                    </span>
                    <span className={`text-xs font-semibold whitespace-nowrap ${r.days === 0 ? "text-red-600" : r.days === 1 ? "text-amber-600" : "text-gray-500"}`}>
                      {r.days === 0 ? "Today" : r.days === 1 ? "Tomorrow" : `in ${r.days}d`}
                    </span>
                  </div>
                  <div className="text-sm text-gray-100 line-clamp-2 leading-snug">
                    {r.tender.title || r.tender.nitNumber}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <span>{r.tender.authority || "\u2014"}</span>
                    <span>&middot;</span>
                    <span>{formatDate(r.date)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
