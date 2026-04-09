"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getContacts, type Contact } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Navbar from "@/components/Navbar";

function ContactsContent() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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
      <Navbar />
      <div className="px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Contacts Directory</h1>

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
