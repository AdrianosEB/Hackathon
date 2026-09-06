// =============================================
// The orchestration, described.
//
// Served to the UI so the pipeline diagram and
// the code cannot drift apart.
// =============================================

export const ORCHESTRATION = {
  name: "Claim + Appeal Integrity",
  scope:
    "Two inputs: the claim record and the appeal text. No website check, no external lookup — every finding is derived from one of those two sources, or from disagreement between them.",

  stages: [
    {
      order: 1,
      id: "intake",
      name: "Intake",
      scope: "both sources",
      layer: "rules",
      question: "What are we working with?",
      does: [
        "Segments the appeal once so every later stage shares character offsets",
        "Extracts figures, dates, durations, and cited codes from the text",
        "Indexes the claim: billed codes, service dates, units, line amounts, total",
        "Picks a length tier and chunk plan",
        "Switches stages on or off, with a stated reason"
      ]
    },
    {
      order: 2,
      id: "claim",
      name: "Claim Audit",
      scope: "claim record",
      layer: "rules",
      question: "Is the claim itself sound?",
      does: [
        "Duplicate procedure codes on one service date",
        "Unit counts of five or more on a single line",
        "Amounts more than 2.5× the reference price for the code",
        "Thin clinical notes behind higher-intensity procedures",
        "Missing diagnosis context"
      ]
    },
    {
      order: 2,
      id: "language",
      name: "Language Audit",
      scope: "chunk",
      layer: "rules + AI",
      question: "Does the appeal claim more than it can support?",
      does: [
        "Absolutes, superlatives, and accusatory framing",
        "Unhedged causation: directly caused, would have died, proves that",
        "Unquantified amounts: several, numerous, significant",
        "Undated events: recently, repeatedly, in a timely manner",
        "Unnamed actors and undefined standards of care",
        "Agentless passives, dangling references, 45+ word sentences"
      ]
    },
    {
      order: 2,
      id: "figures",
      name: "Figure & Date Audit",
      scope: "appeal text",
      layer: "rules + AI",
      question: "Do the numbers in the prose survive being checked?",
      does: [
        "Re-adds stated totals against their components",
        "Recomputes 'N of M (P%)' claims and rejects shares above 100%",
        "Flags statistics attributed to research with no citation",
        "Flags percentage changes with no baseline, and false precision behind hedges",
        "Compares stated durations against stated date ranges",
        "Catches word/digit mismatches, reversed ranges, and future dates",
        "Finds the same amount or date given differently in different sections"
      ]
    },
    {
      order: 2,
      id: "evidence",
      name: "Evidence Completeness",
      scope: "both sources",
      layer: "rules + AI",
      question: "What is still missing before this can be decided?",
      does: [
        "Fourteen items an adjudicator needs — eight required, six recommended",
        "Satisfies items from the claim record first: claim number, service dates, patient, provider, codes, clinical note, itemised charges",
        "Falls back to the appeal text for the rest: denial basis, medical necessity, prior authorisation, plan language, timely filing, signature, enclosures",
        "Flags evidence asserted in prose but never identified or enclosed",
        "Runs at every length"
      ]
    },
    {
      order: 3,
      id: "crosscheck",
      name: "Claim Cross-Check",
      scope: "both sources",
      layer: "rules + AI",
      question: "Does the appeal describe the claim that was actually filed?",
      does: [
        "Monetary figures in the prose that match no billed line and no claim total",
        "A stated total that disagrees with what the claim lines add up to",
        "Procedure or diagnosis codes argued for that were never billed",
        "Billed lines the appeal never argues for, with the money at stake",
        "Service dates asserted in the appeal that are not on the claim",
        "Session or visit counts that disagree with billed units"
      ]
    },
    {
      order: 4,
      id: "ai",
      name: "AI Review",
      scope: "appeal text",
      layer: "AI",
      question: "What can only be caught by reading it?",
      conditional: true,
      does: [
        "Runs only when the deterministic screen scores 40 or above — a weaker appeal is already decided",
        "Every finding must quote 3-20 words verbatim; a quote not found in the text is discarded",
        "Told what the rules already found, so it adds rather than repeats",
        "Contributes questions only — AI findings never move the score",
        "Skipped entirely with no API key; the run still completes"
      ]
    },
    {
      order: 5,
      id: "report",
      name: "Report",
      scope: "both sources",
      layer: "rules",
      question: "What does the reviewer read?",
      does: [
        "Merges findings that cover the same span, raising confidence where two layers agree",
        "Rolls repetition up into one row with expandable instances",
        "Scores integrity from deterministic findings only, normalised for length",
        "Decides a verdict: ready, needs clarification, needs substantiation, needs correction, insufficient detail",
        "Ranks questions blocking-first, de-duplicated, themes interleaved, capped at fifteen"
      ]
    }
  ],

  tiers: [
    { id: "insufficient", range: "0-39 words", effect: "Claim audit, arithmetic, cross-check and completeness only. Language is not judged." },
    { id: "brief", range: "40-149 words", effect: "Every stage, single pass." },
    { id: "standard", range: "150-599 words", effect: "Every stage, paragraph-level attribution." },
    { id: "long", range: "600-1499 words", effect: "Language audit splits into paragraph-aligned chunks run in parallel." },
    { id: "extended", range: "1500+ words", effect: "As above, with prioritised reporting so the report stays readable." }
  ],

  scoring: {
    formula: "100 − language penalty (max 60) − documentation penalty (4 per missing required item, max 30)",
    normalisation:
      "Findings are weighted 6 / 3 / 1.2 by severity × confidence, then scaled by √(250 / words) so density drives the score rather than volume.",
    aiPolicy:
      "AI findings are excluded from the score. Measured on two appeals, the AI layer moved a well-documented appeal from 100 to 56 and a poor one not at all — it penalised only the good appeal. It earns its place as a question generator, not as a scorer."
  }
};
