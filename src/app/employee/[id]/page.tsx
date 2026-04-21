"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { getEmployees, deleteEmployee, getTenders, type Employee, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function formatDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "\u2014"; }
}

function truncate(str: string | null, max: number): string {
  if (!str) return "\u2014";
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

function liveDaysLeft(t: Tender): number | null {
  if (!t.bidDeadline) return t.daysLeft ?? null;
  try {
    const d = typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate() : new Date(t.bidDeadline as unknown as string);
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
  } catch { return t.daysLeft ?? null; }
}

function statusLabel(t: Tender): { label: string; color: string } {
  const days = liveDaysLeft(t);
  if (t.tenderStatus === "awarded") return { label: "awarded", color: "bg-teal-100 text-teal-800" };
  if (t.tenderStatus === "cancelled") return { label: "cancelled", color: "bg-gray-100 text-gray-600" };
  if (days != null && days < 0) return { label: "closed", color: "bg-red-100 text-red-700" };
  if (days != null && days <= 7) return { label: "closing_soon", color: "bg-amber-100 text-amber-800" };
  return { label: "active", color: "bg-green-100 text-green-800" };
}

function EmployeeDetailContent() {
  const router = useRouter();
  const params = useParams();
  const empId = decodeURIComponent((params.id as string) || "");

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    Promise.all([getEmployees(), getTenders()])
      .then(([emps, tens]) => {
        const found = emps.find((e) => e.id === empId);
        if (!found) { setNotFound(true); return; }
        setEmployee(found);
        setTenders(tens);
      })
      .finally(() => setLoading(false));
  }, [empId]);

  const assigned = useMemo(() => {
    if (!employee) return [];
    const key = employee.name.toLowerCase();
    return tenders.filter((t) => (t.assignedTo || "").toLowerCase() === key);
  }, [tenders, employee]);

  const visible = useMemo(() => {
    let result = [...assigned];
    if (statusFilter !== "All") {
      result = result.filter((t) => statusLabel(t).label === statusFilter);
    }
    result.sort((a, b) => (liveDaysLeft(a) ?? 9999) - (liveDaysLeft(b) ?? 9999));
    return result;
  }, [assigned, statusFilter]);

  const stats = useMemo(() => {
    const s = { active: 0, closing_soon: 0, closed: 0, awarded: 0 };
    for (const t of assigned) {
      const label = statusLabel(t).label;
      if (label in s) (s as Record<string, number>)[label]++;
    }
    return s;
  }, [assigned]);

  const handleDelete = async () => {
    if (!employee) return;
    if (!confirm(`Remove ${employee.name}?`)) return;
    await deleteEmployee(employee.id);
    router.push("/employees");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <div className="sidebar-content px-6 py-6">
          <div className="h-64 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFound || !employee) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <div className="sidebar-content px-6 py-6">
          <button onClick={() => router.push("/employees")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">
            &larr; All Employees
          </button>
          <div className="text-center py-16 text-gray-400">Employee not found</div>
        </div>
      </div>
    );
  }

  const initials = employee.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <button onClick={() => router.push("/employees")} className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block">
          &larr; All Employees
        </button>

        {/* Header */}
        <div className="bg-white rounded-lg border p-5 mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#0D1F3C] text-white flex items-center justify-center text-lg font-bold shrink-0">
              {initials}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{employee.name}</h1>
              <div className="text-sm text-gray-500 mt-0.5">
                {[employee.role, employee.department].filter(Boolean).join(" \u00B7 ") || "No role set"}
              </div>
              <div className="flex items-center gap-4 text-sm text-blue-600 mt-2">
                {employee.email && <a href={`mailto:${employee.email}`} className="hover:underline">{employee.email}</a>}
                {employee.phone && <a href={`tel:${employee.phone}`} className="hover:underline">{employee.phone}</a>}
              </div>
            </div>
          </div>
          <button onClick={handleDelete} className="text-red-500 hover:underline text-xs">
            Remove Employee
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Assigned</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{assigned.length}</div>
          </div>
          <div className="bg-green-50 rounded-lg border border-green-100 p-4">
            <div className="text-xs text-green-700 uppercase tracking-wider">Active</div>
            <div className="text-xl font-bold text-green-900 mt-1">{stats.active}</div>
          </div>
          <div className="bg-amber-50 rounded-lg border border-amber-100 p-4">
            <div className="text-xs text-amber-700 uppercase tracking-wider">Closing Soon</div>
            <div className="text-xl font-bold text-amber-900 mt-1">{stats.closing_soon}</div>
          </div>
          <div className="bg-red-50 rounded-lg border border-red-100 p-4">
            <div className="text-xs text-red-700 uppercase tracking-wider">Closed</div>
            <div className="text-xl font-bold text-red-900 mt-1">{stats.closed}</div>
          </div>
          <div className="bg-teal-50 rounded-lg border border-teal-100 p-4">
            <div className="text-xs text-teal-700 uppercase tracking-wider">Awarded</div>
            <div className="text-xl font-bold text-teal-900 mt-1">{stats.awarded}</div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs text-gray-500 uppercase tracking-wider">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="All">All</option>
            <option value="active">Active</option>
            <option value="closing_soon">Closing Soon</option>
            <option value="closed">Closed</option>
            <option value="awarded">Awarded</option>
          </select>
          <span className="text-sm text-gray-400 ml-auto">{visible.length} of {assigned.length}</span>
        </div>

        {/* Assigned tenders */}
        {assigned.length === 0 ? (
          <div className="bg-white rounded-lg border p-8 text-center text-gray-400">No tenders assigned to this employee</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">NIT</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Authority</th>
                  <th className="px-4 py-3 text-right">MW</th>
                  <th className="px-4 py-3">Deadline</th>
                  <th className="px-4 py-3">Days Left</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((t) => {
                  const status = statusLabel(t);
                  const days = liveDaysLeft(t);
                  const href = `/tender/${encodeURIComponent(t.nitNumber)}?from=${encodeURIComponent(`/employee/${encodeURIComponent(empId)}`)}`;
                  return (
                    <tr
                      key={t.nitNumber}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) return;
                        window.open(href, "_blank", "noopener,noreferrer");
                      }}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap" title={t.nitNumber}>
                        {truncate(t.nitNumber, 25)}
                      </td>
                      <td className="px-4 py-2.5 text-xs max-w-[320px] truncate" title={t.title || ""}>
                        {t.title || "\u2014"}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{t.authority || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-right">{t.powerMW?.toLocaleString() || "\u2014"}</td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatDate(t.bidDeadline)}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {days == null ? "\u2014" : days < 0 ? <span className="text-gray-400 line-through">closed</span> : <span className={days <= 7 ? "text-red-600 font-semibold" : ""}>{days}d</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmployeeDetailPage() {
  return <AuthGuard><EmployeeDetailContent /></AuthGuard>;
}
