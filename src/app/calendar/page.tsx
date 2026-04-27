"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { type User } from "firebase/auth";
import { onAuthChange } from "@/lib/auth";
import { getTenders, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

type EventType = "deadline" | "prebid" | "emd" | "opening" | "financial";

interface CalendarEvent {
  date: Date;
  type: EventType;
  label: string;
  shortLabel: string;
  tender: Tender;
  color: string;
}

const EVENT_COLORS: Record<EventType, string> = {
  deadline: "bg-red-100 text-red-800 border-red-200",
  prebid: "bg-blue-100 text-blue-800 border-blue-200",
  emd: "bg-amber-100 text-amber-800 border-amber-200",
  opening: "bg-green-100 text-green-800 border-green-200",
  financial: "bg-purple-100 text-purple-800 border-purple-200",
};

function tsToDate(ts: { toDate?: () => Date } | null): Date | null {
  if (!ts) return null;
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function CalendarContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Independent filter chips — each can be on/off
  const [filters, setFilters] = useState({
    myOnly: false,
    bessOnly: false,
    deadlinesOnly: false,
    emdOnly: false,
  });
  const toggle = (k: keyof typeof filters) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  useEffect(() => { return onAuthChange(setUser); }, []);
  useEffect(() => {
    getTenders().then(setTenders).finally(() => setLoading(false));
  }, []);

  const meKey = useMemo(() => (user?.email || "").split("@")[0].toLowerCase(), [user]);

  // Build all events from tenders
  const allEvents = useMemo(() => {
    const events: CalendarEvent[] = [];
    for (const t of tenders) {
      const bidDeadline = tsToDate(t.bidDeadline);
      if (bidDeadline) events.push({ date: bidDeadline, type: "deadline", label: "Bid Deadline", shortLabel: "Bid", tender: t, color: EVENT_COLORS.deadline });

      const preBid = tsToDate(t.preBidDate);
      if (preBid) events.push({ date: preBid, type: "prebid", label: "Pre-Bid Meeting", shortLabel: "Pre-Bid", tender: t, color: EVENT_COLORS.prebid });

      const emd = tsToDate(t.emdDeadline);
      if (emd) events.push({ date: emd, type: "emd", label: "EMD Deadline", shortLabel: "EMD", tender: t, color: EVENT_COLORS.emd });

      const tech = tsToDate(t.techBidOpeningDate);
      if (tech) events.push({ date: tech, type: "opening", label: "Tech Bid Opening", shortLabel: "Tech", tender: t, color: EVENT_COLORS.opening });

      const fin = tsToDate(t.financialBidOpeningDate);
      if (fin) events.push({ date: fin, type: "financial", label: "Financial Opening", shortLabel: "Fin", tender: t, color: EVENT_COLORS.financial });
    }
    return events;
  }, [tenders]);

  // Apply chip filters
  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (filters.myOnly) {
        const a = (e.tender.assignedTo || "").toLowerCase();
        if (!a) return false;
        const matchesMe = meKey && (a.includes(meKey) || meKey.split(".").some((tok) => tok.length > 2 && a.includes(tok)));
        if (!matchesMe) return false;
      }
      if (filters.bessOnly) {
        const blob = `${e.tender.title || ""} ${e.tender.category || ""}`.toLowerCase();
        if (!blob.match(/\b(bess|battery|fdre|standalone|pumped storage|s\+s|hybrid)\b/i) && !e.tender.energyMWh) return false;
      }
      if (filters.deadlinesOnly && e.type !== "deadline") return false;
      if (filters.emdOnly && e.type !== "emd") return false;
      return true;
    });
  }, [allEvents, filters, meKey]);

  // Today's events
  const today = new Date();
  const todaysEvents = useMemo(
    () => filteredEvents.filter((e) => sameDay(e.date, today)).sort((a, b) => a.date.getTime() - b.date.getTime()),
    [filteredEvents], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Month grid
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const monthName = currentMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const monthEvents = useMemo(
    () => filteredEvents.filter((e) => e.date.getMonth() === month && e.date.getFullYear() === year),
    [filteredEvents, month, year],
  );

  const eventsByDay: Record<number, CalendarEvent[]> = {};
  for (const e of monthEvents) {
    const day = e.date.getDate();
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(e);
  }
  const isToday = (day: number) => today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;

  return (
    <div className="min-h-screen bg-[#0d1015] text-gray-100">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <h1 className="text-xl font-bold text-gray-100 mb-4">Calendar</h1>

        {/* Today's strip — immediate next-action context */}
        <div className="mb-4 bg-[#1a1d24] border rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="text-sm font-semibold text-gray-100 whitespace-nowrap">
            Today, {today.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
          </div>
          <span className="text-gray-300">—</span>
          {todaysEvents.length === 0 ? (
            <span className="text-sm text-gray-500">No events scheduled.</span>
          ) : (
            <>
              <span className="text-sm text-gray-600">
                {todaysEvents.length} event{todaysEvents.length === 1 ? "" : "s"}:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {todaysEvents.map((e, i) => (
                  <button
                    key={i}
                    onClick={() => router.push(`/tender/${encodeURIComponent(e.tender.nitNumber)}?from=/calendar`)}
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border ${e.color} hover:opacity-80`}
                    title={e.tender.title || ""}
                  >
                    {e.shortLabel} {e.tender.authority || ""}{e.tender.powerMW ? ` ${e.tender.powerMW}MW` : ""}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Filter chips — single-click toggles */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Chip active={filters.myOnly} onClick={() => toggle("myOnly")} label="My Tenders Only" />
          <Chip active={filters.bessOnly} onClick={() => toggle("bessOnly")} label="BESS Only" />
          <Chip active={filters.deadlinesOnly} onClick={() => { setFilters((f) => ({ ...f, deadlinesOnly: !f.deadlinesOnly, emdOnly: false })); }} label="Bid Deadlines Only" />
          <Chip active={filters.emdOnly} onClick={() => { setFilters((f) => ({ ...f, emdOnly: !f.emdOnly, deadlinesOnly: false })); }} label="EMD Only" />
          {(filters.myOnly || filters.bessOnly || filters.deadlinesOnly || filters.emdOnly) && (
            <button
              onClick={() => setFilters({ myOnly: false, bessOnly: false, deadlinesOnly: false, emdOnly: false })}
              className="text-xs text-gray-500 hover:text-gray-300 ml-1"
            >
              Clear
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} this view
          </span>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setCurrentMonth(new Date(year, month - 1))}
            className="text-sm text-gray-600 hover:text-[#0D1F3C] px-3 py-1.5 rounded hover:bg-gray-800">&larr; Prev</button>
          <h2 className="text-lg font-semibold text-gray-200">{monthName}</h2>
          <button onClick={() => setCurrentMonth(new Date(year, month + 1))}
            className="text-sm text-gray-600 hover:text-[#0D1F3C] px-3 py-1.5 rounded hover:bg-gray-800">Next &rarr;</button>
        </div>

        {/* Type legend (still useful for the colours in the grid) */}
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200" /> Bid Deadline</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-200" /> Pre-Bid</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200" /> EMD</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200" /> Tech Opening</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-200" /> Financial</span>
        </div>

        {loading ? (
          <div className="h-96 bg-gray-800 rounded animate-pulse" />
        ) : (
          <div className="bg-[#1a1d24] rounded-lg border overflow-hidden">
            <div className="grid grid-cols-7 bg-[#13161c] border-b">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="px-2 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: startPad }).map((_, i) => (
                <div key={`pad-${i}`} className="border-b border-r min-h-[100px] bg-[#13161c]/50" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayEvents = eventsByDay[day] || [];
                return (
                  <div key={day} className={`border-b border-r min-h-[100px] p-1.5 ${isToday(day) ? "bg-blue-50" : ""}`}>
                    <div className={`text-xs font-medium mb-1 ${isToday(day) ? "text-blue-700 font-bold" : "text-gray-500"}`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <button key={j}
                          onClick={() => router.push(`/tender/${encodeURIComponent(e.tender.nitNumber)}?from=/calendar`)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight border truncate ${e.color} hover:opacity-80 transition-opacity`}
                          title={`${e.label}: ${e.tender.title}`}>
                          {e.shortLabel}: {(e.tender.authority || "").slice(0, 8)} {e.tender.powerMW ? `${e.tender.powerMW}MW` : ""}
                        </button>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] text-gray-400 pl-1">+{dayEvents.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming list — kept */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Upcoming Events</h3>
          <div className="space-y-2">
            {filteredEvents
              .filter((e) => e.date >= new Date(today.getFullYear(), today.getMonth(), today.getDate()))
              .sort((a, b) => a.date.getTime() - b.date.getTime())
              .slice(0, 10)
              .map((e, i) => (
                <div key={i} onClick={() => router.push(`/tender/${encodeURIComponent(e.tender.nitNumber)}?from=/calendar`)}
                  className="bg-[#1a1d24] rounded-lg border px-4 py-3 flex items-center gap-4 hover:shadow-sm cursor-pointer transition-shadow">
                  <div className={`px-2 py-1 rounded text-xs font-medium border ${e.color}`}>{e.label}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-100 truncate">{e.tender.title?.slice(0, 60)}</div>
                    <div className="text-xs text-gray-400">{e.tender.authority} {e.tender.powerMW ? `| ${e.tender.powerMW} MW` : ""}</div>
                  </div>
                  <div className="text-sm text-gray-600 shrink-0">
                    {e.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? "bg-[#0D1F3C] text-white border-[#0D1F3C]"
          : "bg-[#1a1d24] text-gray-300 border-gray-300 hover:border-gray-400 hover:bg-[#13161c]"
      }`}
    >
      {label}
    </button>
  );
}

export default function CalendarPage() {
  return <AuthGuard><CalendarContent /></AuthGuard>;
}
