// =============================================
// AI LAYER
//
// Optional. Each deterministic specialist has an
// AI counterpart that reads the same chunk and
// the same anchors, and may only report things it
// can quote verbatim from the text.
//
// Without OPENAI_API_KEY the whole layer reports
// itself unavailable and the orchestration runs
// on rules alone.
// =============================================

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import { sentenceAt } from "./text-utils.js";


// =============================================
// Provider selection
//
// Anthropic wins when both keys are present —
// it is the one wired for this layer. The
// OpenAI path is kept so the claim reviewer's
// existing key still drives these agents.
// =============================================

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const EFFORT = process.env.APPEAL_AI_EFFORT || "medium";


export function activeProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return null;
}


export function activeModel() {
  const provider = activeProvider();

  if (provider === "anthropic") {
    return ANTHROPIC_MODEL;
  }

  if (provider === "openai") {
    return OPENAI_MODEL;
  }

  return null;
}


const SHARED_RULES = `
You are one specialist in a multi-agent review of a
SYNTHETIC insurance appeal letter, for a hackathon
demonstration.

Your job is to help a human reviewer decide what extra
information to request. You do NOT decide the appeal.

HARD RULES:
- Work ONLY from the supplied appeal text.
- Every finding MUST include a "quote" copied VERBATIM
  from the appeal text, 3 to 20 words long.
- If you cannot quote it, do not report it.
- Never invent facts, records, dates, or figures.
- Never assert fraud or intent.
- Do not report anything already listed in
  "alreadyFoundByRules" unless you can add a materially
  different reason.
- Prefer few high-value findings over many weak ones.
- Report each underlying issue EXACTLY ONCE, under the single
  most apt category. Never restate the same defect under
  several categories or against several quotes — one problem,
  one finding.
- Every finding must end in a concrete question the
  reviewer could send back to the submitter.
`;


const AGENT_SPECS = {
  exaggeration: {
    categories: [
      "absolute_claim",
      "superlative",
      "accusatory_characterisation",
      "unhedged_causation",
      "rhetorical_overreach"
    ],
    focus: `
Find claims that state more than the appeal can support:
absolutes, catastrophising, imputed motive, certainty about
causation, and rhetoric standing in for evidence.
Judge the CLAIM STRENGTH, not the writing style.
`
  },

  numbers: {
    categories: [
      "arithmetic_mismatch",
      "unsourced_statistic",
      "missing_baseline",
      "implausible_magnitude",
      "false_precision",
      "internal_contradiction"
    ],
    focus: `
Examine every figure. Report figures that contradict other
figures, cannot be reproduced from what is stated, are
attributed to unnamed sources, lack a baseline, or are
implausibly large for the context. Show your arithmetic in
the evidence field.
`
  },

  vagueness: {
    categories: [
      "unquantified_amount",
      "undated_event",
      "unnamed_actor",
      "undefined_standard",
      "hedged_assertion",
      "unverifiable_assertion"
    ],
    focus: `
Find statements a reviewer could not verify as written
because a quantity, date, actor, document, or standard is
left unspecified. Focus on statements that MATTER to the
outcome of the appeal.
`
  },

  documentation: {
    categories: [
      "asserted_but_not_enclosed",
      "referenced_but_unidentified",
      "missing_supporting_document",
      "chain_of_evidence_gap"
    ],
    focus: `
Find places where the appeal relies on a document it does
not identify, enclose, date, or quote — and gaps in the
evidence chain between the clinical facts asserted and the
records named.
`
  },

  consistency: {
    categories: [
      "conflicting_amount",
      "conflicting_date",
      "conflicting_narrative",
      "restated_claim"
    ],
    focus: `
Compare sections against each other. Report only genuine
contradictions or unexplained shifts between what different
parts of the appeal assert.
`
  }
};


const FINDING_SCHEMA = (categories) => ({
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: categories },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          quote: { type: "string" },
          message: { type: "string" },
          evidence: { type: "string" },
          ask: { type: "string" }
        },
        required: ["category", "severity", "quote", "message", "evidence", "ask"],
        additionalProperties: false
      }
    }
  },
  required: ["findings"],
  additionalProperties: false
});


export function aiAvailable() {
  return activeProvider() !== null;
}


export async function runAiAgent({
  agentId,
  chunkText,
  chunkOffset,
  sentences,
  anchors,
  ruleFindings
}) {
  const spec = AGENT_SPECS[agentId];

  if (!spec) {
    return { agent: agentId, findings: [], available: false };
  }

  const provider = activeProvider();

  if (!provider) {
    return {
      agent: agentId,
      findings: [],
      available: false,
      error: "No ANTHROPIC_API_KEY or OPENAI_API_KEY is set"
    };
  }

  const payload = {
    appealText: chunkText,
    anchors,
    alreadyFoundByRules: ruleFindings.map((finding) => ({
      category: finding.category,
      quote: finding.quote
    }))
  };

  const instructions = `${SHARED_RULES}\nYOUR SPECIALISATION:${spec.focus}`;
  const schema = FINDING_SCHEMA(spec.categories);

  const parsed =
    provider === "anthropic"
      ? await callAnthropic({ agentId, instructions, payload, schema })
      : await callOpenAI({ agentId, instructions, payload, schema });

  if (parsed.refused) {
    return {
      agent: agentId,
      findings: [],
      available: true,
      error: `Model declined this chunk (${parsed.category || "unspecified"})`
    };
  }

  const findings = (parsed.findings || [])
    .map((finding) => anchorFinding(finding, {
      agentId,
      chunkText,
      chunkOffset,
      sentences
    }))
    .filter(Boolean);

  return { agent: agentId, findings, available: true };
}


// =============================================
// Anthropic — structured output via
// output_config.format, no tool round-trip.
// =============================================

async function callAnthropic({ agentId, instructions, payload, schema }) {
  // A key created at the organisation level rather than
  // inside a workspace must name the workspace on every
  // request. Workspace-scoped keys need no header.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(workspaceId
      ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
      : {})
  });

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    system: instructions,
    output_config: {
      effort: EFFORT,
      format: {
        type: "json_schema",
        schema
      }
    },
    messages: [
      {
        role: "user",
        content: JSON.stringify(payload)
      }
    ]
  });

  if (response.stop_reason === "refusal") {
    return {
      refused: true,
      category: response.stop_details?.category || null
    };
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text.trim()) {
    return { findings: [] };
  }

  return JSON.parse(text);
}


// =============================================
// OpenAI — Responses API, unchanged.
// =============================================

async function callOpenAI({ agentId, instructions, payload, schema }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    instructions,
    input: JSON.stringify(payload),
    text: {
      format: {
        type: "json_schema",
        name: `${agentId}_findings`,
        strict: true,
        schema
      }
    }
  });

  return JSON.parse(response.output_text);
}


// =============================================
// Anchor a model finding back to real offsets.
//
// A quote that is not actually in the text is
// dropped — that is the hallucination guard.
// =============================================

function anchorFinding(finding, { agentId, chunkText, chunkOffset, sentences }) {
  const quote = String(finding.quote || "").trim();

  if (quote.length < 3) {
    return null;
  }

  let localIndex = chunkText.indexOf(quote);

  if (localIndex === -1) {
    const loose = quote.replace(/\s+/g, " ").trim();
    localIndex = chunkText.replace(/\s+/g, " ").indexOf(loose);

    if (localIndex === -1) {
      return null;
    }
  }

  const start = chunkOffset + localIndex;
  const end = start + quote.length;
  const sentence = sentenceAt(sentences, start);

  return {
    id: `${agentId}-ai-${finding.category}-${start}`,
    agent: agentId,
    category: finding.category,
    severity: finding.severity,
    confidence: 0.55,
    quote,
    start,
    end,
    sentenceIndex: sentence ? sentence.index : null,
    paragraphIndex: sentence ? sentence.paragraph : null,
    sentenceText: sentence ? sentence.text : null,
    message: finding.message,
    evidence: finding.evidence,
    ask: finding.ask,
    detectedBy: ["ai"]
  };
}


export function buildAnchors(context, chunk) {
  const inChunk = (item) => item.start >= chunk.start && item.start < chunk.end;

  return {
    paragraphNumbers: chunk.paragraphIndexes.map((index) => index + 1),
    figures: context.numbers
      .filter(inChunk)
      .map((number) => ({ text: number.raw, kind: number.kind })),
    dates: context.dates.filter(inChunk).map((date) => date.raw),
    durations: context.durations.filter(inChunk).map((duration) => duration.raw)
  };
}
