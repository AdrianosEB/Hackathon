// =============================================
// ORCHESTRATOR
//
//   1  Intake          claim record + appeal text
//        |
//   2  PARALLEL
//        Claim Audit         the billed lines
//        Language Audit      per chunk
//        Figure & Date Audit whole text
//        Evidence            both sources
//        |
//   3  Claim Cross-Check     text vs record
//        |
//   4  AI Review             conditional
//        |
//   5  Report                score, verdict, asks
//
// Six stages. The AI stage never touches the
// score — it contributes questions only — and it
// is skipped when the deterministic screen has
// already decided the appeal.
// =============================================

import { triageAppeal } from "./triage.js";
import { analyzeClaim } from "../analyzer.js";
import { runExaggerationAgent } from "./agent-exaggeration.js";
import { runVaguenessAgent } from "./agent-vagueness.js";
import { runNumbersAgent } from "./agent-numbers.js";
import { runConsistencyAgent } from "./agent-consistency.js";
import { runDocumentationAgent } from "./agent-documentation.js";
import { runCrossCheckAgent } from "./agent-crosscheck.js";
import { makeFinding } from "./finding.js";

import {
  runAiAgent,
  aiAvailable,
  buildAnchors,
  activeProvider,
  activeModel
} from "./ai-agents.js";

import {
  reconcileFindings,
  buildInformationRequests,
  composeReport
} from "./synthesis.js";


// An appeal this weak is already decided; a
// semantic read costs 20 seconds to fail harder.
const AI_SCORE_FLOOR = 40;


const STAGES = {
  claim: {
    name: "Claim Audit",
    scope: "claim record",
    run: (context) => auditClaim(context)
  },
  language: {
    name: "Language Audit",
    scope: "chunk",
    run: (context) => ({
      findings: [
        ...runExaggerationAgent(context).findings,
        ...runVaguenessAgent(context).findings
      ]
    })
  },
  figures: {
    name: "Figure & Date Audit",
    scope: "appeal text",
    run: (context) => ({
      findings: [
        ...runNumbersAgent(context).findings,
        ...runConsistencyAgent(context).findings
      ]
    })
  },
  evidence: {
    name: "Evidence Completeness",
    scope: "both sources",
    run: (context) => runDocumentationAgent(context)
  },
  crosscheck: {
    name: "Claim Cross-Check",
    scope: "both sources",
    run: (context) => runCrossCheckAgent(context)
  }
};


const PARALLEL_STAGES = ["claim", "language", "figures", "evidence"];


export async function orchestrateAppealAnalysis(rawText, options = {}) {
  const started = Date.now();
  const forceAi = options.useAi === "force";
  const wantsAi = options.useAi !== false && aiAvailable();

  // -------------------------------------------
  // STAGE 1 — Intake
  // -------------------------------------------
  const intakeStart = Date.now();
  const context = triageAppeal(rawText, options.claim || null);
  const intakeMs = Date.now() - intakeStart;

  const stageRuns = [
    {
      stage: "intake",
      name: "Intake",
      order: 1,
      scope: "both sources",
      status: "done",
      layer: "rules",
      findingCount: 0,
      durationMs: intakeMs,
      note: `${context.metrics.wordCount} words, ${context.metrics.sentenceCount} sentences → ${
        context.tier.label
      } tier, ${context.chunks.length} chunk(s)${
        context.claimIndex.present
          ? `; claim ${context.claimIndex.claimNumber || "record"} with ${
              context.claimIndex.lineItems.length
            } line(s).`
          : "; no claim record supplied."
      }`
    }
  ];

  for (const planned of context.plan.agents) {
    if (planned.run) {
      continue;
    }

    stageRuns.push({
      stage: planned.id,
      name: planned.name,
      order: PARALLEL_STAGES.includes(planned.id) ? 2 : 3,
      scope: STAGES[planned.id]?.scope || "—",
      status: "skipped",
      layer: "rules",
      findingCount: 0,
      durationMs: 0,
      note: planned.reason
    });
  }

  const active = context.plan.active;

  // -------------------------------------------
  // STAGE 2 — parallel deterministic audits
  // -------------------------------------------
  const wave = [];

  for (const id of PARALLEL_STAGES) {
    if (!active.includes(id)) {
      continue;
    }

    const stage = STAGES[id];

    if (stage.scope === "chunk") {
      for (const chunk of context.chunks) {
        wave.push(runStage(id, stage, scopeToChunk(context, chunk), chunk, 2));
      }
      continue;
    }

    wave.push(runStage(id, stage, context, null, 2));
  }

  const waveResults = await Promise.all(wave);

  // -------------------------------------------
  // STAGE 3 — cross-check
  // -------------------------------------------
  const crossResults = active.includes("crosscheck")
    ? [await runStage("crosscheck", STAGES.crosscheck, context, null, 3)]
    : [];

  const deterministic = [...waveResults, ...crossResults];

  for (const result of deterministic) {
    stageRuns.push(result.run);
  }

  let findings = deterministic.flatMap((result) => result.findings);

  const documentation =
    deterministic.find((result) => result.stageId === "evidence")?.payload || {
      checklist: [],
      completeness: {
        requiredPresent: 0,
        requiredTotal: 0,
        recommendedPresent: 0,
        recommendedTotal: 0,
        percentComplete: 0
      }
    };

  const claimAnalysis =
    deterministic.find((result) => result.stageId === "claim")?.payload
      ?.analysis || null;

  // -------------------------------------------
  // STAGE 4 — AI review, gated
  // -------------------------------------------
  const provisional = composeReport({
    context,
    findings: reconcileFindings(findings),
    requests: [],
    documentation,
    claimAnalysis,
    stageRuns,
    aiLayer: { enabled: false }
  });

  const aiLayer = {
    enabled: wantsAi,
    available: aiAvailable(),
    provider: activeProvider(),
    model: activeModel(),
    scoresFindings: false,
    provisionalScore: provisional.integrityScore,
    findingCount: 0,
    errors: [],
    reason: ""
  };

  const gateOpen =
    context.plan.aiFloor &&
    (forceAi || provisional.integrityScore >= AI_SCORE_FLOOR);

  if (!aiAvailable()) {
    aiLayer.reason = "No API key — deterministic stages only.";
  } else if (!wantsAi) {
    aiLayer.reason = "Turned off for this request.";
  } else if (!context.plan.aiFloor) {
    aiLayer.reason = `Skipped — ${context.metrics.wordCount} words is below the 40-word floor.`;
  } else if (!gateOpen) {
    aiLayer.reason = `Skipped — the deterministic screen already scored this ${provisional.integrityScore}/100, below the ${AI_SCORE_FLOOR} floor where a semantic read changes the outcome.`;
  } else {
    aiLayer.reason = `Running for questions only (${activeProvider()} · ${activeModel()}). AI findings never move the score.`;
  }

  if (wantsAi && gateOpen) {
    const aiResults = await Promise.all(
      ["language", "figures", "crosscheck", "evidence"]
        .filter((id) => active.includes(id))
        .map((id) =>
          runAiStage({ stageId: id, context, ruleFindings: findings })
        )
    );

    for (const result of aiResults) {
      stageRuns.push(result.run);

      if (result.error) {
        aiLayer.errors.push(result.error);
        continue;
      }

      aiLayer.findingCount += result.findings.length;
      findings = [...findings, ...result.findings];
    }
  } else {
    stageRuns.push({
      stage: "ai",
      name: "AI Review",
      order: 4,
      scope: "appeal text",
      status: "skipped",
      layer: "ai",
      findingCount: 0,
      durationMs: 0,
      note: aiLayer.reason
    });
  }

  // -------------------------------------------
  // STAGE 5 — Report
  // -------------------------------------------
  const reportStart = Date.now();
  const reconciled = reconcileFindings(findings);
  const requests = buildInformationRequests(reconciled);

  const report = composeReport({
    context,
    findings: reconciled,
    requests,
    documentation,
    claimAnalysis,
    stageRuns,
    aiLayer
  });

  report.stageRuns = [
    ...stageRuns,
    {
      stage: "report",
      name: "Report",
      order: 5,
      scope: "both sources",
      status: "done",
      layer: "rules",
      findingCount: reconciled.length,
      durationMs: Date.now() - reportStart,
      note: `${findings.length} raw → ${reconciled.length} merged; ${requests.length} question(s). Verdict: ${report.verdict.label}.`
    }
  ];

  report.text = context.text;

  // `report.claim` is the claim ANALYSIS built by the
  // reporter. The raw record travels separately so the
  // two never collide.
  report.claimRecord = context.claim || null;
  report.totalDurationMs = Date.now() - started;

  return report;
}


// =============================================
// The claim audit reuses the deterministic rules
// the claim dashboard already runs, so one claim
// cannot be judged two different ways.
// =============================================

function auditClaim(context) {
  const claim = context.claim;

  if (!claim || !Array.isArray(claim.lineItems) || claim.lineItems.length === 0) {
    return { findings: [], analysis: null };
  }

  const analysis = analyzeClaim(claim);

  const findings = analysis.flags.map((flag) =>
    makeFinding({
      agent: "claim",
      category: `claim_${flag.type}`,
      severity: flag.severity,
      quote: flag.lineCode || "claim",
      start: null,
      end: null,
      sentences: context.sentences,
      message: flag.message,
      evidence: flag.evidence,
      ask: askForClaimFlag(flag)
    })
  );

  return { findings, analysis };
}


function askForClaimFlag(flag) {
  const code = flag.lineCode ? `procedure ${flag.lineCode}` : "this claim";

  switch (flag.type) {
    case "duplicate":
      return `Were the repeated entries for ${code} separate services on the same day? If so, please supply the times and the supporting notes.`;
    case "quantity":
      return `Please supply the administration record supporting the unit count billed for ${code}.`;
    case "price_outlier":
      return `Please supply the fee schedule or contract rate that produces the amount billed for ${code}.`;
    case "documentation":
      return `Please supply the full clinical note supporting the intensity billed for ${code}.`;
    case "missing_context":
      return "Please supply the diagnosis codes supporting the services billed on this claim.";
    default:
      return `Please supply supporting documentation for ${code}.`;
  }
}


// =============================================
// Running one deterministic stage
// =============================================

async function runStage(stageId, stage, scopedContext, chunk, order) {
  const start = Date.now();

  let payload;
  let error = null;

  try {
    payload = stage.run(scopedContext);
  } catch (caught) {
    error = caught.message;
    payload = { findings: [] };
  }

  const findings = payload.findings || [];

  return {
    stageId,
    payload,
    findings,
    run: {
      stage: stageId,
      name: stage.name,
      order,
      scope: stage.scope,
      status: error ? "error" : "done",
      layer: "rules",
      chunk: chunk ? chunk.index : null,
      chunkLabel: chunk
        ? `paragraphs ${chunk.paragraphIndexes[0] + 1}-${
            chunk.paragraphIndexes[chunk.paragraphIndexes.length - 1] + 1
          }`
        : stage.scope,
      findingCount: findings.length,
      durationMs: Date.now() - start,
      note: error
        ? `Failed: ${error}`
        : payload.skipped || `${findings.length} finding(s).`
    }
  };
}


// =============================================
// Running one AI stage
//
// Mapped onto the AI agent specialisations that
// already exist, over the whole appeal.
// =============================================

const AI_SPEC_FOR_STAGE = {
  language: ["exaggeration", "vagueness"],
  figures: ["numbers"],
  crosscheck: ["consistency"],
  evidence: ["documentation"]
};


async function runAiStage({ stageId, context, ruleFindings }) {
  const start = Date.now();
  const specs = AI_SPEC_FOR_STAGE[stageId] || [];

  const chunk = {
    index: 0,
    start: 0,
    end: context.text.length,
    paragraphIndexes: context.paragraphs.map((paragraph) => paragraph.index)
  };

  try {
    const results = await Promise.all(
      specs.map((agentId) =>
        runAiAgent({
          agentId,
          chunkText: context.text,
          chunkOffset: 0,
          sentences: context.sentences,
          anchors: buildAnchors(context, chunk),
          ruleFindings: ruleFindings.filter((finding) => finding.agent === agentId)
        })
      )
    );

    const findings = results.flatMap((result) => result.findings);
    const failed = results.find((result) => !result.available);

    return {
      findings,
      error: failed ? failed.error : null,
      run: {
        stage: "ai",
        name: `AI Review · ${STAGES[stageId].name}`,
        order: 4,
        scope: "appeal text",
        status: failed ? "error" : "done",
        layer: "ai",
        findingCount: findings.length,
        durationMs: Date.now() - start,
        note: failed
          ? `Failed: ${failed.error}`
          : `${findings.length} quote-anchored question source(s).`
      }
    };
  } catch (caught) {
    return {
      findings: [],
      error: caught.message,
      run: {
        stage: "ai",
        name: `AI Review · ${STAGES[stageId].name}`,
        order: 4,
        scope: "appeal text",
        status: "error",
        layer: "ai",
        findingCount: 0,
        durationMs: Date.now() - start,
        note: `Failed: ${caught.message}`
      }
    };
  }
}


// =============================================
// Scope a context to one chunk
//
// Text outside the chunk is masked with spaces so
// every regex still reports ABSOLUTE offsets and
// nothing matches across a boundary.
// =============================================

function scopeToChunk(context, chunk) {
  const masked =
    " ".repeat(chunk.start) +
    context.text.slice(chunk.start, chunk.end) +
    " ".repeat(Math.max(0, context.text.length - chunk.end));

  const inChunk = (item) => item.start >= chunk.start && item.start < chunk.end;

  return {
    ...context,
    text: masked,
    numbers: context.numbers.filter(inChunk),
    dates: context.dates.filter(inChunk),
    durations: context.durations.filter(inChunk)
  };
}
