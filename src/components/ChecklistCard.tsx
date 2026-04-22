"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getChecklist,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  applyChecklistTemplate,
  type ChecklistItem,
  type ChecklistBucket,
  type ChecklistStatus,
} from "@/lib/firestore";
import { CHECKLIST_TEMPLATES, getTemplate } from "@/lib/checklistTemplates";

const BUCKETS: ChecklistBucket[] = ["Envelope-1", "Cover-2", "Cover-3", "Custom"];

const BUCKET_LABEL: Record<ChecklistBucket, string> = {
  "Envelope-1": "Envelope-1 · Physical (Costs & EMD)",
  "Cover-2": "Cover-2 · Electronic (Technical Bid)",
  "Cover-3": "Cover-3 · Electronic (Financial Bid)",
  "Custom": "Custom",
};

const STATUS_STYLE: Record<ChecklistStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  done: "bg-green-100 text-green-700",
  na: "bg-gray-100 text-gray-400",
  blocked: "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  pending: "Pending",
  done: "Done",
  na: "N/A",
  blocked: "Blocked",
};

export default function ChecklistCard({
  tenderNit,
  userEmail,
}: {
  tenderNit: string;
  userEmail: string;
}) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ bucket: "Custom" as ChecklistBucket, document: "", reference: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getChecklist(tenderNit)
      .then((list) => { setItems(list); setError(null); })
      .catch((err) => {
        console.error("[Checklist] load failed:", err);
        const msg = String(err?.code || err?.message || "");
        if (msg.includes("permission-denied")) {
          setError("Firestore rules don't allow this yet — add a rule for tenders/{nit}/checklist/{id}.");
        } else {
          setError("Couldn't load checklist. Try refresh.");
        }
      })
      .finally(() => setLoading(false));
  }, [tenderNit]);

  const counts = useMemo(() => {
    const total = items.filter((i) => i.status !== "na").length;
    const done = items.filter((i) => i.status === "done").length;
    const blocked = items.filter((i) => i.status === "blocked").length;
    return { total, done, blocked };
  }, [items]);

  const progress = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);

  const grouped = useMemo(() => {
    const out: Record<ChecklistBucket, ChecklistItem[]> = {
      "Envelope-1": [], "Cover-2": [], "Cover-3": [], "Custom": [],
    };
    for (const i of items) out[i.bucket]?.push(i);
    return out;
  }, [items]);

  const handleApplyTemplate = async (templateId: string) => {
    const tpl = getTemplate(templateId);
    if (!tpl) return;
    setSaving(true);
    try {
      await applyChecklistTemplate(tenderNit, tpl.items, userEmail);
      const fresh = await getChecklist(tenderNit);
      setItems(fresh);
      setShowTemplatePicker(false);
    } finally { setSaving(false); }
  };

  const handleStatusChange = async (item: ChecklistItem, status: ChecklistStatus) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    try {
      await updateChecklistItem(tenderNit, item.id, { status }, userEmail);
    } catch {
      // revert on error
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
    }
  };

  const handleRemarksBlur = async (item: ChecklistItem, remarks: string) => {
    if (remarks === (item.remarks || "")) return;
    try {
      await updateChecklistItem(tenderNit, item.id, { remarks: remarks || null }, userEmail);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, remarks: remarks || null } : i)));
    } catch { /* ignore */ }
  };

  const handleDocLinkBlur = async (item: ChecklistItem, link: string) => {
    if (link === (item.documentLink || "")) return;
    try {
      await updateChecklistItem(tenderNit, item.id, { documentLink: link || null }, userEmail);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, documentLink: link || null } : i)));
    } catch { /* ignore */ }
  };

  const handleDelete = async (item: ChecklistItem) => {
    if (!confirm(`Remove "${item.document.slice(0, 60)}"?`)) return;
    await deleteChecklistItem(tenderNit, item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  };

  const handleAdd = async () => {
    if (!newItem.document.trim()) return;
    setSaving(true);
    try {
      const maxOrder = items.filter((i) => i.bucket === newItem.bucket).reduce((m, i) => Math.max(m, i.order), 0);
      const id = await addChecklistItem(tenderNit, {
        bucket: newItem.bucket,
        order: maxOrder + 10,
        document: newItem.document.trim(),
        reference: newItem.reference.trim() || null,
        status: "pending",
        remarks: null,
        documentLink: null,
      }, userEmail);
      const fresh = await getChecklist(tenderNit);
      setItems(fresh);
      setNewItem({ bucket: "Custom", document: "", reference: "" });
      setShowAdd(false);
      void id;
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white rounded-lg border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Submission Checklist</h2>
        {items.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-500">
              <span className="font-semibold text-gray-900">{counts.done}</span>/{counts.total} done
              {counts.blocked > 0 && <span className="ml-2 text-red-600">· {counts.blocked} blocked</span>}
            </div>
            <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full transition-all ${progress === 100 ? "bg-green-500" : "bg-[#0D1F3C]"}`} style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-10 text-right">{progress}%</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500 mb-4">No checklist yet. Apply a template to get started.</p>
          {showTemplatePicker ? (
            <div className="space-y-2 max-w-md mx-auto text-left">
              {CHECKLIST_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleApplyTemplate(t.id)}
                  disabled={saving}
                  className="w-full text-left border rounded-lg p-3 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <div className="text-sm font-medium text-gray-900">{t.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>
                  <div className="text-xs text-gray-400 mt-1">{t.items.length} items</div>
                </button>
              ))}
              <button onClick={() => setShowTemplatePicker(false)} className="text-xs text-gray-400 hover:text-gray-600 mt-2">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setShowTemplatePicker(true)}
              className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors"
            >
              Apply template
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-5">
            {BUCKETS.map((bucket) => {
              const bItems = grouped[bucket];
              if (bItems.length === 0) return null;
              const bDone = bItems.filter((i) => i.status === "done").length;
              return (
                <div key={bucket}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{BUCKET_LABEL[bucket]}</h3>
                    <span className="text-[11px] text-gray-400">{bDone}/{bItems.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {bItems.map((item) => (
                      <ChecklistRow
                        key={item.id}
                        item={item}
                        onStatus={(s) => handleStatusChange(item, s)}
                        onRemarksBlur={(r) => handleRemarksBlur(item, r)}
                        onDocLinkBlur={(l) => handleDocLinkBlur(item, l)}
                        onDelete={() => handleDelete(item)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t flex items-center gap-3">
            {showAdd ? (
              <div className="flex-1 flex items-center gap-2">
                <select
                  value={newItem.bucket}
                  onChange={(e) => setNewItem({ ...newItem, bucket: e.target.value as ChecklistBucket })}
                  className="border rounded-lg px-2 py-1.5 text-xs"
                >
                  {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="Document / item *"
                  value={newItem.document}
                  onChange={(e) => setNewItem({ ...newItem, document: e.target.value })}
                  className="border rounded-lg px-2 py-1.5 text-xs flex-1 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
                />
                <input
                  type="text"
                  placeholder="Reference (Format/Annexure)"
                  value={newItem.reference}
                  onChange={(e) => setNewItem({ ...newItem, reference: e.target.value })}
                  className="border rounded-lg px-2 py-1.5 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
                />
                <button onClick={handleAdd} disabled={saving || !newItem.document.trim()}
                  className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-green-700 disabled:opacity-50">
                  Add
                </button>
                <button onClick={() => { setShowAdd(false); setNewItem({ bucket: "Custom", document: "", reference: "" }); }}
                  className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowAdd(true)} className="text-xs text-[#0D1F3C] hover:underline font-medium">
                + Add item
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ChecklistRow({
  item, onStatus, onRemarksBlur, onDocLinkBlur, onDelete,
}: {
  item: ChecklistItem;
  onStatus: (s: ChecklistStatus) => void;
  onRemarksBlur: (r: string) => void;
  onDocLinkBlur: (l: string) => void;
  onDelete: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [remarks, setRemarks] = useState(item.remarks || "");
  const [link, setLink] = useState(item.documentLink || "");

  const nextStatus: Record<ChecklistStatus, ChecklistStatus> = {
    pending: "done", done: "na", na: "blocked", blocked: "pending",
  };

  return (
    <div className={`border rounded-lg ${item.status === "done" ? "bg-green-50/40" : "bg-white"} transition-colors`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          onClick={() => onStatus(nextStatus[item.status])}
          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[item.status]}`}
          title="Click to cycle: Pending → Done → N/A → Blocked"
        >
          {STATUS_LABEL[item.status]}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-sm ${item.status === "done" ? "text-gray-500 line-through" : "text-gray-900"}`}>
            {item.document}
          </div>
          {item.reference && (
            <div className="text-[11px] text-gray-500 mt-0.5">{item.reference}</div>
          )}
        </div>

        {item.documentLink && (
          <a href={item.documentLink} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0D1F3C] hover:underline shrink-0">
            File &rarr;
          </a>
        )}
        <button onClick={() => setShowDetails(!showDetails)} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
          {showDetails ? "Hide" : "Edit"}
        </button>
      </div>

      {showDetails && (
        <div className="border-t px-3 py-2 bg-gray-50 space-y-2">
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              onBlur={() => onRemarksBlur(remarks)}
              rows={2}
              placeholder="Notes, owner, deadline, etc."
              className="w-full border rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 uppercase tracking-wider mb-1">Document link (Drive/URL)</label>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onBlur={() => onDocLinkBlur(link)}
              placeholder="https://drive.google.com/..."
              className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="text-[10px] text-gray-400">
              {item.updatedBy && <>Last edit by {item.updatedBy.split("@")[0]}</>}
            </div>
            <button onClick={onDelete} className="text-[11px] text-red-500 hover:underline">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
