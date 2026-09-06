// --------------------------------------------------
// AGENT RUNTIME — the on/off switch
//
//   AGENTS_LIVE=false  (default)
//     No API calls. No tokens. Every agent step is
//     answered by a deterministic stand-in, or by a
//     previously recorded real response.
//
//   AGENTS_LIVE=true
//     Real Claude agents, really talking to each other.
//
//   AGENTS_RECORD=true  (with AGENTS_LIVE=true)
//     Live, and every response is written to a
//     cassette file.
//
// --------------------------------------------------
// WHY RECORD-AND-REPLAY RATHER THAN HAND-WRITTEN FAKES
// --------------------------------------------------
//
// The obvious way to make a demo deterministic is to
// hand-write the responses you wish the agents gave.
// That demo is a lie: it shows what you hoped for, and
// it drifts away from real behaviour the moment the
// prompts change.
//
// Instead: run it live ONCE with your API key, record
// what the agents actually said, then replay that for
// free forever. The demo shows genuine model output,
// costs nothing to run, and gives the same answer every
// time a judge asks you to run it again.
//
// Until you record anything, the stand-ins below cover
// it — they are rule-based, clearly labelled as such in
// their output, and never pretend to be model-authored.
// --------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CASSETTE_PATH =
  process.env.AGENT_CASSETTE_PATH ||
  join(HERE, "..", "fixtures", "agent-cassettes.json");


function flag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}


export const AGENTS_LIVE = flag("AGENTS_LIVE", false);
export const AGENTS_RECORD = flag("AGENTS_RECORD", false) && AGENTS_LIVE;


export function runtimeMode() {

  if (!AGENTS_LIVE) {
    return {
      mode: "deterministic",
      live: false,
      description:
        "Agents are not calling the API. Responses come from recorded cassettes where " +
        "available, otherwise from rule-based stand-ins. No tokens are being spent.",
      cassetteCount: Object.keys(loadCassettes()).length
    };
  }

  return {
    mode: AGENTS_RECORD ? "live+recording" : "live",
    live: true,
    description: AGENTS_RECORD
      ? "Agents are live and every response is being written to the cassette file."
      : "Agents are live. This spends tokens on every claim.",
    cassetteCount: Object.keys(loadCassettes()).length
  };

}


// --------------------------------------------------
// Cassette storage
// --------------------------------------------------

let cassetteCache = null;


function loadCassettes() {

  if (cassetteCache) {
    return cassetteCache;
  }

  try {
    cassetteCache = existsSync(CASSETTE_PATH)
      ? JSON.parse(readFileSync(CASSETTE_PATH, "utf8"))
      : {};
  } catch {
    cassetteCache = {};
  }

  return cassetteCache;

}


function saveCassette(key, entry) {

  const all = loadCassettes();

  all[key] = entry;

  try {
    mkdirSync(dirname(CASSETTE_PATH), { recursive: true });
    writeFileSync(CASSETTE_PATH, JSON.stringify(all, null, 2));
  } catch (error) {
    console.warn(`Could not write cassette: ${error.message}`);
  }

}


// The key must cover everything that could change the
// answer. Prompt included: if you edit an agent's
// instructions, its old recordings stop matching and
// you are told to re-record rather than silently
// replaying stale output from a prompt that no longer
// exists.
export function cassetteKey(agentName, input, promptVersion) {

  const material = JSON.stringify({ agentName, input, promptVersion });

  return `${agentName}:${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;

}


// --------------------------------------------------
// The wrapper every agent call goes through
//
//   liveFn()      -> runs the real agent
//   standInFn()   -> rule-based fallback, same shape
// --------------------------------------------------

export async function runAgentStep({
  agentName,
  input,
  promptVersion = "v1",
  liveFn,
  standInFn
}) {

  const key = cassetteKey(agentName, input, promptVersion);

  const cassettes = loadCassettes();


  // ---- deterministic mode ----

  if (!AGENTS_LIVE) {

    if (cassettes[key]) {

      return {
        ...cassettes[key].response,
        _source: "cassette",
        _recordedAt: cassettes[key].recordedAt
      };

    }

    const standIn = await standInFn(input);

    return {
      ...standIn,
      _source: "rule_based_stand_in",
      _note:
        "Produced by deterministic rules, not by a model. Set AGENTS_LIVE=true to run " +
        "the real agent, or AGENTS_RECORD=true once to capture its output for replay."
    };

  }


  // ---- live ----

  const response = await liveFn(input);

  if (AGENTS_RECORD) {

    saveCassette(key, {
      agentName,
      promptVersion,
      recordedAt: new Date().toISOString(),
      // Stored so a human can read the cassette file and
      // see what question produced what answer.
      input,
      response
    });

    cassetteCache = null;

  }

  return { ...response, _source: "live" };

}
