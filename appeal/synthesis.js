// =============================================
// AGENTS 6-8 — Reconcile, Question, Report
//
// 6. Reconciler   — merges rule + AI findings
// 7. Interrogator — turns findings into requests
// 8. Reporter     — assembles the final report
// =============================================

import { SEVERITY_RANK } from "./finding.js";


// =============================================
// AGENT 6 — Reconciler
// =============================================

export function reconcileFindings(allFindings) {
  const merged = [];

  for (const finding of allFindings) {
    const twin = merged.find((candidate) => sameIssue(candidate, finding));

    if (!twin) {
      merged.push({ ...finding, detectedBy: [...finding.detectedBy] });
      continue;
    }

    twin.detectedBy = [...new Set([...twin.detectedBy, ...finding.detectedBy])];

    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[twin.severity]) {
      twin.severity = finding.severity;
    }

    if (!twin.ask && finding.ask) {
      twin.ask = finding.ask;
    }

    if (finding.detectedBy.includes("ai") && finding.message) {
      twin.aiNote = finding.message;
    }
  }

  for (const finding of merged) {
    finding.confidence = confidenceFor(finding);
  }

  return collapseRepetition(merged.sort(byImportance));
}


// =============================================
// Roll up repetition
//
// A long appeal can hit the same lexical pattern
// twenty times. The reviewer needs the pattern
// and the worst examples, not twenty rows.
// =============================================

const ROLLUP_LIMIT = 4;


// Checklist gaps are never rolled up — each missing
// document is its own action for the reviewer.
const NEVER_ROLLUP = new Set([
  "missing_required_document",
  "missing_supporting_document",
  "arithmetic_mismatch",
  "percentage_mismatch",
  "impossible_figure",
  "internal_contradiction",
  "conflicting_amount"
]);


export const CATEGORY_LABELS = {
  arithmetic_mismatch: "figures that do not add up",
  percentage_mismatch: "percentages that do not match their counts",
  impossible_figure: "impossible figures",
  internal_contradiction: "internal contradictions",
  date_problem: "date problems",
  conflicting_amount: "conflicting amounts",
  conflicting_date: "conflicting dates",
  conflicting_narrative: "conflicting statements",
  missing_baseline: "changes stated without a baseline",
  unsourced_statistic: "statistics without a source",
  implausible_magnitude: "implausibly large figures",
  false_precision: "figures with false precision",
  rounded_estimates: "rounded estimates",
  missing_required_document: "required documents not referenced",
  missing_supporting_document: "supporting documents not referenced",
  asserted_but_not_enclosed: "evidence asserted but not enclosed",
  referenced_but_unidentified: "documents referenced but not identified",
  chain_of_evidence_gap: "gaps in the evidence chain",
  absolute_claim: "absolute claims",
  superlative: "superlatives",
  intensifier: "unquantified intensifiers",
  accusation: "accusatory characterisations",
  accusatory_characterisation: "accusatory characterisations",
  unhedged_causation: "unhedged causal claims",
  rhetorical_overreach: "rhetorical overreach",
  typographic_emphasis: "typographic emphasis",
  unquantified_amount: "unquantified amounts",
  undated_event: "undated events",
  unnamed_actor: "unnamed actors",
  undefined_standard: "appeals to unspecified authority",
  hedged_assertion: "hedged assertions",
  unverifiable_assertion: "unverifiable assertions",
  agentless_passive: "statements with no stated actor",
  dangling_reference: "dangling references",
  compound_sentence: "overlong compound sentences",
  restated_claim: "restated claims"
};


function collapseRepetition(findings) {
  const groups = new Map();

  for (const finding of findings) {
    const key = `${finding.agent}|${finding.category}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(finding);
  }

  const output = [];

  for (const [key, items] of groups) {
    if (items.length <= ROLLUP_LIMIT || NEVER_ROLLUP.has(items[0].category)) {
      output.push(...items);
      continue;
    }

    const kept = items.slice(0, ROLLUP_LIMIT);
    const rest = items.slice(ROLLUP_LIMIT);
    const representative = rest[0];

    const paragraphs = [
      ...new Set(
        rest
          .map((finding) => finding.paragraphIndex)
          .filter((value) => value !== null)
      )
    ].sort((a, b) => a - b);

    output.push(...kept);

    output.push({
      ...representative,
      id: `${key.replace("|", "-")}-rollup`,
      rolledUp: true,
      instanceCount: rest.length,
      instances: rest.map((finding) => ({
        quote: finding.quote,
        paragraph:
          finding.paragraphIndex === null ? null : finding.paragraphIndex + 1,
        start: finding.start,
        end: finding.end,
        sentenceText: finding.sentenceText,
        message: finding.message
      })),
      severity: rest.reduce(
        (worst, finding) =>
          SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst]
            ? finding.severity
            : worst,
        "low"
      ),
      message: `${rest.length} further instance(s) of ${
        CATEGORY_LABELS[representative.category] || representative.category
      }${
        paragraphs.length > 0
          ? ` in paragraph(s) ${paragraphs.map((index) => index + 1).join(", ")}`
          : ""
      }.`,
      evidence: rest
        .slice(0, 6)
        .map((finding) => `"${finding.quote}"`)
        .join(", ")
    });
  }

  return output.sort(byImportance);
}


// =============================================
// Two findings describe the same issue when they
// cover the same span and either carry the same
// category, or come from DIFFERENT layers within
// one theme.
//
// The cross-category case exists because the model
// routinely picks a different label than the rules
// for the same defect — "internal_contradiction"
// where the rules said "arithmetic_mismatch".
// Requiring different layers keeps two genuinely
// distinct rule findings from collapsing.
// =============================================

function sameIssue(a, b) {
  if (!overlaps(a, b)) {
    return false;
  }

  if (a.category === b.category) {
    return true;
  }

  const crossLayer =
    a.detectedBy.includes("rules") !== b.detectedBy.includes("rules");

  if (!crossLayer) {
    return false;
  }

  return themeOf(a.category) === themeOf(b.category);
}


function themeOf(category) {
  return (THEMES[category] || { theme: "Other" }).theme;
}


function overlaps(a, b) {
  if (a.start === null || b.start === null) {
    return a.quote === b.quote;
  }

  return a.start < b.end && b.start < a.end;
}


function confidenceFor(finding) {
  const corroborated =
    finding.detectedBy.includes("rules") && finding.detectedBy.includes("ai");

  if (corroborated) {
    return 0.92;
  }

  if (finding.detectedBy.includes("rules")) {
    const deterministic = [
      "arithmetic_mismatch",
      "percentage_mismatch",
      "impossible_figure",
      "internal_contradiction",
      "date_problem",
      "conflicting_amount",
      "missing_required_document",
      "missing_supporting_document"
    ];

    return deterministic.includes(finding.category) ? 0.95 : 0.68;
  }

  return 0.55;
}


function byImportance(a, b) {
  const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];

  if (severity !== 0) {
    return severity;
  }

  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }

  return (a.start ?? 1e9) - (b.start ?? 1e9);
}


// =============================================
// AGENT 7 — Interrogator
//
// Findings become a ranked, de-duplicated list of
// information requests, because "what should I
// ask for next" is the actual deliverable.
// =============================================

const THEMES = {
  arithmetic_mismatch: { theme: "Figures", blocking: true },
  percentage_mismatch: { theme: "Figures", blocking: true },
  impossible_figure: { theme: "Figures", blocking: true },
  internal_contradiction: { theme: "Figures", blocking: true },
  date_problem: { theme: "Dates", blocking: true },
  conflicting_amount: { theme: "Figures", blocking: true },
  conflicting_date: { theme: "Dates", blocking: true },
  conflicting_narrative: { theme: "Narrative", blocking: true },
  missing_baseline: { theme: "Figures", blocking: false },
  unsourced_statistic: { theme: "Sourcing", blocking: false },
  implausible_magnitude: { theme: "Sourcing", blocking: false },
  false_precision: { theme: "Sourcing", blocking: false },
  rounded_estimates: { theme: "Figures", blocking: false },
  missing_required_document: { theme: "Documentation", blocking: true },
  missing_supporting_document: { theme: "Documentation", blocking: false },
  asserted_but_not_enclosed: { theme: "Documentation", blocking: true },
  referenced_but_unidentified: { theme: "Documentation", blocking: true },
  chain_of_evidence_gap: { theme: "Documentation", blocking: false },
  absolute_claim: { theme: "Claim strength", blocking: false },
  superlative: { theme: "Claim strength", blocking: false },
  intensifier: { theme: "Claim strength", blocking: false },
  accusation: { theme: "Claim strength", blocking: false },
  accusatory_characterisation: { theme: "Claim strength", blocking: false },
  unhedged_causation: { theme: "Claim strength", blocking: true },
  rhetorical_overreach: { theme: "Claim strength", blocking: false },
  typographic_emphasis: { theme: "Claim strength", blocking: false },
  unquantified_amount: { theme: "Specificity", blocking: false },
  undated_event: { theme: "Dates", blocking: false },
  unnamed_actor: { theme: "Specificity", blocking: false },
  undefined_standard: { theme: "Sourcing", blocking: false },
  hedged_assertion: { theme: "Specificity", blocking: false },
  unverifiable_assertion: { theme: "Specificity", blocking: false },
  agentless_passive: { theme: "Specificity", blocking: false },
  dangling_reference: { theme: "Specificity", blocking: false },
  compound_sentence: { theme: "Specificity", blocking: false },
  restated_claim: { theme: "Narrative", blocking: false }
};


const MAX_QUESTIONS = 15;


export function buildInformationRequests(findings) {
  const requests = [];
  const seen = new Set();

  for (const finding of findings) {
    if (!finding.ask) {
      continue;
    }

    const key = normalizeQuestion(finding.ask);

    if (seen.has(key)) {
      const existing = requests.find((request) => request.key === key);

      if (existing) {
        existing.supportingFindings.push(finding.id);
      }

      continue;
    }

    seen.add(key);

    const meta = THEMES[finding.category] || {
      theme: "Other",
      blocking: false
    };

    requests.push({
      key,
      question: finding.ask,
      theme: meta.theme,
      blocking: meta.blocking,
      severity: finding.severity,
      confidence: finding.confidence,
      basis: finding.message,
      quote: finding.quote,
      paragraph:
        finding.paragraphIndex === null ? null : finding.paragraphIndex + 1,
      supportingFindings: [finding.id]
    });
  }

  requests.sort((a, b) => {
    if (a.blocking !== b.blocking) {
      return a.blocking ? -1 : 1;
    }

    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];

    if (severity !== 0) {
      return severity;
    }

    return b.confidence - a.confidence;
  });

  // Blocking requests still come first, but within each
  // half the themes are interleaved. Otherwise eight
  // missing documents fill every slot and the reviewer
  // never sees the contradicted figure.
  const ordered = [
    ...interleaveByTheme(requests.filter((request) => request.blocking)),
    ...interleaveByTheme(requests.filter((request) => !request.blocking))
  ];

  return ordered.slice(0, MAX_QUESTIONS).map((request, index) => ({
    ...request,
    priority: index + 1
  }));
}


function interleaveByTheme(requests) {
  const queues = new Map();

  for (const request of requests) {
    if (!queues.has(request.theme)) {
      queues.set(request.theme, []);
    }

    queues.get(request.theme).push(request);
  }

  const lists = [...queues.values()];
  const ordered = [];

  let round = 0;

  while (ordered.length < requests.length) {
    let placed = false;

    for (const list of lists) {
      if (round < list.length) {
        ordered.push(list[round]);
        placed = true;
      }
    }

    if (!placed) {
      break;
    }

    round += 1;
  }

  return ordered;
}


function normalizeQuestion(text) {
  return String(text)
    .toLowerCase()
    .replace(/"[^"]*"/g, '"x"')
    .replace(/[^a-z0-9" ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


// =============================================
// AGENT 8 — Reporter
// =============================================

const SEVERITY_WEIGHT = { high: 6, medium: 3, low: 1.2 };


export function composeReport({
  context,
  findings,
  requests,
  documentation,
  claimAnalysis,
  stageRuns,
  aiLayer
}) {
  const counts = tally(findings);

  // The score is deterministic. An AI-only finding
  // contributes questions, never points — it was
  // measured to penalise good appeals and to leave
  // bad ones unchanged.
  const scored = findings.filter((finding) =>
    finding.detectedBy.includes("rules")
  );

  const rawPenalty = scored.reduce((total, finding) => {
    const weight = SEVERITY_WEIGHT[finding.severity] * finding.confidence;

    // A rolled-up row stands for many instances; it
    // counts for more than one row but not for all of
    // them, so volume cannot dominate the score.
    return total + (finding.rolledUp ? weight * 1.5 : weight);
  }, 0);

  // Longer appeals naturally accumulate more hits;
  // normalise so density, not volume, drives the score.
  const lengthFactor = Math.sqrt(
    250 / Math.max(120, context.metrics.wordCount)
  );

  const languagePenalty = Math.min(60, rawPenalty * lengthFactor);

  const missingRequired = documentation.checklist.filter(
    (item) => item.tier === "required" && item.status === "missing"
  ).length;

  const documentationPenalty = Math.min(30, missingRequired * 4);

  const integrityScore = Math.max(
    0,
    Math.round(100 - languagePenalty - documentationPenalty)
  );

  const verdict = decideVerdict({
    context,
    integrityScore,
    missingRequired,
    findings: scored
  });

  return {
    verdict,
    integrityScore,
    scoreBreakdown: {
      languagePenalty: Math.round(languagePenalty),
      documentationPenalty,
      lengthNormalisation: Number(lengthFactor.toFixed(2))
    },
    triage: {
      tier: context.tier,
      metrics: context.metrics,
      chunkCount: context.chunks.length,
      plan: context.plan.agents
    },
    claim: claimAnalysis
      ? {
          totalBilled: claimAnalysis.totalBilled,
          reviewAmount: claimAnalysis.reviewAmount,
          riskLevel: claimAnalysis.riskLevel,
          riskScore: claimAnalysis.riskScore,
          lineCount: context.claimIndex.lineItems.length,
          codes: [...context.claimIndex.codes],
          serviceDates: [...context.claimIndex.serviceDates]
        }
      : null,
    scoredFindingCount: scored.length,
    counts,
    aiLayer,
    stageRuns,
    sections: buildSections(findings),
    documentation: {
      completeness: documentation.completeness,
      checklist: documentation.checklist
    },
    findings,
    requests,
    highlights: buildHighlights(findings),
    paragraphs: context.paragraphs.map((paragraph) => ({
      index: paragraph.index,
      start: paragraph.start,
      end: paragraph.end,
      findingCount: findings.filter(
        (finding) => finding.paragraphIndex === paragraph.index
      ).length
    }))
  };
}


function buildHighlights(findings) {
  const highlights = [];

  for (const finding of findings) {
    if (finding.start !== null) {
      highlights.push({
        start: finding.start,
        end: finding.end,
        agent: finding.agent,
        category: finding.category,
        severity: finding.severity,
        message: finding.message,
        id: finding.id
      });
    }

    for (const instance of finding.instances || []) {
      if (instance.start === null) {
        continue;
      }

      highlights.push({
        start: instance.start,
        end: instance.end,
        agent: finding.agent,
        category: finding.category,
        severity: finding.severity,
        message: instance.message,
        id: finding.id
      });
    }
  }

  return highlights.sort((a, b) => a.start - b.start);
}


function tally(findings) {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byAgent = {};
  const byCategory = {};

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byAgent[finding.agent] = (byAgent[finding.agent] || 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
  }

  const instanceTotal = findings.reduce(
    (total, finding) => total + (finding.instanceCount || 0),
    0
  );

  return {
    total: findings.length,
    rolledUpInstances: instanceTotal,
    bySeverity,
    byAgent,
    byCategory,
    corroborated: findings.filter(
      (finding) =>
        finding.detectedBy.includes("rules") && finding.detectedBy.includes("ai")
    ).length
  };
}


function buildSections(findings) {
  const groups = new Map();

  for (const finding of findings) {
    const meta = THEMES[finding.category] || { theme: "Other" };

    if (!groups.has(meta.theme)) {
      groups.set(meta.theme, []);
    }

    groups.get(meta.theme).push(finding);
  }

  return [...groups.entries()]
    .map(([theme, items]) => ({
      theme,
      count: items.length,
      highest: items.reduce(
        (worst, item) =>
          SEVERITY_RANK[item.severity] > SEVERITY_RANK[worst]
            ? item.severity
            : worst,
        "low"
      ),
      findingIds: items.map((item) => item.id)
    }))
    .sort((a, b) => SEVERITY_RANK[b.highest] - SEVERITY_RANK[a.highest] || b.count - a.count);
}


function decideVerdict({ context, integrityScore, missingRequired, findings }) {
  if (context.tier.id === "insufficient") {
    return {
      id: "insufficient_detail",
      label: "Insufficient detail to review",
      summary: `At ${context.metrics.wordCount} words the appeal does not state enough for substantive analysis. ${missingRequired} required item(s) are absent.`
    };
  }

  const hardContradiction = findings.some(
    (finding) =>
      finding.confidence >= 0.9 &&
      [
        "arithmetic_mismatch",
        "percentage_mismatch",
        "impossible_figure",
        "internal_contradiction",
        "conflicting_amount"
      ].includes(finding.category)
  );

  if (hardContradiction) {
    return {
      id: "needs_correction",
      label: "Figures must be corrected before review",
      summary:
        "The appeal contains figures that contradict each other or cannot be reproduced from what is stated. These need correcting before the merits can be assessed."
    };
  }

  if (missingRequired > 0) {
    return {
      id: "needs_substantiation",
      label: "Needs substantiation",
      summary: `${missingRequired} document(s) an adjudicator requires are not referenced anywhere in the appeal.`
    };
  }

  if (integrityScore >= 85) {
    return {
      id: "ready_for_review",
      label: "Ready for review",
      summary:
        "The appeal is specific, internally consistent, and identifies its supporting documentation."
    };
  }

  return {
    id: "needs_clarification",
    label: "Needs clarification",
    summary:
      "Nothing contradicts, but several claims are stated too loosely to verify as written."
  };
}
