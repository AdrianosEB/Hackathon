// =============================================
// Shared text primitives
//
// Every agent works on the SAME segmentation so
// findings can be merged by character offset.
// =============================================

const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "rev", "hon",
  "inc", "ltd", "co", "corp", "dept", "est",
  "vs", "etc", "al", "jr", "sr", "no", "nos",
  "approx", "est", "fig", "ref", "st", "ave",
  "e.g", "i.e", "cf", "viz",
  "md", "do", "rn", "np", "pa", "dds", "dpm",
  "cpt", "icd", "hcpcs", "drg", "npi", "eob"
]);


const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};


export function normalizeText(raw) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+$/gm, "");
}


// =============================================
// Paragraphs, with absolute offsets preserved
// =============================================

export function splitParagraphs(text) {
  const blankSeparated = text.split(/\n[ \t]*\n+/);

  const blocks =
    blankSeparated.filter((b) => b.trim()).length > 1
      ? blankSeparated
      : text.split(/\n+/);

  const paragraphs = [];
  let cursor = 0;

  for (const block of blocks) {
    const trimmed = block.trim();

    if (!trimmed) {
      cursor += block.length;
      continue;
    }

    const start = text.indexOf(trimmed, cursor);
    const safeStart = start === -1 ? cursor : start;

    paragraphs.push({
      index: paragraphs.length,
      text: trimmed,
      start: safeStart,
      end: safeStart + trimmed.length
    });

    cursor = safeStart + trimmed.length;
  }

  return paragraphs;
}


// =============================================
// Sentences, with absolute offsets preserved
// =============================================

function lastTokenBefore(text, position) {
  const slice = text.slice(Math.max(0, position - 24), position);
  const match = slice.match(/([A-Za-z.]+)$/);
  return match ? match[1].toLowerCase().replace(/\.$/, "") : "";
}


export function splitSentences(text, paragraphs) {
  const sentences = [];

  for (const paragraph of paragraphs) {
    const body = paragraph.text;
    const boundary = /([.!?]+)(["')\]]?)(\s+|$)/g;

    let sentenceStart = 0;
    let match;

    while ((match = boundary.exec(body)) !== null) {
      const endOfPunctuation = match.index + match[1].length + match[2].length;
      const token = lastTokenBefore(body, match.index);

      const isAbbreviation =
        match[1] === "." && ABBREVIATIONS.has(token);

      const isInitial =
        match[1] === "." && /^[A-Za-z]$/.test(token);

      if (isAbbreviation || isInitial) {
        continue;
      }

      const raw = body.slice(sentenceStart, endOfPunctuation);
      pushSentence(sentences, raw, paragraph, sentenceStart);
      sentenceStart = boundary.lastIndex;
    }

    if (sentenceStart < body.length) {
      const raw = body.slice(sentenceStart);
      pushSentence(sentences, raw, paragraph, sentenceStart);
    }
  }

  return sentences;
}


function pushSentence(sentences, raw, paragraph, relativeStart) {
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();

  if (!trimmed) {
    return;
  }

  const start = paragraph.start + relativeStart + leading;

  sentences.push({
    index: sentences.length,
    paragraph: paragraph.index,
    text: trimmed,
    start,
    end: start + trimmed.length,
    wordCount: countWords(trimmed)
  });
}


export function countWords(text) {
  const matches = String(text || "").match(/[A-Za-z0-9$%'’./-]+/g);
  return matches ? matches.length : 0;
}


export function sentenceAt(sentences, offset) {
  return (
    sentences.find(
      (sentence) => offset >= sentence.start && offset < sentence.end
    ) || null
  );
}


// =============================================
// Numeric mentions
// =============================================

const NUMERIC_PATTERN =
  /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|billion))?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|pct\b)|\b\d[\d,]*(?:\.\d+)?\s?(?:x\b|×|-?fold\b)|\b\d[\d,]*(?:\.\d+)?\b/gi;


export function extractNumbers(text, sentences, excludeRanges = []) {
  const mentions = [];
  const pattern = new RegExp(NUMERIC_PATTERN);
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;

    const insideExcluded = excludeRanges.some(
      (range) => start >= range.start && start < range.end
    );

    if (insideExcluded) {
      continue;
    }
    const after = text.slice(start + raw.length, start + raw.length + 28);
    const before = text.slice(Math.max(0, start - 30), start);

    const lower = raw.toLowerCase();
    const digits = Number(raw.replace(/[^0-9.]/g, ""));

    if (!Number.isFinite(digits)) {
      continue;
    }

    let kind = "count";
    let value = digits;

    if (lower.includes("$")) {
      kind = "currency";

      if (/\bk$/.test(lower.trim())) value = digits * 1_000;
      if (/\bm$|million/.test(lower)) value = digits * 1_000_000;
      if (/billion/.test(lower)) value = digits * 1_000_000_000;
    } else if (/%|percent|pct/.test(lower)) {
      kind = "percent";
    } else if (/x|×|fold/.test(lower)) {
      kind = "multiplier";
    }

    const decimals = (raw.split(".")[1] || "").replace(/[^0-9]/g, "").length;

    mentions.push({
      raw: raw.trim(),
      kind,
      value,
      decimals,
      start,
      end: start + raw.length,
      before,
      after,
      unit: (after.match(/^\s*([A-Za-z-]+)/) || [, ""])[1].toLowerCase(),
      sentenceIndex: sentenceAt(sentences, start)?.index ?? null
    });
  }

  return mentions;
}


// =============================================
// Dates and durations
// =============================================

const DATE_PATTERNS = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g,
  /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g,
  /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g
];


export function extractDates(text, sentences) {
  const found = [];

  DATE_PATTERNS.forEach((pattern, patternIndex) => {
    const scanner = new RegExp(pattern);
    let match;

    while ((match = scanner.exec(text)) !== null) {
      const date = interpretDate(match, patternIndex);

      if (!date) {
        continue;
      }

      found.push({
        raw: match[0],
        date,
        start: match.index,
        end: match.index + match[0].length,
        sentenceIndex: sentenceAt(sentences, match.index)?.index ?? null
      });
    }
  });

  return found.sort((a, b) => a.start - b.start);
}


function interpretDate(match, patternIndex) {
  let year;
  let month;
  let day;

  if (patternIndex === 0) {
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  } else if (patternIndex === 1) {
    month = Number(match[1]) - 1;
    day = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else if (patternIndex === 2) {
    month = MONTHS[match[1].toLowerCase()];
    day = Number(match[2]);
    year = Number(match[3]);
  } else {
    day = Number(match[1]);
    month = MONTHS[match[2].toLowerCase()];
    year = Number(match[3]);
  }

  if (month === undefined || Number.isNaN(month) || month < 0 || month > 11) {
    return null;
  }

  if (!day || day > 31 || !year || year < 1900 || year > 2200) {
    return null;
  }

  const date = new Date(Date.UTC(year, month, day));
  return Number.isNaN(date.getTime()) ? null : date;
}


const DURATION_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, several: null, few: null
};


const DURATION_DAYS = {
  day: 1,
  week: 7,
  month: 30.44,
  year: 365.25
};


export function extractDurations(text, sentences) {
  const pattern =
    /\b(\d[\d,]*(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+(day|week|month|year)s?\b/gi;

  const durations = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const token = match[1].toLowerCase();

    const amount = /^[0-9]/.test(token)
      ? Number(token.replace(/,/g, ""))
      : DURATION_WORDS[token];

    if (!amount) {
      continue;
    }

    const unit = match[2].toLowerCase();

    durations.push({
      raw: match[0],
      amount,
      unit,
      days: amount * DURATION_DAYS[unit],
      start: match.index,
      end: match.index + match[0].length,
      sentenceIndex: sentenceAt(sentences, match.index)?.index ?? null
    });
  }

  return durations;
}


export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
