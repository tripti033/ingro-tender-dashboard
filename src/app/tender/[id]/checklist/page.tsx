"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onAuthChange } from "@/lib/auth";
import type { Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/Sidebar";
import ChecklistCard from "@/components/ChecklistCard";

function ChecklistPageContent() {
  const router = useRouter();
  const params = useParams();
  const id = decodeURIComponent((params.id as string) || "");

  const [user, setUser] = useState<User | null>(null);
  const [tender, setTender] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { return onAuthChange(setUser); }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "tenders", id));
        if (snap.exists()) setTender({ nitNumber: snap.id, ...snap.data() } as Tender);
      } finally { setLoading(false); }
    })();
  }, [id]);

  return (
    <div className="min-h-screen bg-[#0d1015] text-gray-100">
      <Sidebar />
      <div className="sidebar-content max-w-4xl mx-auto px-6 py-6">
        <button
          onClick={() => router.push(`/tender/${encodeURIComponent(id)}`)}
          className="text-[#0D1F3C] hover:underline text-sm mb-4 inline-block"
        >
          &larr; Back to tender
        </button>

        {loading ? (
          <div className="h-64 bg-gray-800 rounded animate-pulse" />
        ) : !tender ? (
          <div className="text-center py-16 text-gray-400">Tender not found</div>
        ) : (
          <>
            <div className="mb-6">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Submission checklist</div>
              <h1 className="text-xl font-bold text-gray-100 leading-snug">{tender.title || tender.nitNumber}</h1>
              <div className="text-sm text-gray-500 mt-1">
                <span className="font-mono">{tender.nitNumber}</span>
                {tender.authority && <span> &middot; {tender.authority}</span>}
              </div>
            </div>

            {user && user.email && (
              <ChecklistCard tenderNit={id} userEmail={user.email} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ChecklistPage() {
  return <AuthGuard><ChecklistPageContent /></AuthGuard>;
}
