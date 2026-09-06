// =============================================
// AGENT 1 — Exaggeration & Overstatement
//
// Looks for language that claims more than the
// appeal can support: absolutes, superlatives,
// emotive accusation, and unhedged causation.
// =============================================

import { makeFinding, scanLexicon, groupBySentence } from "./finding.js";


const ABSOLUTES = [
  "always", "never", "all patients", "every patient", "no exception",
  "without exception", "invariably", "universally", "entirely",
  "completely", "totally", "absolutely", "unquestionably",
  "undeniably", "indisputably", "certainly", "obviously", "clearly",
  "guaranteed", "impossible", "nothing", "no other option",
  "only possible", "the sole"
];


const SUPERLATIVES = [
  "unprecedented", "unparalleled", "unheard of", "extraordinary",
  "catastrophic", "devastating", "egregious", "outrageous",
  "astronomical", "exorbitant", "grossly", "massive", "enormous",
  "tremendous", "extreme", "dire", "life-threatening",
  "irreparable", "irreversible", "worst", "best possible",
  "highest possible", "single most"
];


const INTENSIFIERS = [
  "very", "extremely", "incredibly", "exceptionally", "remarkably",
  "tremendously", "vastly", "dramatically", "drastically",
  "radically", "immensely", "profoundly", "utterly", "wildly",
  "far more", "far less", "way beyond"
];


const ACCUSATORY = [
  "negligent", "negligence", "reckless", "blatant", "blatantly",
  "willful", "willfully", "deliberate", "deliberately", "malicious",
  "bad faith", "stonewalled", "stonewalling", "ignored our",
  "refused to even", "flatly refused", "arbitrary and capricious",
  "unconscionable", "appalling", "shocking", "unacceptable",
  "inexcusable", "indefensible"
];


const CAUSAL_CLAIMS = [
  "directly caused", "directly resulted in", "led directly to",
  "would have died", "would have been fatal", "solely because",
  "the only reason", "proves that", "proof that", "demonstrates conclusively",
  "leaves no doubt", "beyond any doubt", "can only be explained by"
];


const CATEGORIES = [
  {
    id: "absolute_claim",
    terms: ABSOLUTES,
    severity: "medium",
    label: "Absolute claim",
    message: (terms) =>
      `Absolute language (${terms}) states a claim that admits no exception.`,
    ask: (quote) =>
      `The appeal says "${quote}". Can you supply the records that support this without exception, or should it be restated as a qualified claim?`
  },
  {
    id: "superlative",
    terms: SUPERLATIVES,
    severity: "medium",
    label: "Superlative / severity escalation",
    message: (terms) =>
      `Superlative or severity language (${terms}) escalates the claim beyond what a record can show on its own.`,
    ask: (quote) =>
      `What documented clinical or financial finding supports the characterisation "${quote}"?`
  },
  {
    id: "intensifier",
    terms: INTENSIFIERS,
    severity: "low",
    label: "Unquantified intensifier",
    message: (terms) =>
      `Intensifier (${terms}) amplifies a claim without quantifying it.`,
    ask: (quote) =>
      `Can "${quote}" be replaced with the actual figure or measurement?`
  },
  {
    id: "accusation",
    terms: ACCUSATORY,
    severity: "high",
    label: "Accusatory characterisation",
    message: (terms) =>
      `Accusatory framing (${terms}) asserts intent or fault, which needs documentary support.`,
    ask: (quote) =>
      `The appeal characterises the payer's conduct as "${quote}". What correspondence, call log, or dated record evidences this?`
  },
  {
    id: "unhedged_causation",
    terms: CAUSAL_CLAIMS,
    severity: "high",
    label: "Unhedged causal claim",
    message: (terms) =>
      `Causal certainty (${terms}) asserts a cause-and-effect link that ordinarily requires clinical attestation.`,
    ask: (quote) =>
      `Is there a physician statement or clinical record establishing "${quote}"?`
  }
];


export function runExaggerationAgent(context) {
  const { text, sentences } = context;
  const findings = [];

  for (const category of CATEGORIES) {
    const hits = scanLexicon(text, category.terms);

    for (const group of groupBySentence(hits, sentences)) {
      const quotes = [...new Set(group.hits.map((hit) => hit.quote))];
      const first = group.hits[0];

      const escalate =
        group.hits.length >= 3 && category.severity === "low"
          ? "medium"
          : category.severity;

      findings.push(
        makeFinding({
          agent: "exaggeration",
          category: category.id,
          severity: escalate,
          quote: quotes.join(", "),
          start: first.start,
          end: group.hits[group.hits.length - 1].end,
          sentences,
          message: category.message(quotes.map((q) => `"${q}"`).join(", ")),
          evidence: group.sentence
            ? group.sentence.text
            : text.slice(first.start, first.end + 60),
          ask: category.ask(quotes[0])
        })
      );
    }
  }

  findings.push(...typographicEmphasis(text, sentences));

  return {
    agent: "exaggeration",
    findings
  };
}


// =============================================
// Emphasis carried by punctuation and casing
// =============================================

function typographicEmphasis(text, sentences) {
  const findings = [];

  const shouting = [...text.matchAll(/\b[A-Z]{4,}\b/g)].filter(
    (match) =>
      !/^(CPT|ICD|HCPCS|DRG|NPI|EOB|MRN|USA|HIPAA|CMS|PPO|HMO|TIN|LMN|CARC|RARC)$/.test(
        match[0]
      )
  );

  if (shouting.length > 0) {
    findings.push(
      makeFinding({
        agent: "exaggeration",
        category: "typographic_emphasis",
        severity: "low",
        quote: shouting.map((m) => m[0]).slice(0, 5).join(", "),
        start: shouting[0].index,
        end: shouting[0].index + shouting[0][0].length,
        sentences,
        message: `${shouting.length} word(s) are set in full capitals for emphasis rather than stated as fact.`,
        evidence: `Capitalised: ${shouting.map((m) => m[0]).slice(0, 8).join(", ")}.`,
        ask: "Emphasis does not add evidence — is there a record that establishes these points directly?"
      })
    );
  }

  const exclamations = [...text.matchAll(/!+/g)];

  if (exclamations.length >= 2) {
    findings.push(
      makeFinding({
        agent: "exaggeration",
        category: "typographic_emphasis",
        severity: "low",
        quote: "!",
        start: exclamations[0].index,
        end: exclamations[0].index + 1,
        sentences,
        message: `${exclamations.length} exclamation marks indicate rhetorical rather than evidentiary emphasis.`,
        evidence: "Repeated exclamation punctuation across the appeal.",
        ask: "Which of the emphasised statements can be tied to a dated document?"
      })
    );
  }

  return findings;
}
