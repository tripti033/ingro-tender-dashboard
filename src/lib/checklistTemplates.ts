import type { ChecklistBucket, ChecklistStatus } from "./firestore";

export interface ChecklistTemplateItem {
  bucket: ChecklistBucket;
  order: number;
  document: string;
  reference: string | null;
  status: ChecklistStatus;
  remarks: string | null;
  documentLink: string | null;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string;
  items: ChecklistTemplateItem[];
}

// UJVNL Dhakrani 30 MW / 75 MWh template — lifted verbatim from the
// "Submission Checklist" sheet of the user's RfP workbook. Matches the
// standard 3-envelope structure most state-utility BESS tenders use.
const UJVNL_DHAKRANI: ChecklistTemplate = {
  id: "ujvnl-dhakrani",
  name: "UJVNL 30/75 MWh (Dhakrani RfP)",
  description: "Standard 3-envelope UJVNL BESS submission — 25 documents across physical + electronic covers.",
  items: [
    // ENVELOPE-1 (Physical): Costs & EMD
    { bucket: "Envelope-1", order: 10, document: "RfP cost DD/Banker's Cheque: ₹5,000 + 18% GST = ₹5,900", reference: "DD in favour of UJVN Limited, payable at Dehradun", status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 20, document: "Processing Fee DD: ₹7,50,000 + 18% GST = ₹8,85,000", reference: "DD @ ₹25,000/MW in favour of UJVN Limited", status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 30, document: "EMD: ₹1.50 Crore BG/FDR/CDR", reference: "Format 6.3A, valid 9 months", status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 40, document: "Declaration on ₹100 stamp paper", reference: "Annexure-E", status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 50, document: "Non-blacklisting affidavit on ₹100 stamp paper", reference: "Annexure-C", status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 60, document: "MSE certificate + Bid Security Declaration (if applicable)", reference: "Annexure-D", status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 70, document: "Power of Attorney (if applicable) on stamp paper", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 80, document: "Consortium Agreement (if applicable) on stamp paper", reference: null, status: "pending", remarks: null, documentLink: null },

    // COVER-2 (Electronic): Technical Bid Documents
    { bucket: "Cover-2", order: 10, document: "Covering Letter", reference: "Format 6.1", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 20, document: "Power of Attorney for Consortium (if applicable)", reference: "Format 6.2", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 30, document: "Board Resolutions (signing authority + equity commitment)", reference: "Format 6.4", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 40, document: "Consortium Agreement (if applicable)", reference: "Format 6.5", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 50, document: "Financial Requirements / Net Worth Certificate", reference: "Format 6.6 + CA Certificate", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 60, document: "Technical Criteria — Technology declaration", reference: "Format 6.7", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 70, document: "Connectivity of Project with UPCL/UJVNL S/s", reference: "Format 6.8", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 80, document: "Disclosure Statement", reference: "Format 6.9", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 90, document: "Declaration regarding Qualification", reference: "Format 6.10", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 100, document: "Declaration for Proposed Technology", reference: "Format 6.11", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 110, document: "MoA, AoA, Certificate of Incorporation", reference: "Certified copies", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 120, document: "IT Returns (last 3 FY)", reference: "CA certified copies", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 130, document: "Audited Balance Sheet & P/L (3 years)", reference: "Certified copies", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 140, document: "Partnership Deed (if applicable)", reference: "Notarized copy", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 150, document: "Checklist Annexure-3 & Annexure-4", reference: "Filled & signed", status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 160, document: "Shareholding certificate (within 30 days of bid)", reference: "CA/CS certified", status: "pending", remarks: null, documentLink: null },

    // COVER-3 (Electronic): Financial Bid
    { bucket: "Cover-3", order: 10, document: "Financial Bid — Single Tariff (₹/MW/Month) for 12 years. Must be ≤ ceiling. Download BoQ .xls from portal; do NOT create a look-alike.", reference: "Format 6.13 (BoQ from portal)", status: "pending", remarks: "No decimals in tariff. Re-upload exact BoQ .xls.", documentLink: null },
  ],
};

// Minimal generic fallback — use when no authority-specific template exists.
const GENERIC_BESS: ChecklistTemplate = {
  id: "generic-bess",
  name: "Generic BESS Tender",
  description: "Common documents required across most Indian BESS tenders.",
  items: [
    { bucket: "Envelope-1", order: 10, document: "Tender / RfP Cost DD", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 20, document: "Processing Fee DD", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Envelope-1", order: 30, document: "EMD (BG / FDR / CDR)", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 10, document: "Covering Letter", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 20, document: "Power of Attorney", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 30, document: "Board Resolution", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 40, document: "Net Worth Certificate (CA)", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 50, document: "Audited Financials (3 years)", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 60, document: "IT Returns (3 years)", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 70, document: "Technical Proposal / Technology Declaration", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 80, document: "MoA / AoA / Certificate of Incorporation", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-2", order: 90, document: "Non-blacklisting affidavit", reference: null, status: "pending", remarks: null, documentLink: null },
    { bucket: "Cover-3", order: 10, document: "Financial Bid / BoQ", reference: null, status: "pending", remarks: null, documentLink: null },
  ],
};

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [UJVNL_DHAKRANI, GENERIC_BESS];

export function getTemplate(id: string): ChecklistTemplate | null {
  return CHECKLIST_TEMPLATES.find((t) => t.id === id) || null;
}
