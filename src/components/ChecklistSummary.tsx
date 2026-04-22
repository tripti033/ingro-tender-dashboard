"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getChecklist, type ChecklistItem } from "@/lib/firestore";

export default function ChecklistSummary({ tenderNit }: { tenderNit: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  useEffect(() => {
    getChecklist(tenderNit)
      .then(setItems)
      .catch(() => setItems([]));
  }, [tenderNit]);

  const total = items?.filter((i) => i.status !== "na").length || 0;
  const done = items?.filter((i) => i.status === "done").length || 0;
  const blocked = items?.filter((i) => i.status === "blocked").length || 0;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  const goToChecklist = () => router.push(`/tender/${encodeURIComponent(tenderNit)}/checklist`);

  return (
    <button
      onClick={goToChecklist}
      className="w-full bg-white rounded-lg border hover:border-[#0D1F3C] hover:shadow-sm transition-all p-5 mb-6 text-left"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Submission Checklist</div>
          {items === null ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : items.length === 0 ? (
            <div>
              <div className="text-sm text-gray-900 font-medium">Not started</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Open to extract from the document, copy from another tender, or apply a template.
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm text-gray-900">
                <span className="font-semibold">{done}</span>
                <span className="text-gray-500">/{total} done</span>
                {blocked > 0 && <span className="ml-2 text-red-600 text-xs">· {blocked} blocked</span>}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full ${progress === 100 ? "bg-green-500" : "bg-[#0D1F3C]"}`} style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs text-gray-500">{progress}%</span>
              </div>
            </div>
          )}
        </div>
        <div className="text-sm text-[#0D1F3C] font-medium whitespace-nowrap shrink-0">
          Open &rarr;
        </div>
      </div>
    </button>
  );
}
