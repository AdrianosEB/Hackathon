// --------------------------------------------------
// ORCHESTRATOR
//
// Fans out to every enabled specialist in parallel,
// collects their findings, and composes a provider
// data confidence score.
//
// TWO DELIBERATE ARCHITECTURE CHOICES:
//
// 1. Dispatch is done in JavaScript, not by a
//    "manager" agent that delegates. A manager adds a
//    round trip and a failure mode — it can decide on
//    its own not to consult a specialist, and you
//    find out during the demo. Promise.all cannot
//    forget. The specialists are still full agents;
//    only the fan-out is deterministic.
//
// 2. The SCORE is arithmetic, not a model output.
//    Agents produce findings and confidences — the
//    judgement calls. Turning those into a number is
//    a policy decision, and policy belongs in code
//    you can read, test, and argue with. A model
//    asked to "give a score out of 100" produces a
//    number nobody can reproduce or defend.
// --------------------------------------------------

import { query } from "@anthropic-ai/claude-agent-sdk";

import { verificationTools, companyTools } from "./tools.js";
import { ALL_AGENTS } from "./agents.js";
import { SOURCES, enabledSources, coverageReport, BLOCKING_DIMENSIONS } from "./registry.js";

// NOTE: the open-web research agent has been removed
// from this pipeline, and verification/research.js is
// now deleted — every remaining source is federal
// public-domain data or our own, and nothing reads a
// page authored by the party being assessed.


// A specialist that hasn't answered in this long is
// not going to. Record it as "not_checked" and move on —
// a claim submission must never hang on a registry.
const AGENT_TIMEOUT_MS = 45_000;


// --------------------------------------------------
// Pull the JSON finding out of an agent's transcript
// --------------------------------------------------

function extractFinding(text, dimension) {

  if (!text) {
    return null;
  }

  // Prefer a fenced block, fall back to the last
  // balanced-looking object in the message.
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);

  const candidate =
    fenced?.[1] ||
    text.slice(
      text.indexOf("{"),
      text.lastIndexOf("}") + 1
    );

  try {

    const parsed = JSON.parse(candidate);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      dimension: parsed.dimension || dimension,
      result: ["match", "partial", "mismatch", "not_checked"].includes(parsed.result)
        ? parsed.result
        : "not_checked",
      confidence: Number.isFinite(Number(parsed.confidence))
        ? Math.max(0, Math.min(1, Number(parsed.confidence)))
        : 0.5,
      summary: String(parsed.summary || "").trim(),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      limitations: String(parsed.limitations || "").trim()
    };

  } catch {

    return null;

  }

}


// --------------------------------------------------
// Run one specialist
// --------------------------------------------------

async function runSpecialist(source, claim, options = {}) {

  // The MCP server and the brief are injectable so the
  // same runner drives a different registry. Everything
  // that matters — tool confinement, the timeout, the
  // JSON contract, adjudication — is shared, which is
  // the point: swapping the data source must not mean
  // re-implementing the safety properties.
  const {
    mcpServers = { "provider-verification": verificationTools },
    buildBrief = null
  } = options;

  const definition = ALL_AGENTS[source.agent];

  if (!definition) {

    return {
      dimension: source.id,
      result: "not_checked",
      confidence: 0,
      summary: `No agent is registered for "${source.agent}".`,
      evidence: [],
      limitations: "Configuration error."
    };

  }

  const brief = buildBrief ? buildBrief(source, claim) : [
    `Assess the "${source.id}" dimension for the billing provider on this claim.`,
    "",
    "CLAIM:",
    JSON.stringify(
      {
        claimNumber: claim.claimNumber,
        providerName: claim.providerName,
        npi: claim.npi || null,
        practiceAddressLine1: claim.practiceAddressLine1 || null,
        practiceCity: claim.practiceCity || null,
        practiceState: claim.practiceState || null,
        practicePhone: claim.practicePhone || null,
        practiceWebsite: claim.practiceWebsite || null,
        serviceDates: [
          ...new Set(
            (claim.lineItems || [])
              .map((item) => item.serviceDate)
              .filter(Boolean)
          )
        ],
        procedureCodes: (claim.lineItems || []).map((item) => item.code),
        diagnosisCodes: claim.diagnosisCodes || []
      },
      null,
      2
    ),
    "",
    "Follow your procedure and reply with your JSON finding object and nothing else."
  ].join("\n");

  const timeout = new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          dimension: source.id,
          result: "not_checked",
          confidence: 0,
          summary: `The ${source.label.toLowerCase()} check timed out.`,
          evidence: [],
          limitations: `No response within ${AGENT_TIMEOUT_MS / 1000}s. This is an outage, not a finding about the provider.`
        }),
      AGENT_TIMEOUT_MS
    )
  );

  const work = (async () => {

    let finalText = "";

    try {

      const run = query({

        prompt: brief,

        options: {

          // The specialist's own prompt IS the system
          // prompt. Passing a plain string replaces the
          // default preset entirely, which is what we
          // want — this agent has one job.
          systemPrompt: definition.prompt,

          model: definition.model,

          maxTurns: definition.maxTurns,

          mcpServers,

          // ---- TOOL CONFINEMENT ----
          //
          // Three layers, because the first one is easy
          // to get wrong and I did get it wrong.
          //
          // 1. `tools: []` disables every BUILT-IN tool.
          //    This is the one that actually restricts
          //    availability. MCP tools arrive via
          //    mcpServers and are unaffected, so the
          //    agent ends up with exactly the four
          //    NPPES lookups and nothing else — no
          //    Bash, no file access, no web, and
          //    nothing the SDK adds in a later version.
          //
          //    `allowedTools` does NOT do this. It only
          //    auto-approves tools that are already
          //    available. Setting it alone, with
          //    bypassPermissions on, leaves every
          //    built-in reachable.
          tools: [],

          // 2. Auto-approve our four, so a server with
          //    no human at the keyboard never blocks on
          //    a permission prompt.
          allowedTools: definition.tools,

          // 3. Explicit denial as well. Redundant given
          //    layer 1, and kept precisely because
          //    layer 1 is one typo away from silently
          //    not applying.
          disallowedTools: [
            "Bash", "Write", "Edit", "Read", "NotebookEdit",
            "WebFetch", "WebSearch", "Glob", "Grep", "Task",
            "TodoWrite", "BashOutput", "KillShell"
          ],

          // 4. Deny-by-default gate. Runs before every
          //    tool execution regardless of the above,
          //    so if a future SDK version changes how
          //    any of those options behave, this still
          //    holds the line.
          canUseTool: async (toolName) => {

            if (definition.tools.includes(toolName)) {
              return { behavior: "allow", updatedInput: undefined };
            }

            return {
              behavior: "deny",
              message:
                `"${toolName}" is not available to a verification agent. ` +
                `These agents may only call the NPPES registry lookups.`
            };

          },

          // Do not inherit the developer's CLAUDE.md,
          // settings, or project skills into a
          // production request path.
          settingSources: [],

          // Safe because allowedTools is an explicit
          // allowlist of read-only registry lookups.
          permissionMode: "bypassPermissions"

        }

      });

      for await (const message of run) {

        if (message.type === "result") {

          finalText =
            typeof message.result === "string"
              ? message.result
              : finalText;

        } else if (
          message.type === "assistant" &&
          Array.isArray(message.message?.content)
        ) {

          const text = message.message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");

          if (text.trim()) {
            finalText = text;
          }

        }

      }

    } catch (error) {

      return {
        dimension: source.id,
        result: "not_checked",
        confidence: 0,
        summary: `The ${source.label.toLowerCase()} check could not run.`,
        evidence: [],
        limitations: `Agent error: ${error.message}`
      };

    }

    return (
      extractFinding(finalText, source.id) || {
        dimension: source.id,
        result: "not_checked",
        confidence: 0,
        summary: `The ${source.label.toLowerCase()} check returned an unreadable result.`,
        evidence: [],
        limitations: "Agent did not produce parseable JSON."
      }
    );

  })();

  return Promise.race([work, timeout]);

}


// --------------------------------------------------
// Adjudication
//
// Deterministic. Read it, disagree with it, change
// the constants — that is the point of keeping it out
// of a prompt.
// --------------------------------------------------

const RESULT_SCORES = {
  match: 90,
  partial: 55,
  mismatch: 10
  // "not_checked" is deliberately absent: an unanswered
  // question must not drag the score down. It reduces
  // coverage instead.
};


export function adjudicate(findings, coverage) {

  // ---- Step 1: blocking discrepancies ----
  //
  // Some findings are not worth "negative points."
  // A deactivated NPI or a confirmed federal exclusion
  // ends the assessment. Without this, six soft passes
  // quietly outvote one blocking discrepancy.

  const blocker = findings.find(
    (finding) =>
      BLOCKING_DIMENSIONS.has(finding.dimension) &&
      finding.result === "mismatch" &&
      finding.confidence >= 0.7
  );

  if (blocker) {

    return {
      dataConfidenceScore: 5,
      confidenceBand: "conflicting",
      blocking: true,
      blockingReason: blocker.summary,
      blockingDimension: blocker.dimension,
      coverage,
      checks: findings,
      rationale:
        `Assessment stopped early. ${blocker.summary} This is a blocking discrepancy, ` +
        `not one signal among several, so the remaining checks cannot offset it.`
    };

  }

  // ---- Step 2: weighted average over answered dimensions ----

  const answered = findings.filter(
    (finding) => finding.result !== "not_checked"
  );

  if (answered.length === 0) {

    return {
      dataConfidenceScore: null,
      confidenceBand: "incomplete",
      blocking: false,
      coverage,
      checks: findings,
      rationale:
        "No verification check completed successfully, so this provider is unverified. " +
        "That is a statement about our coverage, not about the provider."
    };

  }

  let weightedSum = 0;
  let weightTotal = 0;

  for (const finding of answered) {

    const source = SOURCES[finding.dimension];

    // A confident finding counts more than a hedged
    // one, but never to zero — floor at 0.3 so a
    // cautious agent still registers.
    const weight =
      (source?.weight ?? 0.5) *
      Math.max(0.3, finding.confidence);

    weightedSum += RESULT_SCORES[finding.result] * weight;
    weightTotal += weight;

  }

  const rawScore = Math.round(weightedSum / weightTotal);

  // ---- Step 3: cap the band by coverage ----
  //
  // The honest constraint. With only identity checked,
  // the most we can truthfully say is "the entity is
  // real" — not "this provider is verified." Claiming
  // a clean bill of health from one dimension is how
  // screening tools get trusted more than they deserve.

  let band;

  if (rawScore >= 80) {
    band = "confirmed";
  } else if (rawScore >= 60) {
    band = "probable";
  } else if (rawScore >= 35) {
    band = "incomplete";
  } else {
    band = "conflicting";
  }

  const BAND_ORDER = ["conflicting", "incomplete", "probable", "confirmed"];

  // Below ~60% coverage, "confirmed" is not available
  // at any score.
  if (coverage.completeness < 0.6 && band === "confirmed") {
    band = "probable";
  }

  const uncheckedNote =
    coverage.skipped.length > 0
      ? ` Not checked: ${coverage.skipped.map((s) => s.label.toLowerCase()).join(", ")}.`
      : "";

  return {

    dataConfidenceScore: rawScore,

    confidenceBand: band,

    blocking: false,

    coverage,

    checks: findings,

    bandCappedByCoverage:
      coverage.completeness < 0.6 &&
      BAND_ORDER.indexOf(band) < BAND_ORDER.indexOf("confirmed") &&
      rawScore >= 80,

    rationale:
      answered
        .map((finding) => finding.summary)
        .filter(Boolean)
        .join(" ") + uncheckedNote

  };

}


// --------------------------------------------------
// Public entry point
// --------------------------------------------------

export async function verifyProvider(claim) {

  const sources = enabledSources();

  const coverage = coverageReport();

  if (sources.length === 0) {

    return {
      dataConfidenceScore: null,
      confidenceBand: "incomplete",
      coverage,
      checks: [],
      rationale: "Provider verification is disabled."
    };

  }

  const startedAt = Date.now();

  // Every specialist runs at once. With identity alone
  // this is a single call; the shape is what matters,
  // because turning on the others must not make the
  // endpoint several times slower.
  const findings = await Promise.all(
    sources.map((source) => runSpecialist(source, claim))
  );

  const result = adjudicate(findings, coverage);

  return {
    ...result,
    npi: claim.npi || null,
    durationMs: Date.now() - startedAt,
    verifiedAt: new Date().toISOString()
  };

}


// ==================================================
// COMPANY VERIFICATION
//
// The same orchestration, a different registry.
//
// Nothing below re-implements the parts that carry the
// safety properties: runSpecialist() confines the tools
// and enforces the timeout, adjudicate() applies the
// blocking rule and the coverage cap, and the finding
// contract is identical. Only the data source and the
// brief change.
//
// Useful for exactly one reason: it demonstrates that
// the design is about how you reason over a registry,
// not about healthcare.
// ==================================================

const COMPANY_SOURCE = {
  id: "company",
  label: "Company identity",
  agent: "company-verifier",
  enabled: true,
  provenance: "US federal registry (SEC EDGAR), public domain",
  weight: 1.0,
  question:
    "Does this CIK exist, is the entity still filing, and does the registry record " +
    "correspond to the company named in the submission?"
};


function buildCompanyBrief(source, subject) {

  return [
    `Assess the "${source.id}" dimension for the organisation in this submission.`,
    "",
    "SUBMISSION:",
    JSON.stringify(
      {
        submissionRef: subject.submissionRef || null,
        companyName: subject.companyName || null,
        cik: subject.cik || null,
        stateOfIncorporation: subject.stateOfIncorporation || null,
        city: subject.city || null,
        state: subject.state || null,
        ticker: subject.ticker || null,
        website: subject.website || null
      },
      null,
      2
    ),
    "",
    "Follow your procedure and reply with your JSON finding object and nothing else."
  ].join("\n");

}


export async function verifyCompany(subject) {

  const startedAt = Date.now();

  // One dimension is live, so coverage is stated
  // honestly rather than implied: this checks that the
  // entity is registered, and nothing else about it.
  const coverage = {
    checked: ["company"],
    skipped: [
      {
        id: "sanctions",
        label: "Federal exclusions",
        reason: "Not wired for the company track."
      },
      {
        id: "filings",
        label: "Filing content",
        reason:
          "Reads the existence and recency of filings, never their contents. Reading the " +
          "filings themselves is a different question and a much larger one."
      }
    ],
    completeness: 0.5
  };

  const finding = await runSpecialist(COMPANY_SOURCE, subject, {
    mcpServers: { "company-verification": companyTools },
    buildBrief: buildCompanyBrief
  });

  // BLOCKING_DIMENSIONS is keyed by dimension id, and
  // "company" is not in it — so adjudicate() would treat
  // a mismatch as ordinary negative weight rather than
  // as disqualifying. Identity is disqualifying on the
  // provider side for a reason that applies just as
  // squarely here: if the identifier belongs to someone
  // else, there is no entity to assess. Adjudicate
  // against the identity id so the same rule fires.
  const asIdentity = { ...finding, dimension: "identity" };

  const result = adjudicate([asIdentity], coverage);

  return {
    ...result,
    checks: [finding],
    cik: subject.cik || null,
    companyName: subject.companyName || null,
    durationMs: Date.now() - startedAt,
    verifiedAt: new Date().toISOString()
  };

}
