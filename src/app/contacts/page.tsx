"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getContacts, addContact, type Contact } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";

function ContactsContent() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", companyName: "", companyId: "", designation: "", email: "", phone: "", location: "" });
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.companyName.trim()) return;
    setSaving(true);
    try {
      const companyId = form.companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
      await addContact({
        name: form.name.trim(),
        companyId,
        companyName: form.companyName.trim(),
        designation: form.designation.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        location: form.location.trim() || null,
      });
      const updated = await getContacts();
      setContacts(updated);
      setForm({ name: "", companyName: "", companyId: "", designation: "", email: "", phone: "", location: "" });
      setShowAdd(false);
    } catch { /* */ }
    finally { setSaving(false); }
  };

  useEffect(() => {
    getContacts().then(setContacts).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return contacts.sort((a, b) => a.companyName.localeCompare(b.companyName));
    const q = search.toLowerCase();
    return contacts.filter((c) =>
      [c.name, c.companyName, c.designation, c.email, c.location]
        .some((f) => (f || "").toLowerCase().includes(q))
    );
  }, [contacts, search]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <div className="sidebar-content px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Contacts Directory</h1>
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors">
            {showAdd ? "Cancel" : "+ Add Contact"}
          </button>
        </div>

        {showAdd && (
          <div className="bg-white rounded-lg border p-5 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Company *" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
              <input type="text" placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
            </div>
            <button onClick={handleAdd} disabled={saving || !form.name.trim() || !form.companyName.trim()}
              className="mt-3 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
              {saving ? "Adding..." : "Add Contact"}
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <input type="text" placeholder="Search name, company, role, email..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20" />
          <span className="text-sm text-gray-400 ml-auto">{filtered.length} contacts</span>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No contacts match your search</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => router.push(`/company/${encodeURIComponent(c.companyId)}`)}
                        className="text-[#0D1F3C] hover:underline">
                        {c.companyName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.designation || "\u2014"}</td>
                    <td className="px-4 py-3">
                      {c.email ? <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline">{c.email}</a> : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.phone || "\u2014"}</td>
                    <td className="px-4 py-3 text-gray-500">{c.location || "\u2014"}</td>
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

export default function ContactsPage() {
  return <AuthGuard><ContactsContent /></AuthGuard>;
}
