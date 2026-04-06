"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { type User } from "firebase/auth";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onAuthChange } from "@/lib/auth";
import { updateFlag, updateNote, type Tender } from "@/lib/firestore";
import AuthGuard from "@/components/AuthGuard";
import Navbar from "@/components/Navbar";

const FLAG_OPTIONS = [
  { label: "Watching", color: "border-blue-500 bg-blue-50 text-blue-700" },
  { label: "Applying", color: "border-green-500 bg-green-50 text-green-700" },
  {
    label: "Not Interested",
    color: "border-gray-400 bg-gray-50 text-gray-600",
  },
  {
    label: "Don\u2019t Qualify",
    color: "border-red-400 bg-red-50 text-red-700",
  },
  { label: "Expired", color: "border-gray-400 bg-gray-50 text-gray-500" },
];

function formatFullDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d =
      typeof ts.toDate === "function"
        ? ts.toDate()
        : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
      timeZoneName: "short",
    });
  } catch {
    return "\u2014";
  }
}

function formatShortDate(ts: { toDate?: () => Date } | null): string {
  if (!ts) return "\u2014";
  try {
    const d =
      typeof ts.toDate === "function"
        ? ts.toDate()
        : new Date(ts as unknown as string);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "\u2014";
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    closing_soon: "bg-amber-100 text-amber-800",
    closed: "bg-red-100 text-red-800",
    awarded: "bg-blue-100 text-blue-800",
  };
  const labels: Record<string, string> = {
    active: "Active",
    closing_soon: "Closing Soon",
    closed: "Closed",
    awarded: "Awarded",
  };
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${styles[status] || "bg-gray-100 text-gray-700"}`}
    >
      {labels[status] || status}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-sm font-medium text-right">{value || "\u2014"}</span>
    </div>
  );
}

function TenderDetailContent() {
  const router = useRouter();
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const [user, setUser] = useState<User | null>(null);
  const [tender, setTender] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Flag & note state
  const [selectedFlag, setSelectedFlag] = useState<string>("");
  const [flagSaved, setFlagSaved] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return onAuthChange(setUser);
  }, []);

  useEffect(() => {
    async function fetchTender() {
      try {
        const snap = await getDoc(doc(db, "tenders", id));
        if (snap.exists()) {
          const data = { nitNumber: snap.id, ...snap.data() } as Tender;
          setTender(data);
        } else {
          setError("Tender not found.");
        }
      } catch {
        setError("Failed to load tender.");
      } finally {
        setLoading(false);
      }
    }
    fetchTender();
  }, [id]);

  // Set initial flag and note from tender data once loaded
  useEffect(() => {
    if (tender && user) {
      setSelectedFlag(tender.flags?.[user.uid] || "");
      setNoteText(tender.notes?.[user.uid] || "");
    }
  }, [tender, user]);

  const handleFlagSelect = async (flag: string) => {
    if (!user || !tender) return;
    const newFlag = flag === selectedFlag ? "" : flag;
    setSelectedFlag(newFlag);
    setFlagSaved(false);
    try {
      await updateFlag(tender.nitNumber, user.uid, newFlag);
      setFlagSaved(true);
      setTimeout(() => setFlagSaved(false), 2000);
    } catch {
      // Revert
    }
  };

  const handleSaveNote = async () => {
    if (!user || !tender) return;
    setNoteSaved(false);
    try {
      await updateNote(tender.nitNumber, user.uid, noteText);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const handleCopyNit = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center py-32">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-t-[#0D1F3C]" />
        </div>
      </div>
    );
  }

  if (error || !tender) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-4xl mx-auto px-6 py-12">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[#0D1F3C] hover:underline text-sm mb-6 inline-block"
          >
            &larr; All Tenders
          </button>
          <p className="text-red-600">{error || "Tender not found."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-6xl mx-auto px-6 py-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-[#0D1F3C] hover:underline text-sm mb-6 inline-block"
        >
          &larr; All Tenders
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* LEFT COLUMN — tender details (60%) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {tender.title || "\u2014"}
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                <code
                  onClick={handleCopyNit}
                  className="text-sm bg-gray-100 px-3 py-1 rounded font-mono cursor-pointer hover:bg-gray-200 transition-colors"
                  title="Click to copy"
                >
                  {tender.nitNumber}
                </code>
                {copied && (
                  <span className="text-xs text-green-600">Copied!</span>
                )}
                <StatusBadge status={tender.tenderStatus} />
              </div>
            </div>

            {/* Basic Info */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Basic Info
              </h2>
              <InfoRow label="Authority" value={tender.authority} />
              <InfoRow label="Authority Type" value={tender.authorityType} />
              <InfoRow label="Category" value={tender.category} />
              <InfoRow label="Tender Mode" value={tender.tenderMode} />
              <InfoRow label="Connectivity Type" value={tender.connectivityType} />
              <InfoRow label="State" value={tender.state} />
              <InfoRow label="Location" value={tender.location} />
            </div>

            {/* Project Size */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Project Size
              </h2>
              <InfoRow
                label="Power"
                value={
                  tender.powerMW != null ? `${tender.powerMW} MW` : null
                }
              />
              <InfoRow
                label="Energy"
                value={
                  tender.energyMWh != null ? `${tender.energyMWh} MWh` : null
                }
              />
              <InfoRow
                label="Duration"
                value={
                  tender.durationHours != null
                    ? `${tender.durationHours} hours`
                    : null
                }
              />
              <InfoRow
                label="VGF Eligible"
                value={tender.vgfEligible ? "Yes" : "No"}
              />
            </div>

            {/* Key Dates */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Key Dates
              </h2>
              <InfoRow
                label="Pre-bid Meeting"
                value={formatFullDate(tender.preBidDate)}
              />
              <InfoRow
                label="Bid Deadline"
                value={formatFullDate(tender.bidDeadline)}
              />
              <InfoRow
                label="EMD Deadline"
                value={formatFullDate(tender.emdDeadline)}
              />
              <InfoRow
                label="Tech Bid Opening"
                value={formatFullDate(tender.techBidOpeningDate)}
              />
              <InfoRow
                label="Financial Bid Opening"
                value={formatFullDate(tender.financialBidOpeningDate)}
              />
              <InfoRow
                label="BESPA Signing"
                value={formatFullDate(tender.bespaSigning)}
              />
            </div>

            {/* Financial */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Financial
              </h2>
              <InfoRow
                label="EMD Amount"
                value={
                  tender.emdAmount != null
                    ? `${tender.emdAmount.toLocaleString("en-IN")} ${tender.emdUnit || "INR"}`
                    : null
                }
              />
              <InfoRow
                label="Bidding Structure"
                value={tender.biddingStructure}
              />
            </div>

            {/* Links */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Links
              </h2>
              <div className="flex flex-wrap gap-3">
                {tender.documentLink && (
                  <a
                    href={tender.documentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors"
                  >
                    Download Bid Documents &rarr;
                  </a>
                )}
                {tender.preBidLink && (
                  <a
                    href={tender.preBidLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 border border-[#0D1F3C] text-[#0D1F3C] px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    Join Pre-bid Meeting &rarr;
                  </a>
                )}
                {tender.sourceUrl && (
                  <a
                    href={tender.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#0D1F3C] hover:underline py-2"
                  >
                    View Source &rarr;
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN — team actions (40%) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Your Flag */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Your Flag
              </h2>
              <div className="space-y-2">
                {FLAG_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => handleFlagSelect(opt.label)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                      selectedFlag === opt.label
                        ? opt.color
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {flagSaved && (
                <p className="text-xs text-green-600 mt-2">Saved</p>
              )}
            </div>

            {/* Your Notes */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Your Notes
              </h2>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={4}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D1F3C]/20 resize-none"
                placeholder="Add private notes about this tender..."
              />
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleSaveNote}
                  className="bg-[#0D1F3C] text-white px-4 py-2 rounded-lg text-sm hover:bg-[#162d52] transition-colors"
                >
                  Save Note
                </button>
                {noteSaved && (
                  <span className="text-xs text-green-600">Saved</span>
                )}
              </div>
            </div>

            {/* Sources */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Sources
              </h2>
              <div className="flex flex-wrap gap-2">
                {(tender.sources || []).map((src) => (
                  <span
                    key={src}
                    className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                  >
                    {src}
                  </span>
                ))}
                {(!tender.sources || tender.sources.length === 0) && (
                  <span className="text-sm text-gray-400">&mdash;</span>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-white rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Metadata
              </h2>
              <InfoRow
                label="First seen"
                value={formatShortDate(tender.firstSeenAt)}
              />
              <InfoRow
                label="Last updated"
                value={formatShortDate(tender.lastUpdatedAt)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TenderDetailPage() {
  return (
    <AuthGuard>
      <TenderDetailContent />
    </AuthGuard>
  );
}
