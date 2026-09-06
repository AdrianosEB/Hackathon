// =============================================
// AGENT 3 — Vagueness & Unsupported Assertion
//
// Finds statements that cannot be verified as
// written: unquantified amounts, undated events,
// unnamed actors, hedged conclusions, dangling
// references.
// =============================================

import { makeFinding, scanLexicon, groupBySentence } from "./finding.js";


const VAGUE_QUANTITY = [
  "several", "many", "numerous", "various", "multiple", "a number of",
  "some", "most", "a few", "a lot of", "plenty of", "countless",
  "substantial", "considerable", "significant", "significantly",
  "minimal", "extensive", "a great deal", "much of", "the majority",
  "a large portion", "a small portion", "innumerable"
];


const VAGUE_TIME = [
  "recently", "soon", "shortly", "in the past", "previously",
  "for some time", "a while ago", "eventually", "periodically",
  "frequently", "often", "repeatedly", "on multiple occasions",
  "over the years", "at that time", "later", "earlier",
  "in a timely manner", "promptly", "immediately thereafter",
  "on numerous occasions", "ongoing"
];


const HEDGES = [
  "may", "might", "could", "possibly", "perhaps", "presumably",
  "seems", "appears", "we believe", "we feel", "we think",
  "it is likely", "likely", "probably", "arguably", "tends to",
  "generally", "typically", "usually", "in most cases",
  "to some extent", "more or less", "essentially", "virtually"
];


const UNNAMED_ACTOR = [
  "the doctor", "a doctor", "the physician", "a physician",
  "the specialist", "a specialist", "the nurse", "a nurse",
  "the reviewer", "a reviewer", "the department", "the staff",
  "an expert", "the expert", "a representative", "the representative",
  "someone", "they told us", "we were told", "we were informed",
  "the provider was informed", "an agent"
];


const UNDEFINED_STANDARD = [
  "standard of care", "industry standard", "best practice",
  "best practices", "generally accepted", "widely accepted",
  "per policy", "as required", "according to policy",
  "in accordance with guidelines", "customary", "usual and customary",
  "medically appropriate", "clinically indicated"
];


const CATEGORIES = [
  {
    id: "unquantified_amount",
    terms: VAGUE_QUANTITY,
    severity: "medium",
    message: (terms) => `Quantity stated only as ${terms} — no number is given.`,
    ask: (quote) => `How many, exactly? Please replace "${quote}" with a count taken from the record.`
  },
  {
    id: "undated_event",
    terms: VAGUE_TIME,
    severity: "medium",
    message: (terms) => `Timing stated only as ${terms} — no date is given.`,
    ask: (quote) => `What is the specific date or date range behind "${quote}"?`
  },
  {
    id: "hedged_assertion",
    terms: HEDGES,
    severity: "low",
    message: (terms) => `Hedged wording (${terms}) leaves the claim unasserted.`,
    ask: (quote) => `Is the point qualified by "${quote}" established by a record, or is it an inference?`
  },
  {
    id: "unnamed_actor",
    terms: UNNAMED_ACTOR,
    severity: "medium",
    message: (terms) => `The actor is referred to only as ${terms} — not identified.`,
    ask: (quote) => `Who specifically is "${quote}" (name, role, and date of the interaction)?`
  },
  {
    id: "undefined_standard",
    terms: UNDEFINED_STANDARD,
    severity: "medium",
    message: (terms) => `Appeals to an unspecified authority (${terms}) with no citation.`,
    ask: (quote) => `Which guideline, policy section, or plan provision is meant by "${quote}"? Please quote it.`
  }
];


export function runVaguenessAgent(context) {
  const { text, sentences } = context;
  const findings = [];

  for (const category of CATEGORIES) {
    const hits = scanLexicon(text, category.terms);

    for (const group of groupBySentence(hits, sentences)) {
      const quotes = [...new Set(group.hits.map((hit) => hit.quote))];
      const first = group.hits[0];

      findings.push(
        makeFinding({
          agent: "vagueness",
          category: category.id,
          severity:
            group.hits.length >= 3 && category.severity === "low"
              ? "medium"
              : category.severity,
          quote: quotes.join(", "),
          start: first.start,
          end: group.hits[group.hits.length - 1].end,
          sentences,
          message: category.message(quotes.map((q) => `"${q}"`).join(", ")),
          evidence: group.sentence ? group.sentence.text : quotes.join(", "),
          ask: category.ask(quotes[0])
        })
      );
    }
  }

  findings.push(...agentlessPassive(text, sentences));
  findings.push(...danglingReference(sentences));
  findings.push(...overlongSentences(sentences));

  return {
    agent: "vagueness",
    findings
  };
}


// =============================================
// "was denied" / "it was determined" with no
// stated actor
// =============================================

function agentlessPassive(text, sentences) {
  const findings = [];

  const pattern =
    /\b(?:it\s+)?(?:was|were|has been|have been|had been)\s+(denied|rejected|determined|decided|documented|reviewed|processed|adjusted|downcoded|recouped|advised|informed|noted|confirmed|established)\b(?!\s+by\b)/gi;

  let match;

  while ((match = pattern.exec(text)) !== null) {
    findings.push(
      makeFinding({
        agent: "vagueness",
        category: "agentless_passive",
        severity: "low",
        quote: match[0],
        start: match.index,
        end: match.index + match[0].length,
        sentences,
        message: `"${match[0]}" does not say who acted, so the statement cannot be traced to a person or record.`,
        evidence: `"${match[0]}".`,
        ask: `Who ${match[1]} it, on what date, and in what document?`
      })
    );
  }

  return findings;
}


// =============================================
// Sentences opening with an unbound pronoun
// =============================================

function danglingReference(sentences) {
  const findings = [];

  for (const sentence of sentences) {
    const match = sentence.text.match(
      /^(This|That|These|Those|It|They|Such)\s+(is|was|are|were|has|have|had|will|would|should|clearly|obviously|means|resulted|caused|shows)\b/
    );

    if (!match) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "vagueness",
        category: "dangling_reference",
        severity: "low",
        quote: match[0],
        start: sentence.start,
        end: sentence.start + match[0].length,
        sentences,
        message: `The sentence opens with "${match[1]}" without naming what it refers to.`,
        evidence: sentence.text,
        ask: `What specifically does "${match[1]}" refer to in this sentence?`
      })
    );
  }

  return findings;
}


// =============================================
// Sentences long enough to hide several claims
// =============================================

function overlongSentences(sentences) {
  const longOnes = sentences.filter((sentence) => sentence.wordCount >= 45);

  if (longOnes.length === 0) {
    return [];
  }

  const worst = longOnes.reduce(
    (a, b) => (b.wordCount > a.wordCount ? b : a),
    longOnes[0]
  );

  return [
    makeFinding({
      agent: "vagueness",
      category: "compound_sentence",
      severity: "low",
      quote: `${worst.text.slice(0, 70)}…`,
      start: worst.start,
      end: worst.end,
      sentences,
      message: `${longOnes.length} sentence(s) run to 45+ words, bundling several claims that would each need separate support (longest: ${worst.wordCount} words).`,
      evidence: worst.text,
      ask: "Can the longest passages be split so each factual claim can be evidenced separately?"
    })
  ];
}
