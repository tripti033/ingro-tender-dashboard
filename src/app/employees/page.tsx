"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getEmployees, addEmployee, deleteEmployee, getTenders, type Employee, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function EmployeesContent() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "", department: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getEmployees().then(setEmployees),
      getTenders().then(setTenders),
    ]).finally(() => setLoading(false));
  }, []);

  // Get tenders assigned to each employee
  const tendersByEmployee = useMemo(() => {
    const map: Record<string, Tender[]> = {};
    for (const t of tenders) {
      if (t.assignedTo) {
        const key = t.assignedTo.toLowerCase();
        if (!map[key]) map[key] = [];
        map[key].push(t);
      }
    }
    return map;
  }, [tenders]);

  // Get flag stats per employee
  const flagStats = useMemo(() => {
    const stats: Record<string, Record<string, number>> = {};
    for (const t of tenders) {
      if (t.assignedTo) {
        const key = t.assignedTo.toLowerCase();
        if (!stats[key]) stats[key] = {};
        const status = t.tenderStatus || "unknown";
        stats[key][status] = (stats[key][status] || 0) + 1;
      }
    }
    return stats;
  }, [tenders]);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await addEmployee({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        role: form.role.trim() || null,
        department: form.department.trim() || null,
        createdAt: null,
      });
      // Refresh
      const updated = await getEmployees();
      setEmployees(updated);
      setForm({ name: "", email: "", phone: "", role: "", department: "" });
      setShowAdd(false);
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this employee?")) return;
    await deleteEmployee(id);
    setEmployees((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">Employees</h1>
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors">
            {showAdd ? "Cancel" : "+ Add Employee"}
          </button>
        </div>

        {/* Add Employee Form */}
        {showAdd && (
          <div className="bg-white rounded-lg border p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">New Employee</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input type="text" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Role (e.g. BD Manager)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <button onClick={handleAdd} disabled={saving || !form.name.trim()}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 transition-colors">
                {saving ? "Adding..." : "Add Employee"}
              </button>
            </div>
          </div>
        )}

        {/* Employee List */}
        {loading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : employees.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No employees added yet. Click "+ Add Employee" to start.</div>
        ) : (
          <div className="space-y-3">
            {employees.map((emp) => {
              const assignedTenders = tendersByEmployee[emp.name.toLowerCase()] || [];
              const stats = flagStats[emp.name.toLowerCase()] || {};
              const isExpanded = expanded === emp.id;

              return (
                <div key={emp.id} className="bg-white rounded-lg border overflow-hidden">
                  <button
                    onClick={() => setExpanded(isExpanded ? null : emp.id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-[#0D1F3C] text-white flex items-center justify-center text-sm font-bold shrink-0">
                        {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{emp.name}</div>
                        <div className="text-xs text-gray-500">
                          {[emp.role, emp.department].filter(Boolean).join(" | ") || "No role set"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{assignedTenders.length} tenders</span>
                        {stats.active && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{stats.active} active</span>}
                        {stats.closing_soon && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{stats.closing_soon} closing</span>}
                        {stats.awarded && <span className="bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">{stats.awarded} awarded</span>}
                      </div>
                      <span className={`text-xs text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>{"\u25BC"}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t">
                      {/* Employee details */}
                      <div className="px-5 py-3 bg-gray-50 flex items-center gap-6 text-sm">
                        {emp.email && (
                          <a href={`mailto:${emp.email}`} className="text-blue-600 hover:underline">{emp.email}</a>
                        )}
                        {emp.phone && (
                          <a href={`tel:${emp.phone}`} className="text-blue-600 hover:underline">{emp.phone}</a>
                        )}
                        <button onClick={() => handleDelete(emp.id)} className="text-red-500 hover:underline text-xs ml-auto">
                          Remove Employee
                        </button>
                      </div>

                      {/* Assigned tenders */}
                      {assignedTenders.length === 0 ? (
                        <div className="px-5 py-4 text-sm text-gray-400">No tenders assigned</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-left text-gray-500 text-xs uppercase">
                            <tr>
                              <th className="px-4 py-2">NIT</th>
                              <th className="px-4 py-2">Title</th>
                              <th className="px-4 py-2">Authority</th>
                              <th className="px-4 py-2 text-right">MW</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2">Deadline</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {assignedTenders.map((t) => (
                              <tr key={t.nitNumber} onClick={() => router.push(`/tender/${encodeURIComponent(t.nitNumber)}`)}
                                className="hover:bg-gray-50 cursor-pointer">
                                <td className="px-4 py-2 font-mono text-xs">{t.nitNumber.slice(0, 20)}</td>
                                <td className="px-4 py-2 text-xs max-w-[250px] truncate">{t.title}</td>
                                <td className="px-4 py-2 text-xs">{t.authority || "\u2014"}</td>
                                <td className="px-4 py-2 text-right">{t.powerMW?.toLocaleString() || "\u2014"}</td>
                                <td className="px-4 py-2">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                    t.tenderStatus === "active" ? "bg-green-100 text-green-800" :
                                    t.tenderStatus === "closing_soon" ? "bg-amber-100 text-amber-800" :
                                    t.tenderStatus === "awarded" ? "bg-teal-100 text-teal-800" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>{t.tenderStatus}</span>
                                </td>
                                <td className="px-4 py-2 text-xs">{t.bidDeadline ? (typeof t.bidDeadline.toDate === "function" ? t.bidDeadline.toDate().toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "\u2014") : "\u2014"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmployeesPage() {
  return <AuthGuard><Sidebar /><EmployeesContent /></AuthGuard>;
}
