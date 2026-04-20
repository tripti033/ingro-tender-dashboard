"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getTenders, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

interface CalendarEvent {
  date: Date;
  type: "deadline" | "prebid" | "emd" | "opening" | "financial";
  label: string;
  tender: Tender;
  color: string;
}

const EVENT_COLORS: Record<string, string> = {
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

function CalendarContent() {
  const router = useRouter();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    getTenders().then(setTenders).finally(() => setLoading(false));
  }, []);

  // Extract all events from tenders
  const allEvents = useMemo(() => {
    const events: CalendarEvent[] = [];
    for (const t of tenders) {
      const bidDeadline = tsToDate(t.bidDeadline);
      if (bidDeadline) events.push({ date: bidDeadline, type: "deadline", label: "Bid Deadline", tender: t, color: EVENT_COLORS.deadline });

      const preBid = tsToDate(t.preBidDate);
      if (preBid) events.push({ date: preBid, type: "prebid", label: "Pre-Bid Meeting", tender: t, color: EVENT_COLORS.prebid });

      const emd = tsToDate(t.emdDeadline);
      if (emd) events.push({ date: emd, type: "emd", label: "EMD Deadline", tender: t, color: EVENT_COLORS.emd });

      const tech = tsToDate(t.techBidOpeningDate);
      if (tech) events.push({ date: tech, type: "opening", label: "Tech Bid Opening", tender: t, color: EVENT_COLORS.opening });

      const fin = tsToDate(t.financialBidOpeningDate);
      if (fin) events.push({ date: fin, type: "financial", label: "Financial Opening", tender: t, color: EVENT_COLORS.financial });
    }
    return events;
  }, [tenders]);

  // Get days in current month
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();

  const monthName = currentMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // Events for current month, filtered
  const monthEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (e.date.getMonth() !== month || e.date.getFullYear() !== year) return false;
      if (filter !== "all" && e.type !== filter) return false;
      return true;
    });
  }, [allEvents, month, year, filter]);

  // Group events by day
  const eventsByDay: Record<number, CalendarEvent[]> = {};
  for (const e of monthEvents) {
    const day = e.date.getDate();
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(e);
  }

  const today = new Date();
  const isToday = (day: number) => today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
          <div className="flex items-center gap-3">
            {/* Event type filter */}
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              <option value="all">All Events</option>
              <option value="deadline">Bid Deadlines</option>
              <option value="prebid">Pre-Bid Meetings</option>
              <option value="emd">EMD Deadlines</option>
              <option value="opening">Bid Openings</option>
              <option value="financial">Financial Openings</option>
            </select>
          </div>
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setCurrentMonth(new Date(year, month - 1))}
            className="text-sm text-gray-600 hover:text-[#0D1F3C] px-3 py-1.5 rounded hover:bg-gray-100">&larr; Prev</button>
          <h2 className="text-lg font-semibold text-gray-800">{monthName}</h2>
          <button onClick={() => setCurrentMonth(new Date(year, month + 1))}
            className="text-sm text-gray-600 hover:text-[#0D1F3C] px-3 py-1.5 rounded hover:bg-gray-100">Next &rarr;</button>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-4 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200" /> Bid Deadline</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-200" /> Pre-Bid</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200" /> EMD</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200" /> Tech Opening</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-200" /> Financial</span>
        </div>

        {loading ? (
          <div className="h-96 bg-gray-100 rounded animate-pulse" />
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 bg-gray-50 border-b">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="px-2 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7">
              {/* Padding for first week */}
              {Array.from({ length: startPad }).map((_, i) => (
                <div key={`pad-${i}`} className="border-b border-r min-h-[100px] bg-gray-50/50" />
              ))}

              {/* Days */}
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
                          onClick={() => router.push(`/tender/${encodeURIComponent(e.tender.nitNumber)}`)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] leading-tight border truncate ${e.color} hover:opacity-80 transition-opacity`}
                          title={`${e.label}: ${e.tender.title}`}>
                          {e.label.split(" ")[0]}: {(e.tender.authority || "").slice(0, 8)} {e.tender.powerMW ? `${e.tender.powerMW}MW` : ""}
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

        {/* Upcoming events list below calendar */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Upcoming Events</h3>
          <div className="space-y-2">
            {monthEvents
              .filter((e) => e.date >= new Date(today.getFullYear(), today.getMonth(), today.getDate()))
              .sort((a, b) => a.date.getTime() - b.date.getTime())
              .slice(0, 10)
              .map((e, i) => (
                <div key={i} onClick={() => router.push(`/tender/${encodeURIComponent(e.tender.nitNumber)}`)}
                  className="bg-white rounded-lg border px-4 py-3 flex items-center gap-4 hover:shadow-sm cursor-pointer transition-shadow">
                  <div className={`px-2 py-1 rounded text-xs font-medium border ${e.color}`}>{e.label}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{e.tender.title?.slice(0, 60)}</div>
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

export default function CalendarPage() {
  return <AuthGuard><CalendarContent /></AuthGuard>;
}
