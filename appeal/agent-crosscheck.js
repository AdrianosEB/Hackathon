// =============================================
// CROSS-CHECK — appeal text against the claim
//
// The only stage that can see both sources, and
// the reason the two halves are worth combining:
// an appeal can argue confidently for money the
// claim never billed, and neither half alone can
// tell.
// =============================================

import { makeFinding, money } from "./finding.js";
import { codesCitedInText } from "./claim-index.js";
import { formatDate } from "./text-utils.js";


const TOLERANCE = 0.01;


export function runCrossCheckAgent(context) {
  const { text, sentences, numbers, dates, claimIndex } = context;

  if (!claimIndex || !claimIndex.present) {
    return {
      agent: "crosscheck",
      findings: [],
      skipped: "No claim record was supplied — nothing to check the appeal against."
    };
  }

  const findings = [
    ...amountsNotOnClaim(numbers, sentences, claimIndex),
    ...statedTotalVersusClaim(text, sentences, numbers, claimIndex),
    ...codesNotOnClaim(text, sentences, claimIndex),
    ...unaddressedLines(text, sentences, claimIndex),
    ...datesNotOnClaim(dates, sentences, claimIndex),
    ...unitsDisagree(numbers, sentences, claimIndex)
  ];

  return { agent: "crosscheck", findings };
}


// =============================================
// Money in the prose that matches no billed line
// =============================================

function amountsNotOnClaim(numbers, sentences, claim) {
  const findings = [];

  const known = [...claim.amounts, claim.totalBilled];

  for (const number of numbers) {
    if (number.kind !== "currency") {
      continue;
    }

    const matches = known.some(
      (value) => Math.abs(value - number.value) <= TOLERANCE
    );

    if (matches) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "crosscheck",
        category: "amount_not_on_claim",
        severity: "high",
        quote: number.raw,
        start: number.start,
        end: number.end,
        sentences,
        message: `${number.raw} does not match any billed line on the claim, or the claim total of ${money(
          claim.totalBilled
        )}.`,
        evidence: `Claim lines: ${claim.lineItems
          .map((item) => `${item.code} ${money(Number(item.amount || 0))}`)
          .join(", ")}.`,
        ask: `Where does ${number.raw} come from? It is not a billed amount on this claim — please identify the charge or correct the figure.`
      })
    );
  }

  return findings;
}


// =============================================
// A total asserted in the appeal versus the
// total the claim actually adds up to
// =============================================

function statedTotalVersusClaim(text, sentences, numbers, claim) {
  const totalSentences = sentences.filter((sentence) =>
    /\b(total(?:ing|s|led)?|in total|amounts? to|sum|outstanding|balance)\b/i.test(
      sentence.text
    )
  );

  const findings = [];

  for (const sentence of totalSentences) {
    const stated = numbers.filter(
      (number) =>
        number.kind === "currency" && number.sentenceIndex === sentence.index
    );

    for (const number of stated) {
      if (Math.abs(number.value - claim.totalBilled) <= TOLERANCE) {
        continue;
      }

      const isALine = claim.amounts.some(
        (value) => Math.abs(value - number.value) <= TOLERANCE
      );

      if (isALine) {
        continue;
      }

      findings.push(
        makeFinding({
          agent: "crosscheck",
          category: "total_disagrees_with_claim",
          severity: "high",
          quote: number.raw,
          start: number.start,
          end: number.end,
          sentences,
          message: `The appeal states a total of ${number.raw}, but the claim lines total ${money(
            claim.totalBilled
          )}.`,
          evidence: sentence.text,
          ask: `Please reconcile the ${number.raw} figure against the ${money(
            claim.totalBilled
          )} billed on claim ${claim.claimNumber || "record"}.`
        })
      );
    }
  }

  return findings;
}


// =============================================
// Procedure codes argued for that were never
// billed
// =============================================

function codesNotOnClaim(text, sentences, claim) {
  const cited = codesCitedInText(text);
  const findings = [];

  for (const code of cited.procedure) {
    if (claim.codes.has(code)) {
      continue;
    }

    const index = text.indexOf(code);

    findings.push(
      makeFinding({
        agent: "crosscheck",
        category: "code_not_on_claim",
        severity: "high",
        quote: code,
        start: index === -1 ? null : index,
        end: index === -1 ? null : index + code.length,
        sentences,
        message: `The appeal argues about procedure ${code}, which is not billed on this claim.`,
        evidence: `Claim bills: ${[...claim.codes].join(", ") || "no procedure codes"}.`,
        ask: `Is ${code} on a different claim, or was it omitted from this one in error?`
      })
    );
  }

  for (const code of cited.diagnosis) {
    if (claim.diagnosisCodes.has(code)) {
      continue;
    }

    const index = text.indexOf(code);

    findings.push(
      makeFinding({
        agent: "crosscheck",
        category: "code_not_on_claim",
        severity: "medium",
        quote: code,
        start: index === -1 ? null : index,
        end: index === -1 ? null : index + code.length,
        sentences,
        message: `The appeal cites diagnosis ${code}, which is not on the claim.`,
        evidence: `Claim diagnoses: ${
          [...claim.diagnosisCodes].join(", ") || "none supplied"
        }.`,
        ask: `Should diagnosis ${code} be added to the claim, or is the appeal citing the wrong code?`
      })
    );
  }

  return findings;
}


// =============================================
// Billed lines the appeal never argues for
// =============================================

function unaddressedLines(text, sentences, claim) {
  const cited = codesCitedInText(text);

  if (cited.procedure.size === 0) {
    return [];
  }

  const unaddressed = [...claim.codes].filter((code) => !cited.procedure.has(code));

  if (unaddressed.length === 0) {
    return [];
  }

  const amount = claim.lineItems
    .filter((item) => unaddressed.includes(String(item.code).trim()))
    .reduce((total, item) => total + Number(item.amount || 0), 0);

  return [
    makeFinding({
      agent: "crosscheck",
      category: "line_unaddressed",
      severity: "medium",
      quote: unaddressed.join(", "),
      start: null,
      end: null,
      sentences,
      message: `The appeal argues for ${
        cited.procedure.size
      } procedure(s) but the claim bills ${unaddressed.length} more that the appeal never mentions (${unaddressed.join(
        ", "
      )}, ${money(amount)}).`,
      evidence: `Cited in the appeal: ${[...cited.procedure].join(", ")}. Billed on the claim: ${[
        ...claim.codes
      ].join(", ")}.`,
      ask: `Is ${money(amount)} of billed service also under appeal? If so, please state the grounds for ${unaddressed.join(
        ", "
      )}.`
    })
  ];
}


// =============================================
// Dates the appeal asserts that are not service
// dates on the claim
// =============================================

function datesNotOnClaim(dates, sentences, claim) {
  const findings = [];

  const serviceContext =
    /\b(date of service|service date|seen on|treated on|rendered on|visit on|admitted|procedure on|performed on)\b/i;

  for (const date of dates) {
    const sentence = sentences[date.sentenceIndex];

    if (!sentence || !serviceContext.test(sentence.text)) {
      continue;
    }

    const iso = formatDate(date.date);

    if (claim.serviceDates.has(iso)) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "crosscheck",
        category: "date_not_on_claim",
        severity: "high",
        quote: date.raw,
        start: date.start,
        end: date.end,
        sentences,
        message: `The appeal gives ${date.raw} as a service date, but the claim's service dates are ${[
          ...claim.serviceDates
        ].join(", ")}.`,
        evidence: sentence.text,
        ask: `Please confirm the correct date of service — ${date.raw} does not appear on this claim.`
      })
    );
  }

  return findings;
}


// =============================================
// Session or visit counts against billed units
// =============================================

function unitsDisagree(numbers, sentences, claim) {
  const findings = [];

  const unitWords =
    /\b(session|sessions|visit|visits|treatment|treatments|infusion|infusions|unit|units)\b/i;

  const totalUnits = [...claim.unitsByCode.values()].reduce(
    (total, value) => total + value,
    0
  );

  if (totalUnits === 0) {
    return findings;
  }

  for (const number of numbers) {
    if (number.kind !== "count" || number.value < 1 || number.value > 400) {
      continue;
    }

    const unitMatch = number.after.match(unitWords);

    if (!unitMatch) {
      continue;
    }

    if (number.value === totalUnits) {
      continue;
    }

    const matchesOneCode = [...claim.unitsByCode.values()].includes(number.value);

    if (matchesOneCode) {
      continue;
    }

    findings.push(
      makeFinding({
        agent: "crosscheck",
        category: "units_disagree",
        severity: "medium",
        quote: `${number.raw} ${unitMatch[1].toLowerCase()}`,
        start: number.start,
        end: number.end,
        sentences,
        message: `The appeal describes ${number.raw} ${unitMatch[1].toLowerCase()}, but the claim bills ${totalUnits} unit(s) in total.`,
        evidence: `Billed units: ${[...claim.unitsByCode]
          .map(([code, units]) => `${code} × ${units}`)
          .join(", ")}.`,
        ask: `How many were actually delivered? The appeal says ${number.raw}; the claim bills ${totalUnits}.`
      })
    );
  }

  return findings;
}
