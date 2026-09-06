// =============================================
// AGENT 5 — Cross-Section Consistency
//
// The only agent that reads the whole appeal at
// once. It looks for the appeal contradicting
// itself between paragraphs or chunks, which the
// per-chunk agents cannot see.
// =============================================

import { makeFinding, money } from "./finding.js";
import { countWords } from "./text-utils.js";


const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "and", "or", "in", "on", "at",
  "was", "were", "is", "are", "be", "been", "we", "our", "us", "this",
  "that", "these", "those", "it", "its", "as", "by", "with", "from",
  "which", "their", "there", "his", "her", "they", "them", "had", "has"
]);


const EVENT_KEYWORDS = [
  "service", "serviced", "rendered", "treated", "treatment",
  "denied", "denial", "surgery", "procedure", "admitted",
  "admission", "discharged", "discharge", "submitted", "submission",
  "appeal", "appealed", "received", "paid", "billed", "visit"
];


export function runConsistencyAgent(context) {
  const { text, sentences, numbers, dates } = context;

  const findings = [
    ...conflictingLabelledAmounts(numbers, sentences),
    ...conflictingEventDates(text, dates, sentences),
    ...restatedClaims(sentences)
  ];

  return {
    agent: "consistency",
    findings
  };
}


// =============================================
// The same thing given two different amounts
// =============================================

function conflictingLabelledAmounts(numbers, sentences) {
  const buckets = new Map();

  for (const number of numbers) {
    if (number.kind !== "currency") {
      continue;
    }

    for (const label of labelsFor(number.before)) {
      if (!buckets.has(label)) {
        buckets.set(label, []);
      }

      buckets.get(label).push(number);
    }
  }

  const findings = [];

  for (const [label, entries] of buckets) {
    const distinct = [...new Set(entries.map((entry) => entry.value))];

    if (distinct.length < 2) {
      continue;
    }

    const paragraphs = [
      ...new Set(
        entries
          .map((entry) => sentences[entry.sentenceIndex]?.paragraph)
          .filter((value) => value !== undefined)
      )
    ];

    // Same-sentence arithmetic is the numbers agent's
    // job; this agent only reports conflicts that span
    // sections.
    if (paragraphs.length < 2) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "consistency",
        category: "conflicting_amount",
        severity: "high",
        quote: entries.map((entry) => entry.raw).join(" vs "),
        start: entries[0].start,
        end: entries[entries.length - 1].end,
        sentences,
        message: `The appeal gives ${distinct.length} different amounts for "${label}": ${distinct
          .map((value) => money(value))
          .join(", ")}.`,
        evidence: `Stated in paragraph(s) ${paragraphs
          .map((index) => index + 1)
          .join(", ")}: ${entries.map((entry) => entry.raw).join(", ")}.`,
        ask: `Which amount for "${label}" is correct? Please provide the billing record that settles it.`
      })
    );
  }

  return findings;
}


// =============================================
// Every meaningful word immediately before a
// figure is treated as a candidate label, so
// "total of $2,000.50" and "total charges of
// $2,450.50" land in the same bucket.
// =============================================

function labelsFor(before) {
  const words = before
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));

  return words.slice(-3).filter((word) => word.length > 3);
}


// =============================================
// The same event given two different dates
// =============================================

function conflictingEventDates(text, dates, sentences) {
  const buckets = new Map();

  for (const date of dates) {
    const sentence = sentences[date.sentenceIndex];

    if (!sentence) {
      continue;
    }

    // The event word has to be NEXT TO the date. A
    // sentence mentioning both a denial and an appeal
    // date must not put both dates in one bucket.
    const keyword = nearestEventKeyword(text, date.start);

    if (!keyword) {
      continue;
    }

    if (!buckets.has(keyword)) {
      buckets.set(keyword, []);
    }

    buckets.get(keyword).push(date);
  }

  const findings = [];

  for (const [keyword, entries] of buckets) {
    const distinct = [...new Set(entries.map((entry) => entry.date.getTime()))];

    if (distinct.length < 2) {
      continue;
    }

    const paragraphs = [
      ...new Set(
        entries.map((entry) => sentences[entry.sentenceIndex]?.paragraph)
      )
    ];

    if (paragraphs.length < 2) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "consistency",
        category: "conflicting_date",
        severity: "medium",
        quote: entries.map((entry) => entry.raw).join(" vs "),
        start: entries[0].start,
        end: entries[entries.length - 1].end,
        sentences,
        message: `Different dates are attached to "${keyword}" in different sections: ${[
          ...new Set(entries.map((entry) => entry.raw))
        ].join(", ")}.`,
        evidence: `Paragraph(s) ${paragraphs
          .map((index) => index + 1)
          .join(", ")} each state a different ${keyword} date.`,
        ask: `Please confirm the correct ${keyword} date and supply the record that shows it.`
      })
    );
  }

  return findings;
}


const KEYWORD_WINDOW = 44;


function nearestEventKeyword(text, offset) {
  const window = text.slice(Math.max(0, offset - KEYWORD_WINDOW), offset);

  let best = null;
  let bestPosition = -1;

  for (const word of EVENT_KEYWORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, "gi");
    let match;

    while ((match = pattern.exec(window)) !== null) {
      if (match.index > bestPosition) {
        bestPosition = match.index;
        best = word;
      }
    }
  }

  return best;
}


// =============================================
// The same claim restated in another section
//
// Repetition inflates length without adding
// evidence, and it is where contradictions hide.
// =============================================

function restatedClaims(sentences) {
  const candidates = sentences
    .filter((sentence) => sentence.wordCount >= 8)
    .map((sentence) => ({ ...sentence, tokens: tokenSet(sentence.text) }));

  const findings = [];
  const used = new Set();

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];

      if (a.paragraph === b.paragraph) {
        continue;
      }

      if (used.has(b.index)) {
        continue;
      }

      const overlap = jaccard(a.tokens, b.tokens);

      if (overlap < 0.6) {
        continue;
      }

      used.add(b.index);

      findings.push(
        makeFinding({
          agent: "consistency",
          category: "restated_claim",
          severity: "low",
          quote: `${b.text.slice(0, 70)}…`,
          start: b.start,
          end: b.end,
          sentences,
          message: `Paragraph ${b.paragraph + 1} restates a claim already made in paragraph ${
            a.paragraph + 1
          } (${Math.round(overlap * 100)}% word overlap) without adding evidence.`,
          evidence: `Paragraph ${a.paragraph + 1}: "${a.text}"\nParagraph ${
            b.paragraph + 1
          }: "${b.text}"`,
          ask: "Repetition does not add support — is there a new document behind the restated point?"
        })
      );
    }
  }

  return findings;
}


function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (setA.size + setB.size - intersection);
}


function tokenSet(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
  );
}


export function chunkWordCount(text) {
  return countWords(text);
}
