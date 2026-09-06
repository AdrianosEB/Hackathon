// =============================================
// Appeal text analysis — client
// =============================================

const $ = (id) => document.getElementById(id);

const state = {
  blueprint: null,
  report: null,
  aiAvailable: false,
  revealTimers: []
};


// =============================================
// Claim record
// =============================================

function addLine(values = {}) {
  const row = document.createElement("div");
  row.className = "line-row";
  row.innerHTML = `
    <input class="l-code" type="text" placeholder="99213" value="${values.code || ""}" />
    <input class="l-date" type="text" placeholder="2025-01-03" value="${values.serviceDate || ""}" />
    <input class="l-units" type="text" placeholder="1" value="${values.units ?? ""}" />
    <input class="l-amount" type="text" placeholder="230.00" value="${values.amount ?? ""}" />
    <button class="drop-line" type="button" aria-label="Remove line">&times;</button>
  `;

  row.querySelector(".drop-line").addEventListener("click", () => {
    row.remove();
    updateMeter();
  });

  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", updateMeter);
  });

  $("claimLines").appendChild(row);
}


function readClaim() {
  const lineItems = [...document.querySelectorAll("#claimLines .line-row")]
    .map((row) => ({
      code: row.querySelector(".l-code").value.trim(),
      serviceDate: row.querySelector(".l-date").value.trim(),
      units: Number(row.querySelector(".l-units").value || 1),
      amount: Number(row.querySelector(".l-amount").value || 0)
    }))
    .filter((item) => item.code || item.amount);

  const claim = {
    claimNumber: $("cClaimNumber").value.trim(),
    providerName: $("cProvider").value.trim(),
    patientLabel: $("cPatient").value.trim(),
    clinicalNote: $("cNote").value.trim(),
    diagnosisCodes: $("cDiagnosis").value
      .split(/[,\s]+/)
      .map((code) => code.trim())
      .filter(Boolean),
    lineItems
  };

  const anything =
    lineItems.length > 0 ||
    claim.claimNumber ||
    claim.providerName ||
    claim.patientLabel;

  return anything ? claim : null;
}


function loadClaim(claim) {
  $("claimLines").innerHTML = "";

  $("cClaimNumber").value = claim?.claimNumber || "";
  $("cProvider").value = claim?.providerName || "";
  $("cPatient").value = claim?.patientLabel || "";
  $("cNote").value = claim?.clinicalNote || "";
  $("cDiagnosis").value = (claim?.diagnosisCodes || []).join(", ");

  for (const item of claim?.lineItems || []) {
    addLine(item);
  }
}


// =============================================
// Live meter — the same tier thresholds triage
// uses on the server, so the plan shown before
// you press the button is the plan that runs.
// =============================================

const TIERS = [
  { id: "insufficient", label: "Insufficient", max: 39 },
  { id: "brief", label: "Brief", max: 149 },
  { id: "standard", label: "Standard", max: 599 },
  { id: "long", label: "Long", max: 1499 },
  { id: "extended", label: "Extended", max: Infinity }
];


function countWords(text) {
  const matches = text.match(/[A-Za-z0-9$%'’./-]+/g);
  return matches ? matches.length : 0;
}


function updateMeter() {
  const text = $("appealText").value;
  const trimmed = text.trim();

  const words = countWords(trimmed);

  const paragraphs = trimmed
    ? trimmed.split(/\n[ \t]*\n+/).filter((block) => block.trim()).length ||
      trimmed.split(/\n+/).filter((block) => block.trim()).length
    : 0;

  // Split only on terminal punctuation followed by
  // whitespace, so "$1,200.50" is not a sentence end.
  const sentences = trimmed
    ? trimmed.split(/(?<=[.!?])\s+/).filter((part) => part.trim()).length
    : 0;

  // Dates are stripped first so their digit groups are
  // not counted as separate figures.
  const withoutDates = trimmed
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ");

  const figures = trimmed
    ? (withoutDates.match(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\b/g) || [])
        .length
    : 0;

  const claim = readClaim();
  const lineCount = claim ? claim.lineItems.length : 0;

  $("mLines").textContent = lineCount;

  const total = (claim?.lineItems || []).reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  $("claimTotal").innerHTML = lineCount
    ? `${lineCount} billed line(s), total <strong>$${total.toFixed(2)}</strong> — the cross-check stage will compare the appeal against this.`
    : "No billed lines — the cross-check stage will be skipped.";

  $("mWords").textContent = words;
  $("mSentences").textContent = sentences;
  $("mParagraphs").textContent = paragraphs;
  $("mFigures").textContent = figures;

  const tier = TIERS.find((candidate) => words <= candidate.max);

  const chunks =
    tier.id === "long" || tier.id === "extended"
      ? Math.max(1, Math.ceil(words / 420))
      : 1;

  const skipped = [];

  if (tier.id === "insufficient") {
    skipped.push("language audit");
  }

  if (figures === 0) {
    skipped.push("figure audit");
  }

  if (lineCount === 0) {
    skipped.push("claim audit", "cross-check");
  }

  const activeCount = 5 - new Set(skipped).size;

  $("meterPlan").innerHTML = words === 0
    ? "Triage will classify this as <strong>—</strong>"
    : `Triage will classify this as <strong>${tier.label}</strong> ` +
      `→ <strong>${chunks}</strong> chunk(s), <strong>${activeCount}</strong> of 5 specialists` +
      (skipped.length > 0
        ? `, skipping <strong>${[...new Set(skipped)].join(", ")}</strong>`
        : "") +
      ".";
}


// =============================================
// Blueprint (static orchestration)
// =============================================

async function loadBlueprint() {
  try {
    const response = await fetch("/api/appeal/orchestration");
    const data = await response.json();

    state.blueprint = data.orchestration;
    state.aiAvailable = data.aiAvailable;

    const aiState = $("aiState");

    if (data.aiAvailable) {
      aiState.textContent = `AI layer live · ${data.provider} · ${data.model}`;
      aiState.className = "ai-state live";
    } else {
      aiState.textContent = "AI layer off · no API key · rules only";
      aiState.className = "ai-state off";
      $("useAi").checked = false;
      $("useAi").disabled = true;
    }

    renderWaves(null);
  } catch (error) {
    $("aiState").textContent = "orchestration blueprint unavailable";
  }
}


// =============================================
// Pipeline rendering
//
// With no report: the static blueprint.
// With a report: real per-agent status, finding
// counts, and measured durations, revealed in
// wave order.
// =============================================

function renderWaves(report) {
  const blueprint = state.blueprint;

  if (!blueprint) {
    return;
  }

  const container = $("waves");
  container.innerHTML = "";

  state.revealTimers.forEach((timer) => clearTimeout(timer));
  state.revealTimers = [];

  const runsByStage = new Map();

  for (const run of report ? report.stageRuns : []) {
    if (!runsByStage.has(run.stage)) {
      runsByStage.set(run.stage, []);
    }

    runsByStage.get(run.stage).push(run);
  }

  const orders = [...new Set(blueprint.stages.map((stage) => stage.order))].sort();
  let revealIndex = 0;

  for (const order of orders) {
    const stages = blueprint.stages.filter((stage) => stage.order === order);
    const parallel = stages.length > 1;

    const block = document.createElement("div");
    block.className = "wave";
    block.innerHTML = `
      <div class="wave-head">
        <span class="wave-index">Stage ${order}</span>
        <span class="wave-title">${stages.map((stage) => stage.name).join(" · ")}</span>
        <span class="wave-mode">${parallel ? "parallel" : "sequential"}</span>
      </div>
      <div class="agent-grid"></div>
    `;

    const grid = block.querySelector(".agent-grid");

    for (const stage of stages) {
      const runs = runsByStage.get(stage.id) || [];

      if (report && runs.length > 0) {
        for (const run of runs) {
          grid.appendChild(stageCard(stage, run, revealIndex));
          revealIndex += 1;
        }
      } else {
        grid.appendChild(stageCard(stage, null, revealIndex));
        revealIndex += 1;
      }
    }

    container.appendChild(block);
  }

  if (!report) {
    container
      .querySelectorAll(".agent-card")
      .forEach((card) => card.classList.add("revealed"));

    $("pipelineNote").textContent =
      "Nothing has run yet — the plan below is the static blueprint.";
  }
}


function stageCard(stage, run, revealIndex) {
  const card = document.createElement("div");
  const status = run ? run.status : "planned";

  card.className = `agent-card ${status}${stage.conditional ? " conditional" : ""}`;
  card.dataset.reveal = String(revealIndex);

  const layerClass = run
    ? run.layer === "ai"
      ? "ai"
      : "rules"
    : stage.layer === "AI"
      ? "ai"
      : "rules";

  const layerText = run ? (run.layer === "ai" ? "AI" : "rules") : stage.layer;

  const meta = run
    ? `
        <span class="badge ${layerClass}">${layerText}</span>
        <span>${run.findingCount} finding(s)</span>
        <span>${run.durationMs} ms</span>
        ${run.chunkLabel ? `<span>${run.chunkLabel}</span>` : ""}
      `
    : `<span class="badge ${layerClass}">${layerText}</span><span>${stage.scope}</span>`;

  card.innerHTML = `
    <div class="agent-top">
      <span class="agent-name">${run ? run.name : stage.name}</span>
      <span class="agent-status">${status}</span>
    </div>
    <div class="agent-meta">${meta}</div>
    <div class="agent-note">${run ? run.note || "" : stage.question || ""}</div>
  `;

  return card;
}


function revealPipeline() {
  const cards = [...$("waves").querySelectorAll(".agent-card")];
  const step = Math.max(40, Math.min(140, 1400 / Math.max(1, cards.length)));

  cards.forEach((card, index) => {
    const timer = setTimeout(() => {
      card.classList.add("revealed");
    }, index * step);

    state.revealTimers.push(timer);
  });
}


// =============================================
// Analysis
// =============================================

async function analyze() {
  const text = $("appealText").value;

  if (!text.trim()) {
    showError("Paste some appeal text first.");
    return;
  }

  showError(null);

  const button = $("analyzeBtn");
  button.disabled = true;
  button.textContent = "Running agents…";

  try {
    const response = await fetch("/api/appeal/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        claim: readClaim(),
        useAi: $("useAi").checked
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Analysis failed.");
    }

    state.report = data.report;
    renderReport(data.report);
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Run the orchestration";
  }
}


function showError(message) {
  const line = $("errorLine");

  if (!message) {
    line.hidden = true;
    line.textContent = "";
    return;
  }

  line.hidden = false;
  line.textContent = message;
}


// =============================================
// Report rendering
// =============================================

function renderReport(report) {
  $("verdictPanel").hidden = false;
  $("outputPanel").hidden = false;

  const ring = $("scoreRing");
  ring.style.setProperty("--ring", report.integrityScore);
  ring.style.setProperty(
    "--ring-color",
    report.integrityScore >= 85
      ? "var(--green)"
      : report.integrityScore >= 60
        ? "var(--yellow)"
        : "var(--red)"
  );

  $("scoreValue").textContent = report.integrityScore;
  $("verdictLabel").textContent = report.verdict.label;
  $("verdictSummary").textContent = report.verdict.summary;

  const metrics = report.triage.metrics;

  $("verdictChips").innerHTML = [
    chip(`${metrics.wordCount} words`, ""),
    chip(`${report.triage.tier.label} tier`, ""),
    chip(`${report.triage.chunkCount} chunk(s)`, ""),
    chip(`${report.counts.bySeverity.high} high`, "high"),
    chip(`${report.counts.bySeverity.medium} medium`, "medium"),
    chip(`${report.counts.bySeverity.low} low`, "low"),
    chip(
      `${report.documentation.completeness.requiredPresent}/${report.documentation.completeness.requiredTotal} required docs`,
      report.documentation.completeness.percentComplete === 100 ? "good" : "high"
    ),
    chip(`${report.requests.length} question(s)`, ""),
    chip(`${report.totalDurationMs} ms total`, ""),
    report.claim
      ? chip(
          `claim ${report.claim.lineCount} line(s) · $${report.claim.totalBilled.toFixed(2)}`,
          ""
        )
      : chip("no claim record", "medium"),
    chip(`score from ${report.scoredFindingCount} deterministic finding(s)`, ""),
    report.counts.corroborated > 0
      ? chip(`${report.counts.corroborated} corroborated by both layers`, "good")
      : "",
    report.aiLayer.enabled && report.aiLayer.errors.length > 0
      ? chip(`AI layer failed: ${report.aiLayer.errors[0]}`, "high")
      : "",
    report.aiLayer.enabled && report.aiLayer.errors.length === 0
      ? chip(
          report.aiLayer.findingCount > 0
            ? `${report.aiLayer.findingCount} AI question source(s)`
            : "AI stage skipped",
          ""
        )
      : ""
  ].join("");

  $("pipelineNote").textContent =
    `${report.stageRuns.filter((run) => run.status === "done").length} stage run(s) completed, ` +
    `${report.stageRuns.filter((run) => run.status === "skipped").length} skipped · ` +
    `${report.totalDurationMs} ms · replayed in stage order with measured durations`;

  renderWaves(report);
  revealPipeline();

  renderFindings(report);
  renderCrossCheck(report);
  renderAnnotated(report);
  renderDocumentation(report);
  renderQuestions(report);
  renderBlueprintTab(report);

  $("tab-json").innerHTML = `<div class="json-dump">${escapeHtml(
    JSON.stringify(report, null, 2)
  )}</div>`;
}


function chip(label, tone) {
  return label ? `<span class="chip ${tone}">${label}</span>` : "";
}


// =============================================
// Findings tab
// =============================================

function renderFindings(report) {
  const container = $("tab-findings");

  if (report.findings.length === 0) {
    container.innerHTML = `<p class="empty-note">
      No findings. Every figure reconciled, no unsupported language was detected,
      and the documentation checklist is satisfied.
    </p>`;
    return;
  }

  const byId = new Map(report.findings.map((finding) => [finding.id, finding]));

  container.innerHTML = report.sections
    .map((section) => {
      const cards = section.findingIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(findingCard)
        .join("");

      return `
        <div class="theme-group">
          <div class="theme-head">
            <h3>${section.theme}</h3>
            <span class="chip ${section.highest}">${section.count} finding(s)</span>
          </div>
          ${cards}
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".instance-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const list = button.nextElementSibling;
      list.hidden = !list.hidden;
      button.textContent = list.hidden
        ? button.dataset.showLabel
        : "Hide instances";
    });
  });
}


function findingCard(finding) {
  const layer = finding.detectedBy.includes("ai")
    ? finding.detectedBy.includes("rules")
      ? { cls: "both", label: "rules + AI" }
      : { cls: "ai", label: "AI" }
    : { cls: "rules", label: "rules" };

  const paragraph =
    finding.paragraphIndex === null
      ? "whole appeal"
      : `paragraph ${finding.paragraphIndex + 1}`;

  const instances = finding.instances
    ? `
        <button
          class="instance-toggle"
          data-show-label="Show ${finding.instances.length} more instance(s)"
          type="button"
        >Show ${finding.instances.length} more instance(s)</button>
        <ul class="instance-list" hidden>
          ${finding.instances
            .map(
              (instance) =>
                `<li>${
                  instance.paragraph ? `¶${instance.paragraph}: ` : ""
                }<span class="finding-quote">${escapeHtml(
                  instance.quote || ""
                )}</span></li>`
            )
            .join("")}
        </ul>
      `
    : "";

  return `
    <div class="finding-card ${finding.severity}" id="finding-${escapeHtml(
      finding.id
    )}">
      <div class="finding-top">
        <span class="finding-category">${finding.category.replace(/_/g, " ")}</span>
        <span class="chip ${finding.severity}">${finding.severity}</span>
        <span class="badge ${layer.cls}">${layer.label}</span>
        <span class="badge">${finding.agent}</span>
        <span class="badge">${paragraph}</span>
        <span class="badge">conf ${finding.confidence.toFixed(2)}</span>
      </div>

      <p class="finding-message">${escapeHtml(finding.message)}</p>

      ${
        finding.quote
          ? `<span class="finding-quote">${escapeHtml(finding.quote)}</span>`
          : ""
      }

      ${
        finding.evidence
          ? `<p class="finding-evidence">${escapeHtml(finding.evidence)}</p>`
          : ""
      }

      ${
        finding.aiNote
          ? `<p class="finding-evidence">AI adds: ${escapeHtml(finding.aiNote)}</p>`
          : ""
      }

      ${instances}

      ${
        finding.ask
          ? `<div class="finding-ask">Ask: ${escapeHtml(finding.ask)}</div>`
          : ""
      }
    </div>
  `;
}


// =============================================
// Annotated text tab
//
// Overlapping highlights are resolved by sweeping
// the boundary points, so a span flagged by two
// agents is marked once at the higher severity.
// =============================================

function renderAnnotated(report) {
  const text = report.text;
  const highlights = report.highlights;

  const boundaries = new Set([0, text.length]);

  for (const highlight of highlights) {
    boundaries.add(highlight.start);
    boundaries.add(highlight.end);
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const rank = { low: 1, medium: 2, high: 3 };

  let body = "";

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];

    if (to <= from) {
      continue;
    }

    const active = highlights.filter(
      (highlight) => highlight.start <= from && highlight.end >= to
    );

    const segment = escapeHtml(text.slice(from, to));

    if (active.length === 0) {
      body += segment;
      continue;
    }

    const worst = active.reduce(
      (a, b) => (rank[b.severity] > rank[a.severity] ? b : a),
      active[0]
    );

    const tooltip = active
      .map((highlight) => `${highlight.agent}: ${highlight.message}`)
      .join("\n");

    body += `<span
      class="mark ${worst.severity}"
      data-finding="${escapeHtml(worst.id)}"
      title="${escapeHtml(tooltip)}"
    >${segment}</span>`;
  }

  $("tab-annotated").innerHTML = `
    <div class="legend">
      <span><span class="swatch" style="background:var(--red)"></span>high</span>
      <span><span class="swatch" style="background:var(--yellow)"></span>medium</span>
      <span><span class="swatch" style="background:var(--blue)"></span>low</span>
      <span>${highlights.length} marked span(s) — hover for the reason, click to jump to the finding</span>
    </div>
    <div class="annotated">${body}</div>
  `;

  $("tab-annotated")
    .querySelectorAll(".mark")
    .forEach((mark) => {
      mark.addEventListener("click", () => {
        switchTab("findings");

        const card = document.getElementById(`finding-${mark.dataset.finding}`);

        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("flash");
          setTimeout(() => card.classList.remove("flash"), 1600);
        }
      });
    });
}


// =============================================
// Claim cross-check tab
// =============================================

function renderCrossCheck(report) {
  const container = $("tab-crosscheck");

  if (!report.claim) {
    container.innerHTML = `<p class="empty-note">
      No claim record was supplied, so there was nothing to check the appeal against.
      Fill in the claim panel to enable this stage.
    </p>`;
    return;
  }

  const summary = `
    <div class="claim-summary">
      <span>Billed lines <strong>${report.claim.lineCount}</strong></span>
      <span>Total billed <strong>$${report.claim.totalBilled.toFixed(2)}</strong></span>
      <span>Under review <strong>$${report.claim.reviewAmount.toFixed(2)}</strong></span>
      <span>Claim risk <strong>${report.claim.riskLevel}</strong> (${report.claim.riskScore})</span>
      <span>Codes <strong>${report.claim.codes.join(", ") || "—"}</strong></span>
      <span>Service dates <strong>${report.claim.serviceDates.join(", ") || "—"}</strong></span>
    </div>
  `;

  const findings = report.findings.filter(
    (finding) => finding.agent === "crosscheck" || finding.agent === "claim"
  );

  if (findings.length === 0) {
    container.innerHTML = `${summary}<p class="empty-note">
      The appeal describes this claim consistently — every figure, code, and date in the
      text resolves against what was billed, and the claim lines raised no rule findings.
    </p>`;
    return;
  }

  container.innerHTML = summary + findings.map(findingCard).join("");
}


// =============================================
// Documentation tab
// =============================================

function renderDocumentation(report) {
  const { completeness, checklist } = report.documentation;

  const rows = checklist
    .map(
      (item) => `
        <div class="doc-row ${item.status} ${item.tier}">
          <div class="doc-mark">${item.status === "present" ? "✓" : "✕"}</div>
          <div>
            <div class="doc-label">${item.label}</div>
            <div class="doc-tier">${item.tier}${
              item.source ? ` · from ${item.source}` : ""
            }</div>
          </div>
          <div class="doc-detail">${escapeHtml(
            item.status === "present" ? item.evidence || "Present." : item.ask
          )}</div>
        </div>
      `
    )
    .join("");

  $("tab-documentation").innerHTML = `
    <div class="doc-summary">
      <span>Required present: <strong>${completeness.requiredPresent} / ${completeness.requiredTotal}</strong></span>
      <span>Recommended present: <strong>${completeness.recommendedPresent} / ${completeness.recommendedTotal}</strong></span>
      <span>Required completeness: <strong>${completeness.percentComplete}%</strong></span>
    </div>
    <div class="doc-grid">${rows}</div>
  `;
}


// =============================================
// Questions tab
// =============================================

function renderQuestions(report) {
  const container = $("tab-questions");

  if (report.requests.length === 0) {
    container.innerHTML = `<p class="empty-note">
      Nothing to ask — no finding produced an outstanding information request.
    </p>`;
    return;
  }

  const cards = report.requests
    .map(
      (request) => `
        <div class="question-card ${request.blocking ? "blocking" : ""}">
          <div class="question-priority">${request.priority}</div>
          <div>
            <p class="question-text">${escapeHtml(request.question)}</p>
            <p class="question-basis">Because: ${escapeHtml(request.basis)}</p>
            <div class="question-meta">
              <span class="chip ${request.severity}">${request.severity}</span>
              <span class="badge">${request.theme}</span>
              ${
                request.blocking
                  ? '<span class="badge" style="color:var(--red)">blocks adjudication</span>'
                  : ""
              }
              ${
                request.paragraph
                  ? `<span class="badge">¶${request.paragraph}</span>`
                  : ""
              }
              <span class="badge">conf ${request.confidence.toFixed(2)}</span>
            </div>
          </div>
        </div>
      `
    )
    .join("");

  container.innerHTML = `
    <div class="question-actions">
      <button class="secondary" id="copyQuestions" type="button">
        Copy as a request list
      </button>
      <span class="muted" id="copyState"></span>
    </div>
    ${cards}
  `;

  $("copyQuestions").addEventListener("click", async () => {
    const lines = report.requests.map(
      (request) =>
        `${request.priority}. ${request.question}${
          request.blocking ? "  [required before review]" : ""
        }`
    );

    const body = [
      `Information required before this appeal can be reviewed`,
      `Verdict: ${report.verdict.label}`,
      "",
      ...lines
    ].join("\n");

    try {
      await navigator.clipboard.writeText(body);
      $("copyState").textContent = "Copied.";
    } catch (error) {
      $("copyState").textContent = "Copy failed — select the text manually.";
    }

    setTimeout(() => {
      $("copyState").textContent = "";
    }, 2200);
  });
}


// =============================================
// Agent reference tab
// =============================================

function renderBlueprintTab(report) {
  const blueprint = state.blueprint;

  if (!blueprint) {
    return;
  }

  const planRows = report
    ? report.triage.plan
        .map(
          (planned) => `
            <tr>
              <td>${planned.name}</td>
              <td>${planned.run ? "ran" : "skipped"}</td>
              <td>${escapeHtml(planned.reason)}</td>
            </tr>
          `
        )
        .join("")
    : "";

  $("tab-blueprint").innerHTML = `
    <p class="empty-note">${escapeHtml(blueprint.scope)}</p>

    ${
      report
        ? `<div class="subhead">Stage decisions for this run</div>
           <table class="tier-table">
             <thead><tr><th>Stage</th><th>Outcome</th><th>Reason</th></tr></thead>
             <tbody>${planRows}</tbody>
           </table>`
        : ""
    }

    <div class="subhead">Length tiers</div>
    <table class="tier-table">
      <thead><tr><th>Tier</th><th>Range</th><th>What changes</th></tr></thead>
      <tbody>
        ${blueprint.tiers
          .map(
            (tier) => `
              <tr>
                <td>${tier.id}</td>
                <td>${tier.range}</td>
                <td>${escapeHtml(tier.effect)}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>

    <div class="subhead">Stages</div>
    ${blueprint.stages
      .map(
        (stage) => `
          <div class="blueprint-agent">
            <h4>Stage ${stage.order} · ${stage.name}
              <span class="badge">${stage.scope}</span>
              <span class="badge ${stage.layer === "AI" ? "ai" : "rules"}">${stage.layer}</span>
              ${stage.conditional ? '<span class="badge" style="color:var(--yellow)">conditional</span>' : ""}
            </h4>
            <p class="blueprint-question">${escapeHtml(stage.question)}</p>
            <ul>${stage.does.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </div>
        `
      )
      .join("")}

    <div class="subhead">Scoring</div>
    <div class="blueprint-agent">
      <ul>
        <li>${escapeHtml(blueprint.scoring.formula)}</li>
        <li>${escapeHtml(blueprint.scoring.normalisation)}</li>
        <li>${escapeHtml(blueprint.scoring.aiPolicy)}</li>
      </ul>
    </div>
  `;
}


// =============================================
// Tabs
// =============================================

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });

  document.querySelectorAll(".tab-body").forEach((body) => {
    body.hidden = body.id !== `tab-${name}`;
  });
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// =============================================
// Wiring
// =============================================

$("appealText").addEventListener("input", updateMeter);
$("analyzeBtn").addEventListener("click", analyze);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

document.querySelectorAll("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => {
    const sample = window.APPEAL_SAMPLES[button.dataset.sample];

    if (!sample) {
      return;
    }

    loadClaim(sample.claim);
    $("appealText").value = sample.text;
    updateMeter();
    showError(null);
  });
});

$("addLine").addEventListener("click", () => addLine());

["cClaimNumber", "cProvider", "cPatient", "cDiagnosis", "cNote"].forEach((id) => {
  $(id).addEventListener("input", updateMeter);
});

$("appealText").addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    analyze();
  }
});

updateMeter();
loadBlueprint();
