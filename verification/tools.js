// --------------------------------------------------
// AGENT TOOLS
//
// In-process MCP tools handed to the verification
// subagents. Every tool here is read-only and hits
// a public registry — none of them can mutate our
// database or the outside world.
//
// Design rule: tools return FACTS, agents produce
// JUDGEMENTS. Anything mechanical (checksums, string
// similarity, address normalization) is computed in
// JavaScript and handed over pre-chewed. The model is
// here to weigh ambiguous evidence, not to eyeball
// whether two strings look alike.
// --------------------------------------------------

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  validateNpiChecksum,
  lookupByNpi,
  searchByName,
  compareSubmission
} from "./sources/nppes.js";


function asJson(payload) {

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };

}


// --------------------------------------------------
// npi_check_format
// --------------------------------------------------

const npiCheckFormat = tool(

  "npi_check_format",

  "Validate an NPI's check digit offline, with no network call. Every real NPI is a " +
  "10-digit number whose last digit is a Luhn check digit over '80840' + the first nine. " +
  "A number that fails this test cannot be a real NPI. Call this first — it is free and " +
  "instant, and a failure means you can stop.",

  {
    npi: z.string().describe("The 10-digit NPI as submitted on the claim.")
  },

  async ({ npi }) => asJson(validateNpiChecksum(npi)),

  {
    annotations: {
      title: "Check NPI format",
      readOnlyHint: true,
      openWorldHint: false
    }
  }

);


// --------------------------------------------------
// npi_lookup
// --------------------------------------------------

const npiLookup = tool(

  "npi_lookup",

  "Look up a specific NPI in the CMS NPPES registry — the authoritative federal record of " +
  "every provider identifier issued in the United States. Returns legal name, entity type, " +
  "active/deactivated status, primary taxonomy (specialty), and the self-reported practice " +
  "address. Returns found:false if the number is absent from the registry.",

  {
    npi: z.string().describe("The 10-digit NPI to look up.")
  },

  async ({ npi }) => asJson(await lookupByNpi(npi)),

  {
    annotations: {
      title: "Look up NPI",
      readOnlyHint: true,
      openWorldHint: true
    }
  }

);


// --------------------------------------------------
// npi_search_by_name
// --------------------------------------------------

const npiSearchByName = tool(

  "npi_search_by_name",

  "Search NPPES by provider or organization name when the claim did not include an NPI. " +
  "This is the degraded path and you should treat it as such: provider names are not " +
  "unique, so several hundred real organizations share names like 'Family Medical Center'. " +
  "Multiple matches means you could NOT identify the provider — it does not mean you found " +
  "them. Narrow with state whenever the claim supplies one.",

  {
    organizationName: z.string().optional()
      .describe("Organization name, for facility/group providers."),
    firstName: z.string().optional()
      .describe("Given name, for individual providers."),
    lastName: z.string().optional()
      .describe("Family name, for individual providers."),
    state: z.string().optional()
      .describe("Two-letter state code. Strongly recommended — it cuts false matches sharply."),
    city: z.string().optional()
      .describe("City name.")
  },

  async (args) => asJson(await searchByName(args)),

  {
    annotations: {
      title: "Search NPPES by name",
      readOnlyHint: true,
      openWorldHint: true
    }
  }

);


// --------------------------------------------------
// npi_compare_submission
// --------------------------------------------------

const npiCompareSubmission = tool(

  "npi_compare_submission",

  "Compare what the claim asserted about the provider against what the registry actually " +
  "holds, field by field. Name similarity, address normalization, and phone matching are " +
  "computed deterministically here — do not try to judge string similarity yourself, call " +
  "this instead. Returns an 'agreement' rating of strong/partial/weak/unknown per field. " +
  "Read the per-field notes: an address mismatch is genuinely weak evidence because NPPES " +
  "addresses are self-reported and frequently stale.",

  {
    npi: z.string()
      .describe("The NPI whose registry record should be compared."),
    providerName: z.string()
      .describe("Provider name exactly as it appeared on the claim."),
    practiceAddressLine1: z.string().optional()
      .describe("Street address as submitted."),
    practiceState: z.string().optional()
      .describe("Two-letter state code as submitted."),
    practicePhone: z.string().optional()
      .describe("Phone number as submitted, any format.")
  },

  async ({ npi, ...submitted }) => {

    const lookup = await lookupByNpi(npi);

    if (!lookup.found) {
      return asJson({
        comparable: false,
        reason: lookup.reason,
        structurallyInvalid: Boolean(lookup.structurallyInvalid),
        registryUnavailable: Boolean(lookup.unavailable)
      });
    }

    return asJson({
      comparable: true,
      ...compareSubmission(submitted, lookup.record)
    });

  },

  {
    annotations: {
      title: "Compare claim against registry",
      readOnlyHint: true,
      openWorldHint: true
    }
  }

);


// --------------------------------------------------
// The server
//
// alwaysLoad keeps these four in the prompt rather
// than behind tool search. There are only four and
// the subagent needs all of them.
// --------------------------------------------------

export const verificationTools = createSdkMcpServer({

  name: "provider-verification",

  version: "0.1.0",

  instructions:
    "Read-only access to the CMS NPPES provider registry. Every tool returns evidence " +
    "with a source URL. None of them can modify anything.",

  alwaysLoad: true,

  tools: [
    npiCheckFormat,
    npiLookup,
    npiSearchByName,
    npiCompareSubmission
  ]

});


// Fully-qualified names, as the agent will see them.
export const IDENTITY_TOOL_NAMES = [
  "mcp__provider-verification__npi_check_format",
  "mcp__provider-verification__npi_lookup",
  "mcp__provider-verification__npi_search_by_name",
  "mcp__provider-verification__npi_compare_submission"
];
