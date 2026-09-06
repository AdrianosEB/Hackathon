// =============================================
// AGENT 2 — Numeric Claim Verification
//
// Checks every figure in the appeal for internal
// consistency, plausibility, sourcing, and
// precision that the surrounding language does
// not support.
// =============================================

import { makeFinding, money } from "./finding.js";
import { formatDate } from "./text-utils.js";


const TOTAL_KEYWORDS =
  /\b(total(?:ing|ling|s|led)?|sum|altogether|in total|amounts? to|comes to|aggregate|combined|grand total)\b/i;

const SHARE_CONTEXT =
  /\bof (?:the |all |our |these )?(?:patients?|claims?|cases?|visits?|members?|procedures?|charges?|billed|amount|total|submissions?|appeals?)\b/i;

const RESEARCH_CONTEXT =
  /\b(stud(?:y|ies)|research|literature|evidence base|clinical trial|trials?|survey|meta-?analysis|guidelines?|journal|published|peer-?reviewed|data show|statistics)\b/i;

const CITATION_HINT =
  /\((?:[^)]*\b(?:19|20)\d{2}\b[^)]*)\)|\bet al\.|\bdoi\b|https?:\/\/|\b(?:NCCN|NICE|AMA|CMS|ACOG|ASCO|AHA|ADA)\b|\bjournal of\b/i;

const CHANGE_CONTEXT =
  /\b(increase[sd]?|increasing|decrease[sd]?|decreasing|reduc(?:e|ed|es|tion)|improv(?:e|ed|es|ement)|rose|fell|drop(?:ped)?|higher|lower|more effective|less effective|better|worse|growth|savings?)\b/i;

const HEDGE_BEFORE =
  /\b(approximately|approx\.?|about|roughly|around|nearly|almost|an estimated|estimated|circa|somewhere|upwards of|in the region of|~)\s*$/i;


export function runNumbersAgent(context) {
  const { text, sentences, numbers, dates, durations } = context;

  const findings = [
    ...checkSentenceTotals(text, sentences, numbers),
    ...checkDocumentTotal(text, sentences, numbers),
    ...checkPartOfWhole(text, sentences),
    ...checkImpossibleShares(numbers, sentences),
    ...checkImplausibleMagnitude(numbers, sentences),
    ...checkFalsePrecision(numbers, sentences),
    ...checkUnsourcedStatistics(numbers, sentences),
    ...checkMissingBaseline(numbers, sentences),
    ...checkWordDigitMismatch(text, sentences),
    ...checkDateSanity(dates, sentences),
    ...checkDurationAgainstDates(dates, durations, sentences),
    ...checkRoundNumberCluster(numbers, sentences)
  ];

  return {
    agent: "numbers",
    findings: dedupe(findings)
  };
}


// =============================================
// 1. A sentence that states a total, plus the
//    components that should add up to it.
// =============================================

function checkSentenceTotals(text, sentences, numbers) {
  const findings = [];

  for (const sentence of sentences) {
    if (!TOTAL_KEYWORDS.test(sentence.text)) {
      continue;
    }

    const amounts = numbers.filter(
      (number) =>
        number.kind === "currency" && number.sentenceIndex === sentence.index
    );

    if (amounts.length < 3) {
      continue;
    }

    const sorted = [...amounts].sort((a, b) => b.value - a.value);
    const stated = sorted[0];
    const components = sorted.slice(1);
    const componentSum = components.reduce((total, n) => total + n.value, 0);

    const gap = Math.abs(componentSum - stated.value);
    const tolerance = Math.max(1, stated.value * 0.01);

    if (gap > tolerance) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "arithmetic_mismatch",
          severity: "high",
          quote: stated.raw,
          start: stated.start,
          end: stated.end,
          sentences,
          message: `The stated total ${money(stated.value)} does not match the ${
            components.length
          } figures listed with it, which sum to ${money(componentSum)}.`,
          evidence: `${components
            .map((c) => c.raw)
            .join(" + ")} = ${money(componentSum)}, a ${money(gap)} difference from ${stated.raw}.`,
          ask: `Which figure is correct — the stated total of ${stated.raw} or the itemised amounts summing to ${money(
            componentSum
          )}? Please provide the itemised bill.`
        })
      );
    }
  }

  return findings;
}


// =============================================
// 2. A total stated on its own, against every
//    other monetary figure in the appeal.
// =============================================

function checkDocumentTotal(text, sentences, numbers) {
  const currency = numbers.filter((number) => number.kind === "currency");

  if (currency.length < 3) {
    return [];
  }

  const totalSentences = sentences.filter((sentence) =>
    TOTAL_KEYWORDS.test(sentence.text)
  );

  if (totalSentences.length !== 1) {
    return [];
  }

  const totalSentence = totalSentences[0];

  const inSentence = currency.filter(
    (number) => number.sentenceIndex === totalSentence.index
  );

  if (inSentence.length !== 1) {
    return [];
  }

  const stated = inSentence[0];
  const others = currency.filter((number) => number !== stated);
  const sum = others.reduce((total, n) => total + n.value, 0);

  const gap = Math.abs(sum - stated.value);
  const tolerance = Math.max(1, stated.value * 0.02);

  if (gap <= tolerance) {
    return [];
  }

  return [
    makeFinding({
      agent: "numbers",
      category: "arithmetic_mismatch",
      severity: "medium",
      quote: stated.raw,
      start: stated.start,
      end: stated.end,
      sentences,
      message: `The appeal states a total of ${money(
        stated.value
      )}, but the other monetary figures in the text sum to ${money(sum)}.`,
      evidence: `Figures found elsewhere: ${others
        .map((o) => o.raw)
        .join(", ")} (sum ${money(sum)}); difference ${money(gap)}.`,
      ask: `Please reconcile the ${stated.raw} total against the individual amounts, or confirm which charges are excluded from the total.`
    })
  ];
}


// =============================================
// 3. "N of M (P%)" style claims
// =============================================

function checkPartOfWhole(text, sentences) {
  const findings = [];

  const pattern =
    /(\d[\d,]*)\s*(?:of|out of|\/)\s*(\d[\d,]*)[^.\n]{0,40}?(\d[\d,]*(?:\.\d+)?)\s?%/gi;

  let match;

  while ((match = pattern.exec(text)) !== null) {
    const part = Number(match[1].replace(/,/g, ""));
    const whole = Number(match[2].replace(/,/g, ""));
    const claimed = Number(match[3].replace(/,/g, ""));

    if (!whole) {
      continue;
    }

    const actual = (part / whole) * 100;
    const gap = Math.abs(actual - claimed);

    if (gap > Math.max(1, claimed * 0.05)) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "percentage_mismatch",
          severity: "high",
          quote: match[0].trim(),
          start: match.index,
          end: match.index + match[0].length,
          sentences,
          message: `${part} of ${whole} is ${actual.toFixed(
            1
          )}%, not the stated ${claimed}%.`,
          evidence: `"${match[0].trim()}" — recomputed as ${part} ÷ ${whole} = ${actual.toFixed(
            1
          )}%.`,
          ask: `Is the count (${part} of ${whole}) or the percentage (${claimed}%) the correct figure? Please supply the underlying tally.`
        })
      );
    }

    if (part > whole) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "impossible_figure",
          severity: "high",
          quote: match[0].trim(),
          start: match.index,
          end: match.index + match[0].length,
          sentences,
          message: `The appeal reports ${part} out of ${whole}, which exceeds the stated population.`,
          evidence: `"${match[0].trim()}".`,
          ask: `Please correct the counts — ${part} cannot be a subset of ${whole}.`
        })
      );
    }
  }

  return findings;
}


// =============================================
// 4. Shares above 100%
// =============================================

function checkImpossibleShares(numbers, sentences) {
  const findings = [];

  for (const number of numbers) {
    if (number.kind !== "percent" || number.value <= 100) {
      continue;
    }

    // Only the words immediately after the figure
    // decide whether it is a share. "improved by 340%"
    // in a sentence that also says "92% of patients"
    // must not inherit that context.
    if (!SHARE_CONTEXT.test(number.after)) {
      continue;
    }

    const sentence = sentences[number.sentenceIndex];

    findings.push(
      makeFinding({
        agent: "numbers",
        category: "impossible_figure",
        severity: "high",
        quote: number.raw,
        start: number.start,
        end: number.end,
        sentences,
        message: `${number.raw} is stated as a share of a population, which cannot exceed 100%.`,
        evidence: sentence ? sentence.text : number.raw,
        ask: `Should ${number.raw} be a share, an increase relative to a baseline, or a count? Please clarify with the source data.`
      })
    );
  }

  return findings;
}


// =============================================
// 5. Magnitudes that need a source to be credible
// =============================================

function checkImplausibleMagnitude(numbers, sentences) {
  const findings = [];

  for (const number of numbers) {
    const sentence = sentences[number.sentenceIndex];
    const sentenceText = sentence ? sentence.text : "";

    if (number.kind === "multiplier" && number.value >= 10) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "implausible_magnitude",
          severity: "medium",
          quote: number.raw,
          start: number.start,
          end: number.end,
          sentences,
          message: `A ${number.raw} effect is a very large claim to make without a cited source.`,
          evidence: sentenceText || number.raw,
          ask: `What measurement or publication produces the ${number.raw} figure?`
        })
      );
    }

    if (
      number.kind === "percent" &&
      number.value >= 300 &&
      CHANGE_CONTEXT.test(sentenceText)
    ) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "implausible_magnitude",
          severity: "medium",
          quote: number.raw,
          start: number.start,
          end: number.end,
          sentences,
          message: `A ${number.raw} change is an outlier magnitude that needs a stated baseline and source.`,
          evidence: sentenceText || number.raw,
          ask: `What are the before and after values behind the ${number.raw} change?`
        })
      );
    }

    if (
      number.kind === "percent" &&
      (number.value === 100 || number.value === 0) &&
      /\b(effective|successful|success|cure|resolve[sd]?|failure|ineffective|of patients|of cases)\b/i.test(
        sentenceText
      )
    ) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "implausible_magnitude",
          severity: "medium",
          quote: number.raw,
          start: number.start,
          end: number.end,
          sentences,
          message: `A ${number.raw} outcome rate is an absolute claim that clinical data rarely supports.`,
          evidence: sentenceText || number.raw,
          ask: `What sample size and source produce the ${number.raw} rate?`
        })
      );
    }
  }

  return findings;
}


// =============================================
// 6. Hedged language paired with exact figures
// =============================================

function checkFalsePrecision(numbers, sentences) {
  const findings = [];

  for (const number of numbers) {
    const hedged = HEDGE_BEFORE.test(number.before);

    if (hedged && number.decimals >= 1 && number.kind !== "currency") {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "false_precision",
          severity: "low",
          quote: `${number.before.trim().split(/\s+/).pop()} ${number.raw}`.trim(),
          start: number.start,
          end: number.end,
          sentences,
          message: `${number.raw} is presented as an estimate yet carries decimal precision.`,
          evidence: sentences[number.sentenceIndex]?.text || number.raw,
          ask: `Is ${number.raw} a measured value or an estimate? If measured, please supply the source record.`
        })
      );
    }

    if (!hedged && number.kind === "percent" && number.decimals >= 2) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "false_precision",
          severity: "low",
          quote: number.raw,
          start: number.start,
          end: number.end,
          sentences,
          message: `${number.raw} is quoted to two decimal places, which implies a dataset that is not identified.`,
          evidence: sentences[number.sentenceIndex]?.text || number.raw,
          ask: `Which dataset or report produces ${number.raw}?`
        })
      );
    }
  }

  return findings;
}


// =============================================
// 7. Statistics attributed to research, uncited
// =============================================

function checkUnsourcedStatistics(numbers, sentences) {
  const findings = [];

  for (const sentence of sentences) {
    if (!RESEARCH_CONTEXT.test(sentence.text)) {
      continue;
    }

    if (CITATION_HINT.test(sentence.text)) {
      continue;
    }

    const statistic = numbers.find(
      (number) =>
        number.sentenceIndex === sentence.index &&
        (number.kind === "percent" || number.kind === "multiplier")
    );

    if (!statistic) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "numbers",
        category: "unsourced_statistic",
        severity: "medium",
        quote: statistic.raw,
        start: statistic.start,
        end: statistic.end,
        sentences,
        message: `${statistic.raw} is attributed to research or published data, but no source is identified.`,
        evidence: sentence.text,
        ask: `Please provide the citation (author, publication, year) for the ${statistic.raw} figure.`
      })
    );
  }

  return findings;
}


// =============================================
// 8. Relative change with no baseline
// =============================================

function checkMissingBaseline(numbers, sentences) {
  const findings = [];

  for (const sentence of sentences) {
    if (!CHANGE_CONTEXT.test(sentence.text)) {
      continue;
    }

    const relative = numbers.filter(
      (number) =>
        number.sentenceIndex === sentence.index &&
        (number.kind === "percent" || number.kind === "multiplier") &&
        !SHARE_CONTEXT.test(number.after)
    );

    if (relative.length === 0) {
      continue;
    }

    const hasBaseline =
      numbers.some(
        (number) =>
          number.sentenceIndex === sentence.index &&
          (number.kind === "currency" || number.kind === "count")
      ) || /\bfrom\b[^.]*\bto\b/i.test(sentence.text);

    if (hasBaseline) {
      continue;
    }

    const first = relative[0];

    findings.push(
      makeFinding({
        agent: "numbers",
        category: "missing_baseline",
        severity: "medium",
        quote: first.raw,
        start: first.start,
        end: first.end,
        sentences,
        message: `${first.raw} describes a change without stating what it is measured against.`,
        evidence: sentence.text,
        ask: `What are the starting and ending values behind the ${first.raw} change?`
      })
    );
  }

  return findings;
}


// =============================================
// 9. Spelled-out number contradicting the digit
// =============================================

const WORD_VALUES = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};


function checkWordDigitMismatch(text, sentences) {
  const findings = [];
  const pattern =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*\(\s*(\d+)\s*\)/gi;

  let match;

  while ((match = pattern.exec(text)) !== null) {
    const spelled = WORD_VALUES[match[1].toLowerCase()];
    const digits = Number(match[2]);

    if (spelled !== digits) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "internal_contradiction",
          severity: "high",
          quote: match[0],
          start: match.index,
          end: match.index + match[0].length,
          sentences,
          message: `"${match[0]}" contradicts itself — the written word says ${spelled}, the digit says ${digits}.`,
          evidence: `"${match[0]}".`,
          ask: `Please confirm whether the correct quantity is ${spelled} or ${digits}.`
        })
      );
    }
  }

  return findings;
}


// =============================================
// 10. Date sanity
// =============================================

function checkDateSanity(dates, sentences) {
  const findings = [];
  const today = new Date();

  for (const date of dates) {
    if (date.date.getTime() > today.getTime()) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "date_problem",
          severity: "medium",
          quote: date.raw,
          start: date.start,
          end: date.end,
          sentences,
          message: `The date ${date.raw} is in the future (${formatDate(date.date)}).`,
          evidence: sentences[date.sentenceIndex]?.text || date.raw,
          ask: `Please confirm the correct date — ${date.raw} has not occurred yet.`
        })
      );
    }
  }

  return findings;
}


// =============================================
// 11. Stated duration versus stated date range
// =============================================

const LIMIT_CONTEXT =
  /\b(within|allow(?:s|ed|ance)?|deadline|limit|window|no later than|up to|maximum|at least|requires?|timely filing|grace period|per year|per month|annually)\b/i;


function checkDurationAgainstDates(dates, durations, sentences) {
  const findings = [];

  for (const duration of durations) {
    const sentence = sentences[duration.sentenceIndex];

    // "within 180 days allowed for filing" states a
    // limit, not the length of the date range beside it.
    if (sentence && LIMIT_CONTEXT.test(sentence.text)) {
      continue;
    }

    const sameSentence = dates.filter(
      (date) => date.sentenceIndex === duration.sentenceIndex
    );

    if (sameSentence.length < 2) {
      continue;
    }

    const sorted = [...sameSentence].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const spanDays = (last.date - first.date) / 86_400_000;

    if (spanDays <= 0) {
      continue;
    }

    const ratio = duration.days / spanDays;

    if (ratio > 1.3 || ratio < 0.7) {
      findings.push(
        makeFinding({
          agent: "numbers",
          category: "internal_contradiction",
          severity: "high",
          quote: duration.raw,
          start: duration.start,
          end: duration.end,
          sentences,
          message: `The stated duration of ${duration.raw} does not match the dates given in the same sentence (${
            first.raw
          } to ${last.raw} is about ${Math.round(spanDays)} days).`,
          evidence: sentences[duration.sentenceIndex]?.text || duration.raw,
          ask: `Please confirm the treatment period — the ${duration.raw} figure and the ${first.raw}–${last.raw} range disagree.`
        })
      );
    }
  }

  const reversed = [];

  for (const sentence of sentences) {
    const inSentence = dates.filter(
      (date) => date.sentenceIndex === sentence.index
    );

    if (inSentence.length < 2) {
      continue;
    }

    if (!/\bfrom\b[^.]*\b(?:to|through|until|thru|-)\b/i.test(sentence.text)) {
      continue;
    }

    const [first, second] = inSentence;

    if (second.date.getTime() < first.date.getTime()) {
      reversed.push(
        makeFinding({
          agent: "numbers",
          category: "date_problem",
          severity: "high",
          quote: `${first.raw} to ${second.raw}`,
          start: first.start,
          end: second.end,
          sentences,
          message: `The date range runs backwards — ${second.raw} precedes ${first.raw}.`,
          evidence: sentence.text,
          ask: `Please correct the service date range (${first.raw} to ${second.raw}).`
        })
      );
    }
  }

  return [...findings, ...reversed];
}


// =============================================
// 12. Every figure is a round number
// =============================================

function checkRoundNumberCluster(numbers, sentences) {
  const quantitative = numbers.filter(
    (number) => number.kind !== "count" || number.value >= 10
  );

  if (quantitative.length < 4) {
    return [];
  }

  const round = quantitative.filter(
    (number) => number.value % 10 === 0 && number.value !== 0
  );

  if (round.length !== quantitative.length) {
    return [];
  }

  const first = quantitative[0];

  return [
    makeFinding({
      agent: "numbers",
      category: "rounded_estimates",
      severity: "low",
      quote: quantitative.map((n) => n.raw).slice(0, 6).join(", "),
      start: first.start,
      end: first.end,
      sentences,
      message: `All ${quantitative.length} quantities in the appeal are round numbers, which suggests estimates rather than figures taken from records.`,
      evidence: `Figures: ${quantitative.map((n) => n.raw).join(", ")}.`,
      ask: "Please supply the exact figures from the billing system rather than rounded estimates."
    })
  ];
}


function dedupe(findings) {
  const seen = new Set();

  return findings.filter((finding) => {
    const key = `${finding.category}|${finding.start}|${finding.end}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
