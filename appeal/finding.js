// =============================================
// Shared finding shape + lexicon scanning
// =============================================

import { sentenceAt } from "./text-utils.js";


export const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };


// Findings with no offsets — a missing document,
// for instance — still need distinct ids, so the
// quote discriminates them.
function slug(value) {
  return String(value || "none")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}


export function makeFinding({
  agent,
  category,
  severity = "medium",
  quote,
  start,
  end,
  sentences,
  message,
  evidence,
  ask,
  detectedBy = ["rules"]
}) {
  const sentence =
    typeof start === "number" ? sentenceAt(sentences, start) : null;

  return {
    id: `${agent}-${category}-${start ?? "x"}-${end ?? "x"}-${slug(quote)}`,
    agent,
    category,
    severity,
    confidence: detectedBy.includes("ai") ? 0.55 : 0.62,
    quote,
    start: start ?? null,
    end: end ?? null,
    sentenceIndex: sentence ? sentence.index : null,
    paragraphIndex: sentence ? sentence.paragraph : null,
    sentenceText: sentence ? sentence.text : null,
    message,
    evidence,
    ask: ask || null,
    detectedBy
  };
}


// =============================================
// Scan the text for every term in a lexicon
// =============================================

export function scanLexicon(text, terms) {
  const hits = [];

  for (const term of terms) {
    const pattern = new RegExp(
      `(?<![A-Za-z])(${term.replace(/ /g, "\\s+")})(?![A-Za-z])`,
      "gi"
    );

    let match;

    while ((match = pattern.exec(text)) !== null) {
      hits.push({
        term,
        quote: match[0],
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  return hits.sort((a, b) => a.start - b.start);
}


export function groupBySentence(hits, sentences) {
  const grouped = new Map();

  for (const hit of hits) {
    const sentence = sentenceAt(sentences, hit.start);
    const key = sentence ? sentence.index : -1;

    if (!grouped.has(key)) {
      grouped.set(key, { sentence, hits: [] });
    }

    grouped.get(key).hits.push(hit);
  }

  return [...grouped.values()];
}


export function money(value) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}
