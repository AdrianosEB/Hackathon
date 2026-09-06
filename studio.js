/* =============================================================
   CLAIM INTEGRITY — STUDIO
   =============================================================

   Six scenes over the existing API. It adds no endpoints and
   invents no data: every number, band and sentence on screen
   comes back from /api/claims/analyze, /api/dashboard or
   /api/verification/coverage.

   The one thing to keep honest as this file grows: the run
   scene must never animate progress it does not have. The
   endpoint answers once, at the end. Until it does, the rail
   sweeps and every row says it is waiting. The stage-by-stage
   resolve happens afterwards, against real evidence.
============================================================= */

(function () {
  "use strict";

  const $  = (id) => document.getElementById(id);
  const el = (sel, root) => (root || document).querySelector(sel);

  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const snap = () => reduced || document.hidden;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const CIRC = 2 * Math.PI * 52;


  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* blockingReason normally ends in a full stop; the sentence it is
     spliced into supplies its own, so drop the duplicate. */
  const stripStop = (text) => String(text || "").replace(/\s*\.\s*$/, "");


  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }


  // =============================================
  // TONE
  //
  // Four words, used everywhere. "unknown" is a gap in OUR
  // coverage and is deliberately the same hue as the accent —
  // it must never read as a mark against a provider.
  // =============================================

  const LEVEL = { routine: "clear", review: "watch", priority: "conflict" };

  // confirmed and probable share a tone on purpose: both mean the
  // record holds up. How well is the gauge's job, not the colour's.
  const BAND = {
    confirmed: "clear",
    probable: "clear",
    incomplete: "unknown",
    conflicting: "conflict"
  };

  const DECISION = {
    auto_process: "clear",
    priority_review: "watch",
    hold: "conflict"
  };

  const toneForBand = (band, blocking) =>
    blocking ? "conflict" : (BAND[band] || "unknown");


  // =============================================
  // STATE
  // =============================================

  const SCENES = [
    { id: "cover",    label: "Cover",     always: true  },
    { id: "subject",  label: "Subject",   always: true  },
    { id: "run",      label: "The run",   always: false },
    { id: "verdict",  label: "Verdict",   always: false },
    { id: "evidence", label: "Evidence",  always: false },
    { id: "ledger",   label: "Ledger",    always: true  }
  ];

  const state = {
    scene: "cover",
    picked: null,      // index into CLAIM_SCENARIOS
    result: null,      // the last analyse response
    running: false
  };

  const scenarios = window.CLAIM_SCENARIOS || [];


  function unlocked(id) {
    const scene = SCENES.find((s) => s.id === id);
    if (!scene) return false;
    if (scene.always) return true;
    if (id === "run") return state.running || !!state.result;
    return !!state.result;
  }


  // =============================================
  // REVEAL
  // =============================================

  function reveal(nodes, { step = 70, start = 0 } = {}) {

    const list = Array.from(nodes || []);

    list.forEach((node, index) => {
      node.classList.add("reveal");
      node.style.setProperty("--delay", snap() ? "0ms" : `${start + index * step}ms`);
    });

    if (snap()) {
      list.forEach((node) => node.classList.add("is-in"));
      return;
    }

    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        list.forEach((node) => node.classList.add("is-in"))));
  }


  function countUp(node, to, format) {

    if (!node) return;

    const target = Number(to) || 0;
    const render = format || ((v) => String(Math.round(v)));

    if (snap()) {
      node.textContent = render(target);
      return;
    }

    const from = 0;
    const duration = 900;
    const t0 = performance.now();

    if (node._frame) cancelAnimationFrame(node._frame);

    function tick(now) {
      const t = Math.min(1, (now - t0) / duration);
      node.textContent = render(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) node._frame = requestAnimationFrame(tick);
      else { node.textContent = render(target); node._frame = null; }
    }

    node._frame = requestAnimationFrame(tick);
  }


  // =============================================
  // SCENE MACHINE
  // =============================================

  function renderRail() {

    $("railSteps").innerHTML = SCENES.map((scene, index) => `
      <li>
        <button class="rail-step ${scene.id === state.scene ? "is-current" : ""}"
                data-goto="${scene.id}"
                ${unlocked(scene.id) ? "" : "disabled"}
                ${unlocked(scene.id) ? "" : 'title="Run a claim first"'}>
          <span class="n">${index + 1}</span>
          <span class="label">${escapeHtml(scene.label)}</span>
        </button>
      </li>`).join("");
  }


  function goto(id) {

    if (!unlocked(id) || id === state.scene) return;

    const from = document.querySelector(`.scene[data-scene="${state.scene}"]`);
    const to = document.querySelector(`.scene[data-scene="${id}"]`);
    if (!to) return;

    const back = SCENES.findIndex((s) => s.id === id) <
                 SCENES.findIndex((s) => s.id === state.scene);

    if (from) {
      from.classList.remove("is-active");
      from.classList.toggle("is-leaving-back", back);
      // Nothing in a scene nobody is looking at should be tabbable.
      from.setAttribute("inert", "");
    }

    state.scene = id;

    to.removeAttribute("inert");
    to.classList.remove("is-leaving-back");
    to.classList.add("is-active");
    to.scrollTop = 0;

    renderRail();
    enterScene(id);
  }


  /* Per-scene entrance choreography. */
  function enterScene(id) {

    const scene = document.querySelector(`.scene[data-scene="${id}"]`);
    if (!scene) return;

    if (id === "cover") {
      reveal(scene.querySelectorAll(".reveal"), { step: 90 });
      return;
    }

    if (id === "subject") {
      reveal(scene.querySelectorAll(".scene-head, .subject"), { step: 38 });
      return;
    }

    if (id === "verdict") {
      reveal(scene.querySelectorAll(".routing, .vaxis, .verdict-meta > div"), { step: 75 });
      drawGauges(scene);
      return;
    }

    if (id === "evidence") {
      reveal(scene.querySelectorAll(".dossier > *"), { step: 45 });
      return;
    }

    if (id === "ledger") {
      loadLedger();
      reveal(scene.querySelectorAll(".tile, .ledger-wrap"), { step: 55 });
    }
  }


  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-goto]");
    if (!trigger || trigger.disabled) return;
    goto(trigger.dataset.goto);
  });

  document.addEventListener("keydown", (event) => {

    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;

    const index = SCENES.findIndex((s) => s.id === state.scene);

    if (event.key === "ArrowRight") {
      for (let i = index + 1; i < SCENES.length; i++) {
        if (unlocked(SCENES[i].id)) return goto(SCENES[i].id);
      }
    }

    if (event.key === "ArrowLeft") {
      for (let i = index - 1; i >= 0; i--) {
        if (unlocked(SCENES[i].id)) return goto(SCENES[i].id);
      }
    }

    const digit = Number(event.key);
    if (digit >= 1 && digit <= SCENES.length) goto(SCENES[digit - 1].id);
  });


  // =============================================
  // SCENE 2 — SUBJECTS
  // =============================================

  function renderSubjects() {

    $("subjects").innerHTML = scenarios.map((scenario, index) => {

      const claim = scenario.claim || {};
      const lines = claim.lineItems || [];
      const billed = lines.reduce(
        (sum, line) => sum + Number(line.amount || 0) * Number(line.units || 1), 0);

      // The number in front of the name is already in the fixture
      // ("1 · Clean provider…"), so strip it rather than print two.
      const name = String(scenario.name).replace(/^\d+\s*·\s*/, "");

      return `
        <button class="subject" data-subject="${index}">
          <span class="subject-n">SUBJECT ${String(index + 1).padStart(2, "0")}</span>
          <p class="subject-name">${escapeHtml(name)}</p>
          <p class="subject-expect">${escapeHtml(scenario.expect || "")}</p>
          <div class="subject-foot">
            <span>${escapeHtml(claim.npi || "no NPI")}</span>
            <span>${lines.length} line${lines.length === 1 ? "" : "s"}</span>
            <span>${money(billed)}</span>
          </div>
        </button>`;
    }).join("");

    $("subjects").querySelectorAll("[data-subject]").forEach((button) => {
      button.onclick = () => {
        state.picked = Number(button.dataset.subject);
        $("subjects").querySelectorAll(".subject")
          .forEach((other) => other.classList.toggle(
            "is-picked", other === button));
        $("runBtn").disabled = false;
      };
    });
  }


  // =============================================
  // SCENE 3 — THE RUN
  // =============================================

  const STAGES = [
    { id: "intake",   name: "Claim intake",
      waiting: "Reading the submitted claim…" },
    { id: "rules",    name: "Claim axis · deterministic rules",
      waiting: "Checking the line items against the rules…" },
    { id: "registry", name: "Provider axis · federal registry",
      waiting: "An agent panel is querying the registry. This is the slow part, and we cannot see inside it." },
    { id: "coverage", name: "Coverage",
      waiting: "Working out what was and was not checked…" },
    { id: "routing",  name: "Routing",
      waiting: "Composing the two axes…" },
    { id: "outreach", name: "Outreach",
      waiting: "Deciding whether anyone should be approached…" }
  ];


  function buildFilm() {

    $("film").dataset.state = "running";

    $("film").innerHTML =
      `<div class="film-beam"></div>` +
      STAGES.map((stage) => `
        <li class="stage-row is-waiting" data-stage="${stage.id}">
          <span class="stage-node"><i></i></span>
          <p class="stage-name">${escapeHtml(stage.name)}</p>
          <span class="stage-mark"></span>
          <p class="stage-detail">${escapeHtml(stage.waiting)}</p>
        </li>`).join("");
  }


  /* Reads the response into one resolved row per stage. Anything
     the payload does not contain is reported as absent, never
     guessed at. */
  function readStages(data) {

    const v = data.verification || {};
    const routing = data.routing || null;
    const outreach = data.outreach || null;
    const coverage = v.coverage || {};
    const lines = data.lineItems || [];
    const observations = data.observations || [];
    const checks = v.checks || [];

    const out = {};

    out.intake = {
      tone: "unknown",
      mark: `${lines.length} line${lines.length === 1 ? "" : "s"}`,
      detail: `${escapeHtml(data.claimNumber || "claim")} · ${money(data.totalBilled)} billed · ` +
              (data.npi ? `NPI ${escapeHtml(data.npi)}` : "no NPI supplied")
    };

    out.rules = {
      tone: LEVEL[data.reviewLevel] || "unknown",
      mark: `${data.reviewPriority}/100`,
      detail: `${observations.length} observation${observations.length === 1 ? "" : "s"} · ` +
              `${money(data.reviewAmount)} flagged for a person to look at.`
    };

    const band = v.confidenceBand || "not run";
    out.registry = {
      tone: toneForBand(band, v.blocking),
      mark: band,
      detail:
        (v.blocking
          ? `Blocking discrepancy — ${escapeHtml(stripStop(v.blockingReason) || "the assessment stopped here")}. `
          : "") +
        (v.dataConfidenceScore == null
          ? "No score: verification did not complete. That is our gap, not a finding about the provider."
          : `Data confidence ${v.dataConfidenceScore}/100 across ` +
            `${checks.length} check${checks.length === 1 ? "" : "s"}`) +
        (v.durationMs ? ` · took ${(v.durationMs / 1000).toFixed(1)}s` : "")
    };

    const pct = coverage.completeness != null
      ? Math.round(coverage.completeness * 100) : null;

    out.coverage = {
      tone: pct === 100 ? "clear" : "unknown",
      mark: pct == null ? "unreported" : `${pct}%`,
      detail: pct == null
        ? "Coverage was not reported for this run."
        : `Checked ${escapeHtml((coverage.checked || []).join(", ") || "nothing")}.` +
          ((coverage.skipped || []).length
            ? ` Not checked: ${escapeHtml((coverage.skipped || [])
                .map((s) => s.label || s.id).join(", "))} — a statement about our coverage, ` +
              `not about the provider.`
            : "")
    };

    out.routing = routing
      ? {
          tone: DECISION[routing.decision] || "unknown",
          mark: String(routing.decision || "routed").replace(/_/g, " "),
          detail: escapeHtml(routing.headline || "") +
                  (routing.queue ? ` → ${escapeHtml(routing.queue)}` : "")
        }
      : { tone: "unknown", mark: "not routed",
          detail: "No routing decision was returned." };

    out.outreach = outreach
      ? outreach.queued
        ? { tone: "watch", mark: `tier ${outreach.tier} queued`,
            detail: `${escapeHtml(outreach.channel || "An approach")} drafted and waiting for a ` +
                    `named person to approve it. Nothing has been sent.` }
        : { tone: "clear", mark: "none needed",
            detail: escapeHtml(outreach.reason || "No approach was queued.") }
      : { tone: "unknown", mark: "not evaluated",
          detail: "Outreach was not evaluated for this claim." };

    return out;
  }


  async function resolveFilm(data) {

    const film = $("film");
    film.dataset.state = "resolved";

    const resolved = readStages(data);

    for (const stage of STAGES) {

      const row = el(`[data-stage="${stage.id}"]`, film);
      const info = resolved[stage.id];
      if (!row || !info) continue;

      el(".stage-detail", row).innerHTML = info.detail;
      el(".stage-mark", row).textContent = info.mark;

      row.classList.remove("is-waiting");
      row.classList.add("is-done", `tone-${info.tone}`);

      if (!snap()) await sleep(185);
    }
  }


  async function run() {

    if (state.picked == null || state.running) return;

    const scenario = scenarios[state.picked];

    const claim = Object.assign({}, scenario.claim, {
      claimNumber: scenario.claim.claimNumber ||
        `CLM-${Math.floor(10000 + Math.random() * 89999)}`
    });

    state.running = true;
    state.result = null;

    $("runBtn").classList.add("is-running");
    $("toVerdictBtn").disabled = true;
    $("runTitle").textContent = "Running both axes";
    $("runSub").textContent =
      "The claim rules finish immediately. The provider panel is talking to the " +
      "federal registry, so it takes as long as it takes — there is no progress to " +
      "report until it answers.";

    const stale = el(".oops", document.querySelector('[data-scene="run"]'));
    if (stale) stale.remove();

    buildFilm();
    renderRail();
    goto("run");

    const startedAt = performance.now();

    try {

      const response = await fetch("/api/claims/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claim)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error((data.errors || [data.error]).filter(Boolean).join(" ") ||
                        `The server answered ${response.status}.`);
      }

      state.result = data;
      state.running = false;

      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      $("runTitle").textContent = "Both axes, answered";
      $("runSub").textContent =
        `The response came back in ${seconds}s. Each row below is what it actually ` +
        `contained — nothing here is inferred from the wait.`;

      await resolveFilm(data);

      renderVerdict(data);
      renderDossier(data);

      $("toVerdictBtn").disabled = false;
      renderRail();

    } catch (error) {

      state.running = false;
      $("film").dataset.state = "failed";
      $("runTitle").textContent = "The run did not complete";
      $("runSub").textContent =
        "Nothing was assessed. This is a failure on our side and says nothing about " +
        "the provider or the claim.";

      const oops = document.createElement("p");
      oops.className = "oops";
      oops.textContent = error.message;
      el(".run-inner").appendChild(oops);

      renderRail();

    } finally {
      $("runBtn").classList.remove("is-running");
    }
  }


  // =============================================
  // SCENE 4 — VERDICT
  // =============================================

  function gauge(value, tone, caption) {

    const known = value != null && !Number.isNaN(Number(value));

    return `
      <div class="gauge tone-${escapeHtml(tone)}"
           data-value="${known ? Number(value) : ""}"
           role="img"
           aria-label="${known ? `${Number(value)} out of 100` : "not scored"}">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="gauge-track" cx="60" cy="60" r="52"></circle>
          <circle class="gauge-arc"   cx="60" cy="60" r="52"></circle>
        </svg>
        <div class="gauge-num">
          <strong data-num>${known ? "0" : "—"}</strong>
          <span>${known ? escapeHtml(caption) : "NOT SCORED"}</span>
        </div>
      </div>`;
  }


  function drawGauges(root) {

    (root || document).querySelectorAll(".gauge").forEach((node) => {

      if (node.dataset.value === "") return;

      const value = Math.max(0, Math.min(100, Number(node.dataset.value)));
      const arc = el(".gauge-arc", node);
      const num = el("[data-num]", node);

      arc.style.strokeDashoffset = String(CIRC);

      const draw = () => {
        arc.style.strokeDashoffset = String(CIRC * (1 - value / 100));
      };

      if (snap()) draw();
      else requestAnimationFrame(() => requestAnimationFrame(draw));

      countUp(num, value);
    });
  }


  function renderVerdict(data) {

    const v = data.verification || {};
    const routing = data.routing;

    const claimTone = LEVEL[data.reviewLevel] || "unknown";
    const providerTone = toneForBand(v.confidenceBand, v.blocking);
    const decisionTone = routing ? (DECISION[routing.decision] || "unknown") : "unknown";

    // Tints the page hairline and the rail dot.
    document.body.dataset.tone = decisionTone;

    $("verdictClaim").textContent = data.claimNumber || "Verdict";
    $("verdictProvider").textContent =
      `${data.providerName}${data.npi ? ` · NPI ${data.npi}` : " · no NPI supplied"}`;

    $("verdictRouting").innerHTML = routing ? `
      <div class="routing tone-${escapeHtml(decisionTone)}">
        <h2>${escapeHtml(routing.headline || "Routed")}</h2>
        <p>${escapeHtml(routing.reason || "")}</p>
        <div class="routing-chips">
          <span class="chip">${escapeHtml(String(routing.decision || "").replace(/_/g, " "))}</span>
          ${routing.queue ? `<span class="chip">→ ${escapeHtml(routing.queue)}</span>` : ""}
        </div>
        ${routing.note ? `<p class="routing-note">${escapeHtml(routing.note)}</p>` : ""}
      </div>` : "";

    // The two axes point in opposite directions — 0 is good on
    // one and bad on the other — so each gauge says which way.
    $("verdictAxes").innerHTML = `

      <div class="vaxis">
        ${gauge(data.reviewPriority, claimTone, "0 = NOTHING TO SEE")}
        <div class="vaxis-copy">
          <span class="axis-tag">AXIS ONE · THE CLAIM</span>
          <h3>Review priority</h3>
          <p>How much of the claim's own content needs a person to look at it. Deterministic,
             and it never depends on who the provider is.</p>
          <span class="band tone-${escapeHtml(claimTone)}">${escapeHtml(data.reviewLevel)}</span>
        </div>
      </div>

      <div class="vaxis">
        ${gauge(v.dataConfidenceScore ?? null, providerTone, "100 = CORROBORATED")}
        <div class="vaxis-copy">
          <span class="axis-tag">AXIS TWO · THE RECORD</span>
          <h3>Data confidence</h3>
          <p>How well the provider record matches the federal registry. A low score is a
             statement about the evidence, never about the provider.</p>
          <span class="band tone-${escapeHtml(providerTone)}">${
            escapeHtml(v.confidenceBand || "not run")}</span>
        </div>
      </div>`;

    $("verdictMeta").innerHTML = `
      <div><span>TOTAL BILLED</span><strong>${money(data.totalBilled)}</strong></div>
      <div><span>TO REVIEW</span><strong>${money(data.reviewAmount)}</strong></div>
      <div><span>OBSERVATIONS</span><strong>${(data.observations || []).length}</strong></div>
      <div><span>REGISTRY CHECKS</span><strong>${(v.checks || []).length}</strong></div>`;
  }


  // =============================================
  // SCENE 5 — EVIDENCE
  // =============================================

  const CHECK_TONE = {
    match: "clear",
    partial: "watch",
    mismatch: "conflict",
    not_checked: "unknown"
  };

  const WEIGHT_TONE = { high: "conflict", medium: "watch", low: "unknown" };


  function renderDossier(data) {

    const v = data.verification || {};
    const coverage = v.coverage || {};
    const observations = data.observations || [];
    const checks = v.checks || [];
    const outreach = data.outreach;

    const pct = coverage.completeness != null
      ? Math.round(coverage.completeness * 100) : null;

    $("dossier").innerHTML = `

      ${v.blocking ? `
        <div class="blocking">
          <strong>Blocking discrepancy — the assessment stopped here.</strong>
          <p>${escapeHtml(v.blockingReason || "")}</p>
          <p>A blocking finding is not one signal among several. The remaining checks cannot
             offset it, and no outreach is attempted: there is no verified party to contact.</p>
        </div>` : ""}

      <h2>The provider record</h2>

      ${v.rationale ? `<p class="note">${escapeHtml(v.rationale)}</p>` : ""}

      ${checks.length ? checks.map((check) => `
        <div class="card tone-${escapeHtml(CHECK_TONE[check.result] || "unknown")}">
          <div class="card-head">
            <strong>${escapeHtml(check.dimension)}</strong>
            <span class="tag">${escapeHtml(String(check.result).replace(/_/g, " "))}</span>
          </div>
          ${check.summary ? `<p>${escapeHtml(check.summary)}</p>` : ""}
          ${check.limitations ? `<p class="limits">${escapeHtml(check.limitations)}</p>` : ""}
        </div>`).join("")
        : `<p class="note">No checks ran for this claim.</p>`}

      ${pct != null ? `
        <p class="note">
          Coverage ${pct}% — checked ${escapeHtml((coverage.checked || []).join(", ") || "nothing")}.
          ${(coverage.skipped || []).length
            ? `Not checked: ${escapeHtml((coverage.skipped || [])
                .map((s) => s.label || s.id).join(", "))}. That is a statement about our
               coverage, not about the provider.`
            : ""}
        </p>` : ""}

      <h2>Observations on the claim</h2>

      ${observations.length ? observations.map((o) => `
        <div class="card tone-${escapeHtml(WEIGHT_TONE[o.weight] || "unknown")}">
          <div class="card-head">
            <strong>${escapeHtml(o.observation || "")}</strong>
            <span class="tag">${escapeHtml(o.weight || "")}</span>
          </div>
          ${o.evidence ? `<p>${escapeHtml(o.evidence)}</p>` : ""}
          ${o.innocentExplanation ? `
            <p class="innocent">
              <b>Ordinary explanation</b>
              ${escapeHtml(o.innocentExplanation)}
            </p>` : ""}
        </div>`).join("")
        : `<div class="card tone-clear">
             <div class="card-head"><strong>Nothing on the claim needs a second look.</strong></div>
             <p>This is not a guarantee of correctness — it means the deterministic rules did
                not raise anything.</p>
           </div>`}

      <h2>Outreach</h2>

      ${outreach ? (outreach.queued ? `
        <div class="card tone-watch">
          <div class="card-head">
            <strong>Tier ${escapeHtml(outreach.tier)} — ${escapeHtml(outreach.channel || "")}</strong>
            <span class="tag">${escapeHtml(outreach.status || "")}</span>
          </div>
          <p>${escapeHtml(outreach.note || "")}</p>
          <p class="limits">Queue #${escapeHtml(outreach.outreachId)}. Nothing is sent until a
             named person approves it.</p>
        </div>` : `
        <div class="card tone-clear">
          <div class="card-head"><strong>No approach queued.</strong></div>
          <p>${escapeHtml(outreach.reason || "")}</p>
          ${outreach.route ? `<p class="limits">Routed to ${escapeHtml(outreach.route)}.</p>` : ""}
        </div>`) : `<p class="note">Outreach was not evaluated for this claim.</p>`}
    `;
  }


  // =============================================
  // SCENE 6 — LEDGER
  // =============================================

  async function loadLedger() {

    try {

      const response = await fetch("/api/dashboard");
      const data = await response.json();

      $("tiles").innerHTML = `
        <div class="tile"><span>CLAIMS ASSESSED</span><strong data-t="${
          data.stats.claimsAnalyzed}">0</strong></div>
        <div class="tile"><span>NEED A LOOK</span><strong data-t="${
          data.stats.needsReview}">0</strong></div>
        <div class="tile"><span>AMOUNT TO REVIEW</span><strong data-t="${
          data.stats.reviewAmount}" data-money>0</strong></div>
        <div class="tile"><span>REPEATED LINE ITEMS</span><strong data-t="${
          data.stats.repeatedLineObservations}">0</strong></div>`;

      $("tiles").querySelectorAll("[data-t]").forEach((node) =>
        countUp(node, node.dataset.t,
                node.hasAttribute("data-money") ? money : undefined));

      $("ledgerBody").innerHTML = data.claims.length
        ? data.claims.map(ledgerRow).join("")
        : `<tr><td colspan="7" class="empty">Nothing assessed yet.</td></tr>`;

      $("ledgerBody").querySelectorAll("tr[data-id]").forEach((row) => {
        row.onclick = async () => {
          try {
            const one = await fetch(`/api/claims/${row.dataset.id}`);
            const claim = await one.json();
            state.result = claim;
            renderVerdict(claim);
            renderDossier(claim);
            renderRail();
            goto("verdict");
          } catch (error) {
            console.error("Could not open that claim:", error);
          }
        };
      });

    } catch (error) {
      $("ledgerBody").innerHTML =
        `<tr><td colspan="7" class="empty">The ledger could not be loaded: ${
          escapeHtml(error.message)}</td></tr>`;
    }
  }


  function ledgerRow(claim) {

    const v = claim.verification || {};
    const band = v.confidenceBand;
    const claimTone = LEVEL[claim.reviewLevel] || "unknown";

    return `
      <tr data-id="${escapeHtml(claim.id)}">
        <td class="claim-no">${escapeHtml(claim.claimNumber)}</td>
        <td>${escapeHtml(claim.providerName)}</td>
        <td class="num">${money(claim.totalBilled)}</td>
        <td>
          <span class="mini-band tone-${escapeHtml(claimTone)}">${
            escapeHtml(claim.reviewLevel)}</span>
          <span class="dash"> ${claim.reviewPriority}</span>
        </td>
        <td>${band
          ? `<span class="mini-band tone-${escapeHtml(toneForBand(band, v.blocking))}">${
              escapeHtml(band)}</span>`
          : `<span class="dash">—</span>`}</td>
        <td>${claim.routing
          ? escapeHtml(claim.routing.queue || "auto-process")
          : `<span class="dash">—</span>`}</td>
        <td class="num">${money(claim.reviewAmount)}</td>
      </tr>`;
  }


  // =============================================
  // COVER — what is actually live
  // =============================================

  async function loadCoverage() {

    try {
      const response = await fetch("/api/verification/coverage");
      const coverage = await response.json();

      const pct = coverage.completeness != null
        ? Math.round(coverage.completeness * 100) : null;

      $("coverCoverage").textContent =
        pct == null
          ? "Coverage is not being reported."
          : `Coverage ${pct}% · live: ${(coverage.checked || []).join(", ") || "nothing"}` +
            ((coverage.skipped || []).length
              ? ` · not checked: ${(coverage.skipped || [])
                  .map((s) => s.label || s.id).join(", ")}`
              : "");

    } catch (error) {
      $("coverCoverage").textContent =
        "Could not reach the API — is the server running on :3000?";
    }
  }


  // =============================================
  // BOOT
  // =============================================

  document.querySelectorAll(".scene").forEach((scene) => {
    if (scene.dataset.scene !== state.scene) scene.setAttribute("inert", "");
  });

  el(`.scene[data-scene="${state.scene}"]`).classList.add("is-active");

  renderRail();
  renderSubjects();
  enterScene(state.scene);
  loadCoverage();

  $("runBtn").onclick = run;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    document.querySelectorAll(".reveal:not(.is-in)").forEach((node) => {
      if (node.closest(".scene.is-active")) node.classList.add("is-in");
    });
  });

})();
