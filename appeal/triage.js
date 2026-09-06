// =============================================
// AGENT 0 — Intake & Triage
//
// Deterministic. Runs first, always.
//
// Measures the appeal, then decides WHICH
// specialist agents are worth running, at what
// depth, and over how many chunks.
// =============================================

import { indexClaim } from "./claim-index.js";

import {
  normalizeText,
  splitParagraphs,
  splitSentences,
  extractNumbers,
  extractDates,
  extractDurations,
  countWords
} from "./text-utils.js";


// =============================================
// Length tiers
//
// Each tier changes the analysis plan, not just
// a label.
// =============================================

const TIERS = [
  {
    id: "insufficient",
    label: "Insufficient",
    maxWords: 39,
    depth: "screen",
    note: "Too short to support substantive analysis. Only completeness is assessed."
  },
  {
    id: "brief",
    label: "Brief",
    maxWords: 149,
    depth: "shallow",
    note: "Short appeal. Single pass, every sentence is in scope."
  },
  {
    id: "standard",
    label: "Standard",
    maxWords: 599,
    depth: "standard",
    note: "Normal appeal length. Single pass with paragraph-level attribution."
  },
  {
    id: "long",
    label: "Long",
    maxWords: 1499,
    depth: "deep",
    note: "Long appeal. Chunked in parallel, plus a cross-chunk consistency pass."
  },
  {
    id: "extended",
    label: "Extended",
    maxWords: Infinity,
    depth: "deep",
    note: "Very long appeal. Chunked in parallel, cross-chunk consistency, prioritised reporting."
  }
];


const CHUNK_TARGET_WORDS = 420;


export function triageAppeal(rawText, claim = null) {
  const text = normalizeText(rawText).trim();
  const claimIndex = indexClaim(claim);
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text, paragraphs);

  const dates = extractDates(text, sentences);
  const durations = extractDurations(text, sentences);
  const numbers = extractNumbers(text, sentences, dates);

  const wordCount = countWords(text);
  const tier = TIERS.find((candidate) => wordCount <= candidate.maxWords);

  const sentenceLengths = sentences.map((sentence) => sentence.wordCount);

  const metrics = {
    charCount: text.length,
    wordCount,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    avgWordsPerSentence:
      sentences.length > 0
        ? round(wordCount / sentences.length, 1)
        : 0,
    longestSentenceWords:
      sentenceLengths.length > 0 ? Math.max(...sentenceLengths) : 0,
    numericMentions: numbers.length,
    currencyMentions: numbers.filter((n) => n.kind === "currency").length,
    percentMentions: numbers.filter((n) => n.kind === "percent").length,
    dateMentions: dates.length,
    durationMentions: durations.length,
    readingMinutes: Math.max(1, Math.round(wordCount / 220)),
    numericDensityPer100Words:
      wordCount > 0 ? round((numbers.length / wordCount) * 100, 2) : 0
  };

  const chunks = buildChunks(paragraphs, sentences, tier);

  const plan = buildPlan({
    tier,
    metrics,
    chunks,
    claimIndex
  });

  return {
    text,
    claim,
    claimIndex,
    paragraphs,
    sentences,
    numbers,
    dates,
    durations,
    metrics,
    tier: {
      id: tier.id,
      label: tier.label,
      depth: tier.depth,
      note: tier.note
    },
    chunks,
    plan
  };
}


// =============================================
// Chunking
//
// Paragraph-aligned so no sentence is ever split
// across two agents.
// =============================================

function buildChunks(paragraphs, sentences, tier) {
  if (paragraphs.length === 0) {
    return [];
  }

  if (tier.depth !== "deep") {
    return [
      {
        index: 0,
        start: paragraphs[0].start,
        end: paragraphs[paragraphs.length - 1].end,
        paragraphIndexes: paragraphs.map((p) => p.index),
        sentenceIndexes: sentences.map((s) => s.index),
        wordCount: sentences.reduce((total, s) => total + s.wordCount, 0)
      }
    ];
  }

  const chunks = [];
  let current = null;

  for (const paragraph of paragraphs) {
    const paragraphSentences = sentences.filter(
      (sentence) => sentence.paragraph === paragraph.index
    );

    const paragraphWords = paragraphSentences.reduce(
      (total, sentence) => total + sentence.wordCount,
      0
    );

    if (!current) {
      current = startChunk(chunks.length, paragraph, paragraphSentences, paragraphWords);
      continue;
    }

    if (current.wordCount + paragraphWords > CHUNK_TARGET_WORDS) {
      chunks.push(current);
      current = startChunk(chunks.length, paragraph, paragraphSentences, paragraphWords);
      continue;
    }

    current.end = paragraph.end;
    current.paragraphIndexes.push(paragraph.index);
    current.sentenceIndexes.push(...paragraphSentences.map((s) => s.index));
    current.wordCount += paragraphWords;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}


function startChunk(index, paragraph, paragraphSentences, paragraphWords) {
  return {
    index,
    start: paragraph.start,
    end: paragraph.end,
    paragraphIndexes: [paragraph.index],
    sentenceIndexes: paragraphSentences.map((s) => s.index),
    wordCount: paragraphWords
  };
}


// =============================================
// The plan
//
// This is the actual routing decision the rest
// of the orchestration obeys.
// =============================================

function buildPlan({ tier, metrics, chunks, claimIndex }) {
  const agents = [];

  const explain = (id, name, run, reason) => {
    agents.push({ id, name, run, reason });
  };

  const tooThin = tier.id === "insufficient";

  explain(
    "claim",
    "Claim Audit",
    claimIndex.present,
    claimIndex.present
      ? `Running over ${claimIndex.lineItems.length} billed line(s).`
      : "Skipped — no claim record was supplied with the appeal."
  );

  explain(
    "language",
    "Language Audit",
    !tooThin,
    tooThin
      ? "Skipped — fewer than 40 words is not enough context to judge tone or specificity."
      : `Running over ${metrics.sentenceCount} sentence(s) in ${chunks.length} chunk(s).`
  );

  explain(
    "figures",
    "Figure & Date Audit",
    metrics.numericMentions > 0 || metrics.dateMentions > 0,
    metrics.numericMentions === 0 && metrics.dateMentions === 0
      ? "Skipped — the appeal contains no figures or dates to verify."
      : `Running over ${metrics.numericMentions} figure(s) and ${metrics.dateMentions} date(s) — arithmetic is checked at any length.`
  );

  explain(
    "crosscheck",
    "Claim Cross-Check",
    claimIndex.present && (metrics.numericMentions > 0 || metrics.dateMentions > 0 || !tooThin),
    claimIndex.present
      ? "Running — the appeal can be checked against what was actually billed."
      : "Skipped — needs a claim record to check the appeal against."
  );

  explain(
    "evidence",
    "Evidence Completeness",
    true,
    claimIndex.present
      ? "Always runs — the checklist is satisfied from the claim record and the appeal together."
      : "Always runs — completeness is length independent."
  );

  return {
    tier: tier.id,
    depth: tier.depth,
    chunkCount: chunks.length,
    agents,
    active: agents.filter((agent) => agent.run).map((agent) => agent.id),
    skipped: agents.filter((agent) => !agent.run).map((agent) => agent.id),
    aiFloor: !tooThin && metrics.wordCount >= 40
  };
}


function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
