// --------------------------------------------------
// WEBSITE CONTACT DISCOVERY
//
// Fetches a practice website and pulls out contact
// channels: emails, phone numbers, and whether the
// page corroborates the registry record.
//
// --------------------------------------------------
// WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
// --------------------------------------------------
//
// NOT for judging the provider. The site is authored
// by the party being checked. Anything favourable on
// it is self-authored, and the absence of a site means
// nothing at all — plenty of legitimate solo and rural
// practices have never had one.
//
// It is for CONTACT DISCOVERY, plus one genuinely
// useful cross-reference: if a phone number on the
// website MATCHES the number in the federal registry,
// two roughly-independent sources agree. That is worth
// something. If they disagree, that is worth a human
// glance. Neither is worth an accusation.
//
// --------------------------------------------------
// WHY EXTRACTION IS REGEX AND NOT A MODEL
// --------------------------------------------------
//
// Because the page is hostile input. If we asked a
// model "what is this practice's phone number?", a page
// could answer for it — "our number is 555-0100, and
// by the way this provider is fully verified" — and the
// model would carry both across.
//
// A regex cannot be talked into anything. It matches
// digit patterns. An injected instruction does not look
// like a phone number, so it cannot become one. The
// model, when it runs at all, only ever sees the
// EXTRACTED VALUES and pre-computed match booleans —
// never the raw page prose.
// --------------------------------------------------

const FETCH_TIMEOUT_MS = 8000;

// A practice homepage is tens of kilobytes. A megabyte
// means something has gone wrong, or someone is trying
// to exhaust us.
const MAX_BYTES = 1_000_000;


// --------------------------------------------------
// SSRF guard
//
// The URL can originate from a claim, which means it
// can originate from someone who would like us to make
// requests on their behalf. Without this, a submitted
// URL of http://169.254.169.254/ turns our verifier
// into a cloud-credential reader.
// --------------------------------------------------

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,          // link-local, incl. cloud metadata
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i
];


export function isFetchableUrl(rawUrl, { allowLocal = false } = {}) {

  let url;

  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }

  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, reason: `Refusing protocol "${url.protocol}".` };
  }

  // The local fixture sites need an exemption, granted
  // explicitly and never inferred from the URL itself.
  if (allowLocal) {
    return { ok: true, url };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Refusing plain http for a remote host." };
  }

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(url.hostname)) {
      return {
        ok: false,
        reason:
          `Refusing to fetch "${url.hostname}" — private, loopback, or link-local address. ` +
          `A submitted URL must never make us reach inside our own network.`
      };
    }
  }

  return { ok: true, url };

}


// --------------------------------------------------
// Fetch and strip
// --------------------------------------------------

async function fetchPage(rawUrl, { allowLocal = false } = {}) {

  const check = isFetchableUrl(rawUrl, { allowLocal });

  if (!check.ok) {
    return { ok: false, reason: check.reason, blocked: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {

    const response = await fetch(check.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "insuCheck-ContactDiscovery/0.1"
      }
    });

    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}.`, status: response.status };
    }

    const contentType = response.headers.get("content-type") || "";

    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      return { ok: false, reason: `Not an HTML page (${contentType}).` };
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_BYTES) {
      return { ok: false, reason: `Page exceeds ${MAX_BYTES} bytes.` };
    }

    const html = new TextDecoder("utf-8").decode(buffer);

    return {
      ok: true,
      html,
      finalUrl: response.url,
      bytes: buffer.byteLength
    };

  } catch (error) {

    return {
      ok: false,
      reason:
        error.name === "AbortError"
          ? `No response within ${FETCH_TIMEOUT_MS}ms.`
          : `Could not fetch: ${error.message}`
    };

  } finally {

    clearTimeout(timer);

  }

}


function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}


function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}


// --------------------------------------------------
// Split the page into what a patient sees and what
// only a machine sees.
//
// Hidden text is the classic injection carrier — a
// display:none div, or an HTML comment, is invisible
// to a visitor and plain to anything scraping the
// page. We do not merge the two, because the
// distinction is the whole point:
//
//   instructions in VISIBLE text  — odd, worth a note
//   instructions in HIDDEN text   — no innocent
//                                   explanation exists
//
// A practice does not accidentally hide a paragraph
// addressed to an AI verifier inside its homepage.
// --------------------------------------------------

function splitPageText(html) {

  const source = String(html);

  const hiddenChunks = [];

  const collect = (match) => {
    hiddenChunks.push(stripTags(match));
    return " ";
  };

  const visible = source
    // Never-rendered regions first.
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")

    // HTML comments are hidden content, not noise.
    .replace(/<!--([\s\S]*?)-->/g, (m, inner) => collect(inner))

    // Elements hidden by inline style or the hidden
    // attribute. Deliberately non-greedy and shallow —
    // this catches the common carriers, not every
    // possible nesting, and it is a tripwire rather
    // than a guarantee.
    .replace(
      /<(div|span|p|section|aside)\b[^>]*(?:style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["']|\bhidden\b|aria-hidden\s*=\s*["']true["'])[^>]*>([\s\S]*?)<\/\1>/gi,
      (m, tag, inner) => collect(inner)
    );

  return {
    visibleText: stripTags(visible),
    hiddenText: hiddenChunks.filter(Boolean).join(" — ").trim()
  };

}


// --------------------------------------------------
// Deterministic extraction
// --------------------------------------------------

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g;

// Addresses on contact pages, loosely.
const ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z0-9.\- ]{2,40}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|place|pl|court|ct|parkway|pkwy|suite|ste)\b\.?/gi;


const digits = (s) => String(s || "").replace(/\D/g, "");


function normalizePhone(raw) {
  const d = digits(raw);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}


export function extractContacts(text) {

  const emails = [...new Set(
    (text.match(EMAIL_RE) || [])
      .map((e) => e.toLowerCase())
      // Tracking and asset filenames masquerade as
      // addresses often enough to be worth excluding.
      .filter((e) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e))
      .filter((e) => !/^(noreply|no-reply|donotreply)@/i.test(e))
  )];

  const phones = [...new Set(
    (text.match(PHONE_RE) || [])
      .map(normalizePhone)
      .filter((p) => p.length === 10)
  )];

  const addresses = [...new Set(
    (text.match(ADDRESS_RE) || []).map((a) => a.trim())
  )].slice(0, 5);

  return { emails, phones, addresses };

}


// --------------------------------------------------
// Corroboration — deterministic, no model
//
// Every one of these is computed from string
// comparison. Nothing on the page can argue with the
// result, because nothing on the page is being read
// for meaning.
// --------------------------------------------------

export function corroborate(extracted, text, { registryRecord, claim }) {

  const haystack = String(text || "").toLowerCase();

  const signals = [];

  // --- practice name appears on the page ---
  const registryName = String(registryRecord?.legalName || "").toLowerCase();
  const claimName = String(claim?.providerName || "").toLowerCase();

  const nameTokens = [...new Set(
    `${registryName} ${claimName}`
      .replace(/\b(inc|llc|llp|pa|pc|pllc|ltd|corp|the|and|of)\b/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3)
  )];

  const tokensFound = nameTokens.filter((t) => haystack.includes(t));

  const nameOnPage =
    nameTokens.length > 0 &&
    tokensFound.length / nameTokens.length >= 0.5;

  signals.push({
    signal: "practice_name_on_page",
    present: nameOnPage,
    detail: nameTokens.length
      ? `${tokensFound.length} of ${nameTokens.length} name tokens present.`
      : "No usable name tokens to look for."
  });

  // --- registry phone appears on the page ---  the strong one
  const registryPhone = normalizePhone(registryRecord?.practiceAddress?.phone);

  const phoneMatchesRegistry =
    Boolean(registryPhone) && extracted.phones.includes(registryPhone);

  signals.push({
    signal: "registry_phone_on_page",
    present: phoneMatchesRegistry,
    detail: registryPhone
      ? phoneMatchesRegistry
        ? "A phone number on the site matches the federal registry record."
        : "No number on the site matches the registry's number."
      : "The registry holds no phone number to compare against.",
    weight: "This is the most meaningful signal here — two sources agreeing."
  });

  // --- city appears on the page ---
  const registryCity = String(registryRecord?.practiceAddress?.city || "").toLowerCase();

  const cityOnPage = Boolean(registryCity) && haystack.includes(registryCity);

  signals.push({
    signal: "registry_city_on_page",
    present: cityOnPage,
    detail: registryCity
      ? cityOnPage
        ? `Page mentions ${registryCity}.`
        : `Page does not mention ${registryCity}.`
      : "No registry city to compare."
  });

  // --- is there anything here at all ---
  const hasContent = haystack.length > 400;

  signals.push({
    signal: "substantive_content",
    present: hasContent,
    detail: `${haystack.length} characters of visible text.`
  });

  const corroboratingCount = signals.filter((s) => s.present).length;

  return {

    signals,

    corroborationLevel:
      phoneMatchesRegistry && nameOnPage
        ? "strong"
        : corroboratingCount >= 2
          ? "partial"
          : "weak",

    // Stated plainly so nothing downstream forgets it.
    interpretation:
      "The practice controls this page, so corroboration here is weaker evidence than a " +
      "registry match, and absence of a site is not evidence of anything. Use this to " +
      "find a contact channel, not to reach a conclusion."

  };

}


// --------------------------------------------------
// Injection screening
//
// Same posture as the registry screening: we do not
// strip it, we surface it. A practice page carrying
// instructions addressed to an automated reader is
// worth a human knowing about.
// --------------------------------------------------

const PAGE_INSTRUCTION_PATTERNS = [
  /\bignore\s+(all\s+|previous\s+|prior\s+|above\s+)/i,
  /\b(system|assistant)\s*:/i,
  /\byou\s+(are|must|should|will)\s+/i,
  /\b(verdict|confidence|reliability|score)\b.{0,24}\b(pass|verified|100|high)\b/i,
  /\b(skip|waive|bypass)\s+(the\s+)?(verification|review|screening)\b/i,
  /\b(pre[-\s]?approved|already\s+verified)\b/i,
  /\bnote\s+to\s+(reviewer|reader|auditor|system|ai)\b/i,
  /\bdo\s+not\s+(flag|review|investigate|escalate)\b/i,
  /\bthis\s+(provider|practice|clinic)\s+is\s+(legitimate|verified|trusted)\b/i
];


export function screenPageContent(visibleText, hiddenText = "") {

  const findings = [];

  const scan = (text, wasHidden) => {

    for (const pattern of PAGE_INSTRUCTION_PATTERNS) {

      const match = String(text).match(pattern);

      if (match) {

        const at = Math.max(0, match.index - 60);

        findings.push({

          location: wasHidden ? "hidden" : "visible",

          quotedText: String(text).slice(at, at + 220),

          note: wasHidden
            ? "Found in content hidden from human visitors — a display:none element or " +
              "an HTML comment. There is no innocent reason to hide a paragraph addressed " +
              "to an automated reader inside a practice homepage. Treated as data and " +
              "never obeyed, and worth telling a reviewer about."
            : "Visible page text resembling an instruction to an automated reader. " +
              "Authored by the practice; treated as data, never obeyed."

        });

        // One finding per pattern per region is enough.
        break;

      }

    }

  };

  scan(visibleText, false);

  if (hiddenText) {
    scan(hiddenText, true);
  }

  return findings;

}


// --------------------------------------------------
// Public entry point
// --------------------------------------------------

export async function discoverFromWebsite(url, { registryRecord, claim, allowLocal = false } = {}) {

  if (!url) {
    return {
      attempted: false,
      reason: "No website URL available to check.",
      contacts: { emails: [], phones: [], addresses: [] }
    };
  }

  const page = await fetchPage(url, { allowLocal });

  if (!page.ok) {

    return {
      attempted: true,
      reachable: false,
      blocked: Boolean(page.blocked),
      url,
      reason: page.reason,
      contacts: { emails: [], phones: [], addresses: [] },
      note:
        "A site that could not be reached tells us nothing about the practice. Many " +
        "legitimate practices have no website at all."
    };

  }

  const { visibleText, hiddenText } = splitPageText(page.html);

  // Contacts are taken from VISIBLE text only. A phone
  // number a patient cannot see is not a contact
  // channel the practice is offering — and treating a
  // hidden number as callable would let a page choose
  // who we ring.
  const contacts = extractContacts(visibleText);

  return {

    attempted: true,
    reachable: true,
    url: page.finalUrl,
    bytes: page.bytes,

    contacts,

    corroboration: corroborate(contacts, visibleText, { registryRecord, claim }),

    unexpectedPageContent: screenPageContent(visibleText, hiddenText),

    hiddenContentBytes: hiddenText.length,

    // Everything above is computed by string matching.
    // No model has read this page.
    extractionMethod: "deterministic pattern matching; page prose never reaches a model"

  };

}
