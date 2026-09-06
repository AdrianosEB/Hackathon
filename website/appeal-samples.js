// =============================================
// Paired fixtures: a claim record and the appeal
// written about it. (Synthetic.)
// =============================================

const CLAIM_A = {
  claimNumber: "A-99231",
  providerName: "Mercy Clinic",
  patientLabel: "J. Doe (member 55512-01)",
  diagnosisCodes: ["J18.9"],
  clinicalNote:
    "Patient presented with persistent productive cough and fever unresolved after two courses of outpatient antibiotics. Chest imaging ordered to exclude pneumonia; extended evaluation and management performed.",
  lineItems: [
    { code: "99215", description: "Office visit, high complexity", serviceDate: "2025-01-03", units: 1, amount: 230 },
    { code: "71046", description: "Chest X-ray, 2 views", serviceDate: "2025-01-03", units: 1, amount: 80 }
  ]
};

const CLAIM_B = {
  claimNumber: "B-40877",
  providerName: "Northside Infusion Center",
  patientLabel: "R. Alvarez (member 88190-02)",
  diagnosisCodes: [],
  clinicalNote: "Infusion given.",
  lineItems: [
    { code: "99215", description: "Office visit, high complexity", serviceDate: "2025-02-11", units: 1, amount: 690 },
    { code: "99215", description: "Office visit, high complexity", serviceDate: "2025-02-11", units: 1, amount: 690 },
    { code: "74177", description: "CT abdomen/pelvis with contrast", serviceDate: "2025-02-11", units: 6, amount: 1200 }
  ]
};

window.APPEAL_SAMPLES = {

  matched: {
    label: "Well documented, matches the claim",
    claim: CLAIM_A,
    text: `Appeal of claim #A-99231, member 55512-01, patient DOB 1974-03-02.

Denial reason: CARC 50 (not medically necessary), per the EOB dated 2025-02-10. We appeal that determination.

Date of service: 2025-01-03. Rendering provider: Mercy Clinic, NPI 1234567890. Codes billed: CPT 99215 and CPT 71046, diagnosis J18.9.

Clinical rationale: the attending physician's letter of medical necessity dated 2025-01-04 documents two prior failed courses of first-line antibiotic therapy. The progress notes for 2025-01-03 and the radiology report of the same date are enclosed.

Plan provision: Section 4.2 of the Certificate of Coverage covers diagnostic imaging when ordered by the attending physician.

Itemised charges: CPT 99215 at $230.00 and CPT 71046 at $80.00, for a total of $310.00. Prior authorisation PA-7781 was issued on 2024-12-20.

The denial was dated 2025-02-10 and this appeal is submitted 2025-02-20, within the 180 days allowed for filing.

Enclosures: EOB, letter of medical necessity, progress notes, radiology report, itemised bill.

Sincerely, Dr. A. Rivera, (555) 010-2233, appeals@mercyclinic.example`
  },

  mismatched: {
    label: "Reads well, contradicts the claim",
    claim: CLAIM_A,
    text: `Appeal of claim #A-99231 for our patient, member 55512-01.

The patient was seen on 2025-02-14 for an extended evaluation. We billed CPT 99215 and CPT 74177, both of which were clinically indicated and documented in the chart.

The treatment involved 4 separate sessions over the course of care. The total charges of $1,850.00 remain outstanding following your determination, and we ask that the full amount be reimbursed.

Denial reason CARC 50 was applied, per the EOB dated 2025-02-10. The letter of medical necessity and the progress notes are enclosed. This appeal is submitted within the 180 days allowed for filing.

Sincerely, Dr. A. Rivera, (555) 010-2233`
  },

  padded: {
    label: "Padded and unsupported",
    claim: CLAIM_B,
    text: `To Whom It May Concern,

I am writing to appeal your completely unacceptable denial of this claim. The handling of this matter reflects blatant negligence by your review department, and the reviewer clearly ignored the documentation we provided. This is absolutely indefensible.

Our patient has suffered enormously. The delay directly caused a dramatic deterioration in her condition, and she would have died had we waited for your authorisation. Every patient in this situation requires immediate treatment without exception.

Several members of our staff spent considerable time on this matter recently, and on multiple occasions we were told the claim was under review. The doctor confirmed the treatment was medically appropriate per the standard of care. As documented in our records, all necessary documentation was provided.

This is a straightforward case and the denial must be reversed IMMEDIATELY. We expect payment in full!`
  },

  textonly: {
    label: "Appeal text with no claim record",
    claim: null,
    text: `We are appealing the denial issued on this account.

Studies show 92% of patients respond to this protocol, and outcomes improved by 340% compared with the alternative. In our practice, 14 of 30 (52%) similar appeals were overturned last year.

Treatment lasted 6 months, from 2025-01-03 to 2025-02-12, and involved three (5) separate infusion sessions. We billed $1,200.50, $800.00, and $450.00 for a total of $2,000.50.

The total charges of $2,450.50 remain unpaid. Several members of staff reviewed this recently and it was determined that the denial was issued in error.`
  }

};
