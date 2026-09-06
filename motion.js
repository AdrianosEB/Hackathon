/* =============================================================
   MOTION
   =============================================================

   A presentation layer. It renders nothing that is not already
   in the payload, and it decides nothing — every tone, every
   number and every label below is read off the response from
   /api/claims/analyze.

   The one thing worth stating plainly: while the request is in
   flight this file does NOT animate progress through the
   pipeline, because the endpoint returns a single response at
   the end and we genuinely have no idea how far along it is.
   During that window the rail shows an indeterminate sweep and
   every stage says so. The stage-by-stage resolve runs after
   the data lands, against the real evidence.

   Exposed as window.Motion. Every entry point is safe to call
   when the elements are missing, so script.js can call it
   unconditionally.
============================================================= */

(function () {
  "use strict";

  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* requestAnimationFrame does not run while the tab is hidden, and
     neither does IntersectionObserver. Anything that reaches its end
     state through rAF would therefore sit in its *start* state — a
     counter reading zero, a panel at opacity zero — for as long as
     the user is looking at another tab. So when we cannot animate,
     we skip straight to the end state instead. */
  const snap = () => reduced || document.hidden;

  const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52;   // r = 52 in the SVG

  // How long the film stays up even when the response is
  // instant. Below this it reads as a flicker rather than a
  // step in a process.
  const MIN_FILM_MS   = 700;
  const STAGE_STEP_MS = 190;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));


  // =============================================
  // TONE
  //
  // The only mapping in this file. Each of these mirrors a
  // vocabulary the server already uses; nothing is inferred.
  // =============================================

  const LEVEL_TONE = {
    routine:  "good",
    review:   "warn",
    priority: "bad"
  };

  const BAND_TONE = {
    confirmed:   "good",
    probable:    "neutral",
    incomplete:  "warn",
    conflicting: "bad"
  };

  const DECISION_TONE = {
    auto_process:    "good",
    priority_review: "warn",
    hold:            "bad"
  };


  // =============================================
  // REVEAL
  // =============================================

  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("is-in");
              observer.unobserve(entry.target);
            });
          },
          { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
        )
      : null;


  /* Marks elements for a scroll-triggered reveal. */
  function watch(elements) {
    toArray(elements).forEach((element) => {
      if (!element || element.dataset.revealBound) return;
      element.dataset.revealBound = "1";
      element.setAttribute("data-reveal", element.dataset.reveal || "");
      if (observer && !reduced) observer.observe(element);
      else element.classList.add("is-in");
    });
  }


  /* Reveals elements immediately, staggered. Used for content
     rendered into a panel the user is already looking at, where
     waiting for a scroll would mean waiting forever. */
  function stagger(elements, { step = 55, start = 0, variant = "" } = {}) {

    const list = toArray(elements).filter(Boolean);

    list.forEach((element, index) => {
      element.setAttribute("data-reveal", variant);
      element.style.setProperty(
        "--reveal-delay",
        snap() ? "0ms" : `${start + index * step}ms`
      );
    });

    if (snap()) {
      list.forEach((element) => element.classList.add("is-in"));
      return;
    }

    // One frame so the initial state is committed before the
    // class flips, otherwise the browser collapses both into
    // a single style resolution and nothing transitions.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        list.forEach((element) => element.classList.add("is-in"));
      });
    });
  }


  function toArray(value) {
    if (!value) return [];
    if (typeof value === "string") return Array.from(document.querySelectorAll(value));
    if (value instanceof Element) return [value];
    return Array.from(value);
  }


  // =============================================
  // COUNT-UP
  // =============================================

  function countUp(element, target, format) {

    if (!element) return;

    const to = Number(target) || 0;
    const render = format || ((value) => String(Math.round(value)));

    if (snap()) {
      element.textContent = render(to);
      element.dataset.countFrom = String(to);
      return;
    }

    const from = Number(String(element.dataset.countFrom ?? "0").replace(/[^0-9.-]/g, "")) || 0;
    const duration = 850;
    const startedAt = performance.now();

    // Cancel a count already running on this element, so two
    // fast refreshes do not fight over the same node.
    if (element._countFrame) cancelAnimationFrame(element._countFrame);

    function frame(now) {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      element.textContent = render(from + (to - from) * eased);

      if (t < 1) element._countFrame = requestAnimationFrame(frame);
      else {
        element.textContent = render(to);
        element.dataset.countFrom = String(to);
        element._countFrame = null;
      }
    }

    element._countFrame = requestAnimationFrame(frame);
  }


  /* Convenience for the four dashboard tiles. */
  function stat(element, value, format) {
    countUp(element, value, format);
  }


  // =============================================
  // GAUGE
  //
  // Returns markup only. activateGauges() below sets the
  // dash offset, which is what makes the arc draw.
  // =============================================

  function gauge(value, tone, suffix) {

    const known = value != null && !Number.isNaN(Number(value));

    return `
      <div class="gauge" data-tone="${escapeHtml(tone || "neutral")}"
           data-value="${known ? Number(value) : ""}"
           role="img"
           aria-label="${known ? `${Number(value)} out of 100` : "not scored"}">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="gauge-track" cx="60" cy="60" r="52"></circle>
          <circle class="gauge-arc"   cx="60" cy="60" r="52"></circle>
        </svg>
        <div class="gauge-num">
          <strong data-gauge-num>${known ? "0" : "—"}</strong>
          <span>${known ? escapeHtml(suffix || "/ 100") : "not scored"}</span>
        </div>
      </div>`;
  }


  function activateGauges(root) {

    (root || document).querySelectorAll(".gauge").forEach((element) => {

      const raw = element.dataset.value;
      if (raw === "") return;

      const value = Math.max(0, Math.min(100, Number(raw)));
      const arc = element.querySelector(".gauge-arc");
      const number = element.querySelector("[data-gauge-num]");

      arc.style.strokeDasharray = String(GAUGE_CIRCUMFERENCE);
      arc.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE);

      const draw = () => {
        arc.style.strokeDashoffset =
          String(GAUGE_CIRCUMFERENCE * (1 - value / 100));
      };

      if (snap()) draw();
      else requestAnimationFrame(() => requestAnimationFrame(draw));

      number.dataset.countFrom = "0";
      countUp(number, value);
    });
  }


  // =============================================
  // THE FILM
  // =============================================

  const STAGES = [
    { id: "intake",   name: "Claim intake",        pending: "Reading the submitted claim…" },
    { id: "rules",    name: "Claim axis · rules",  pending: "Deterministic checks over the line items…" },
    { id: "registry", name: "Provider axis · federal registry",
                      pending: "An agent panel is querying the registry. This is the slow part." },
    { id: "coverage", name: "Coverage",            pending: "Working out what we did and did not check…" },
    { id: "routing",  name: "Routing",             pending: "Composing the two axes…" },
    { id: "outreach", name: "Outreach",            pending: "Deciding whether anyone should be approached…" }
  ];

  let filmStartedAt = 0;


  function startFilm(panel) {

    const host = panel || document.getElementById("resultPanel");
    if (!host) return;

    filmStartedAt = performance.now();

    const empty = document.getElementById("emptyResult");
    const content = document.getElementById("resultContent");

    if (empty)   empty.classList.add("hidden");
    if (content) content.classList.add("hidden");

    let film = host.querySelector(".film");
    if (film) film.remove();

    film = document.createElement("div");
    film.className = "film";
    film.dataset.state = "running";

    film.innerHTML = `
      <div class="film-head">
        <h2>Running both axes</h2>
        <p class="film-sub">
          The claim rules finish immediately. The provider panel talks to the federal
          registry, so it takes as long as it takes — there is no progress to report
          until it answers.
        </p>
      </div>
      <ol class="film-rail">
        <div class="film-beam"></div>
        ${STAGES.map((stage) => `
          <li class="film-stage is-pending" data-stage="${stage.id}">
            <span class="film-node"><i></i></span>
            <p class="film-name">${escapeHtml(stage.name)}</p>
            <span class="film-mark"></span>
            <p class="film-detail">${escapeHtml(stage.pending)}</p>
          </li>`).join("")}
      </ol>`;

    host.appendChild(film);

    const submit = document.getElementById("submitBtn");
    if (submit) submit.classList.add("is-working");
  }


  /* Builds the resolved copy for each stage out of the real
     response. Anything the payload does not contain is
     reported as not available, never guessed. */
  function readStages(data) {

    const verification = data.verification || {};
    const routing = data.routing || null;
    const outreach = data.outreach || null;
    const coverage = verification.coverage || {};
    const lines = data.lineItems || [];

    const money = (value) =>
      new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0
      }).format(Number(value) || 0);

    const out = {};

    out.intake = {
      tone: "neutral",
      mark: `${lines.length} line${lines.length === 1 ? "" : "s"}`,
      detail:
        `${escapeHtml(data.claimNumber || "claim")} · ${money(data.totalBilled)} billed · ` +
        (data.npi ? `NPI ${escapeHtml(data.npi)}` : "no NPI supplied")
    };

    out.rules = {
      tone: LEVEL_TONE[data.reviewLevel] || "neutral",
      mark: `${data.reviewPriority}/100`,
      detail:
        `${(data.observations || []).length} observation` +
        ((data.observations || []).length === 1 ? "" : "s") +
        ` · ${money(data.reviewAmount)} flagged for a person to look at.`
    };

    const band = verification.confidenceBand || "not run";
    out.registry = {
      tone: verification.blocking ? "bad" : (BAND_TONE[band] || "warn"),
      mark: band,
      detail:
        (verification.blocking
          ? `Blocking discrepancy — ${escapeHtml(String(verification.blockingReason || "").replace(/\s*\.\s*$/, "") || "the assessment stopped here")}. `
          : "") +
        (verification.dataConfidenceScore == null
          ? "No score: verification did not complete. That is our gap, not a finding about the provider."
          : `Data confidence ${verification.dataConfidenceScore}/100 across ` +
            `${(verification.checks || []).length} check` +
            ((verification.checks || []).length === 1 ? "" : "s")) +
        (verification.durationMs ? ` · ${(verification.durationMs / 1000).toFixed(1)}s` : "")
    };

    const completeness =
      coverage.completeness != null ? Math.round(coverage.completeness * 100) : null;

    out.coverage = {
      tone: completeness == null ? "warn" : completeness >= 100 ? "good" : "warn",
      mark: completeness == null ? "unknown" : `${completeness}%`,
      detail:
        completeness == null
          ? "Coverage was not reported for this run."
          : `Checked ${escapeHtml((coverage.checked || []).join(", ") || "nothing")}.` +
            ((coverage.skipped || []).length
              ? ` Not checked: ${escapeHtml(
                  (coverage.skipped || []).map((s) => s.label || s.id).join(", ")
                )} — a statement about our coverage, not about the provider.`
              : "")
    };

    out.routing = routing
      ? {
          tone: DECISION_TONE[routing.decision] || "neutral",
          mark: String(routing.decision || "").replace(/_/g, " ") || "routed",
          detail:
            escapeHtml(routing.headline || "") +
            (routing.queue ? ` → ${escapeHtml(routing.queue)}` : "")
        }
      : { tone: "neutral", mark: "not routed", detail: "No routing decision was returned." };

    out.outreach = outreach
      ? outreach.queued
        ? {
            tone: "neutral",
            mark: `tier ${outreach.tier} queued`,
            detail:
              `${escapeHtml(outreach.channel || "an approach")} drafted and waiting for a ` +
              `named person to approve it. Nothing has been sent.`
          }
        : {
            tone: "good",
            mark: "none needed",
            detail: escapeHtml(outreach.reason || "No approach was queued.")
          }
      : { tone: "neutral", mark: "not evaluated", detail: "Outreach was not evaluated for this claim." };

    return out;
  }


  /* Resolves the rail against real data, then dissolves.
     Returns a promise so the caller can render afterwards. */
  async function resolveFilm(data) {

    const film = document.querySelector("#resultPanel .film");
    if (!film) return;

    const elapsed = performance.now() - filmStartedAt;
    if (elapsed < MIN_FILM_MS) await sleep(MIN_FILM_MS - elapsed);

    film.dataset.state = "resolved";

    const resolved = readStages(data);

    for (const stage of STAGES) {

      const row = film.querySelector(`[data-stage="${stage.id}"]`);
      const info = resolved[stage.id];
      if (!row || !info) continue;

      row.querySelector(".film-detail").innerHTML = info.detail;
      row.querySelector(".film-mark").textContent = info.mark;

      row.classList.remove("is-pending");
      row.classList.add("is-done", `tone-${info.tone}`);

      if (!reduced) await sleep(STAGE_STEP_MS);
    }

    await sleep(reduced ? 0 : 320);

    film.classList.add("is-dissolving");
    await sleep(reduced ? 0 : 300);
    film.remove();
  }


  function failFilm() {
    const film = document.querySelector("#resultPanel .film");
    if (film) film.remove();
    const empty = document.getElementById("emptyResult");
    if (empty) empty.classList.remove("hidden");
    endWorking();
  }


  function endWorking() {
    const submit = document.getElementById("submitBtn");
    if (submit) submit.classList.remove("is-working");
  }


  // =============================================
  // AFTER A RESULT RENDERS
  // =============================================

  function afterResult(root) {

    const box = root || document.getElementById("resultContent");
    if (!box) return;

    // A dashboard row can be clicked while an assessment is still
    // running. The result it opens is the one to show, so a film
    // still on screen belongs to a run whose output is no longer
    // what the panel is displaying.
    const stale = document.querySelector("#resultPanel .film");
    if (stale) stale.remove();

    activateGauges(box);

    stagger(box.querySelectorAll(".routing"), { variant: "side" });
    stagger(box.querySelectorAll(".axis"),            { step: 90, start: 90 });
    stagger(box.querySelectorAll(".result-meta div"), { step: 45, start: 260 });
    stagger(box.querySelectorAll(".check"),           { step: 60, start: 380 });
    stagger(box.querySelectorAll(".flag"),            { step: 60, start: 480 });
  }


  // =============================================
  // DASHBOARD
  // =============================================

  let seenClaimIds = null;

  /* Flashes rows that were not in the previous render. On the
     first load nothing flashes, because everything would. */
  function afterDashboard() {

    const rows = Array.from(document.querySelectorAll("#claimsTable tr[data-id]"));
    const ids = new Set(rows.map((row) => row.dataset.id));

    if (seenClaimIds) {
      rows.forEach((row) => {
        if (!seenClaimIds.has(row.dataset.id)) row.classList.add("is-new");
      });
    }

    seenClaimIds = ids;
  }


  // =============================================
  // BOOT
  // =============================================

  /* Elements rendered while the tab was hidden are already in their
     end state by the rule above. This catches the other case: a
     scroll-reveal that was queued on the observer before the user
     left, whose section is on screen when they come back. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((element) => {
      const box = element.getBoundingClientRect();
      if (box.top < window.innerHeight && box.bottom > 0) element.classList.add("is-in");
    });
  });


  document.addEventListener("DOMContentLoaded", () => {
    watch(document.querySelectorAll("main > section, footer"));
    stagger(document.querySelectorAll(".stats article"), { step: 70 });
  });


  /* Exposed so script.js can colour the gauges from the same
     vocabulary the rail uses, rather than a second copy of it. */
  function toneForLevel(level) {
    return LEVEL_TONE[level] || "neutral";
  }

  function toneForBand(band, blocking) {
    if (blocking) return "bad";
    return BAND_TONE[band] || "warn";
  }


  window.Motion = {
    toneForLevel,
    toneForBand,
    watch,
    stagger,
    countUp,
    stat,
    gauge,
    activateGauges,
    startFilm,
    resolveFilm,
    failFilm,
    endWorking,
    afterResult,
    afterDashboard,
    reduced
  };

})();
