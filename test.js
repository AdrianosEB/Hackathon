// =============================================
// Test bench — front end
//
// Deliberately plain. It posts to one endpoint per
// subject and prints what comes back, stage by stage.
// It computes nothing itself: every number on screen
// came from the server, so what you read here is what
// the pipeline actually produced.
// =============================================

const $ = (id) => document.getElementById(id);

let SUBJECTS = null;


async function loadSubjects() {

  SUBJECTS = await (await fetch("/api/test/subjects")).json();

  const pick = $("companyPick");

  pick.innerHTML = SUBJECTS.companies
    .map((c) => `<option value="${c.key}">${escapeHtml(c.label)}</option>`)
    .join("");

  pick.onchange = showExpectation;
  showExpectation();

  if (!SUBJECTS.secConfigured) {
    $("meta-company").innerHTML =
      '<span class="warn">SEC_CONTACT_EMAIL is not set — EDGAR will refuse.</span>';
  }

}


function showExpectation() {
  const key = $("companyPick").value;
  const entry = SUBJECTS.companies.find((c) => c.key === key);
  $("companyExpect").textContent = entry ? `Expect: ${entry.expect}` : "";
}


// =============================================
// Run
// =============================================

document.querySelectorAll("[data-run]").forEach((button) => {

  button.onclick = async () => {

    const kind = button.dataset.run;
    const meta = $(`meta-${kind}`);

    document.querySelectorAll("[data-run]").forEach((b) => (b.disabled = true));
    meta.innerHTML = '<span class="running">running…</span>';

    $("stages").innerHTML =
      '<p class="muted">Running. The agent stage takes ten to twenty seconds — that is the ' +
      'model, not the network.</p>';
    $("verdict").classList.add("hidden");

    const startedAt = Date.now();

    try {

      // Without this the agent stage is a cache hit and
      // costs nothing, which hides the very thing this
      // page exists to show.
      if ($("forceFresh").checked && kind !== "company") {
        await fetch("/api/test/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
      }

      const body = kind === "company" ? { key: $("companyPick").value } : {};

      const response = await fetch(`/api/test/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      meta.innerHTML = `<span class="ok">${Date.now() - startedAt} ms total</span>`;

      renderVerdict(data);
      renderStages(data);

    } catch (error) {

      meta.innerHTML = `<span class="warn">failed</span>`;
      $("stages").innerHTML =
        `<p class="error-inline">${escapeHtml(error.message)}</p>`;

    } finally {

      document.querySelectorAll("[data-run]").forEach((b) => (b.disabled = false));

    }

  };

});


// =============================================
// Verdict — the two axes, side by side
// =============================================

function renderVerdict(data) {

  const box = $("verdict");
  box.classList.remove("hidden");

  const v = data.verdict;

  const claim = v.claimAxis
    ? `<div class="vax">
         <span class="vax-l">CLAIM AXIS</span>
         <span class="vax-n">${v.claimAxis.priority}<i>/100</i></span>
         <span class="badge level-${escapeHtml(v.claimAxis.level)}">
           ${escapeHtml(v.claimAxis.level)}
         </span>
         <span class="vax-s">${v.claimAxis.observations} observation(s)</span>
       </div>`
    : `<div class="vax vax-empty">
         <span class="vax-l">CLAIM AXIS</span>
         <span class="vax-n">—</span>
         <span class="vax-s">no claim in this subject</span>
       </div>`;

  const p = v.providerAxis;

  const provider = `
    <div class="vax">
      <span class="vax-l">${data.subjectType === "company" ? "COMPANY" : "PROVIDER"} AXIS</span>
      <span class="vax-n">${p.score ?? "—"}${p.score == null ? "" : "<i>/100</i>"}</span>
      <span class="badge band-${escapeHtml(p.band || "incomplete")}">
        ${escapeHtml(p.band || "not run")}
      </span>
      ${p.blocking ? '<span class="badge blocking-chip">blocking</span>' : ""}
    </div>`;

  const routing = v.routing
    ? `<div class="vroute">
         <b>${escapeHtml(v.routing.headline || "")}</b>
         <span class="chip">${escapeHtml((v.routing.decision || "").replace(/_/g, " "))}</span>
         ${v.routing.queue ? `<span class="chip">→ ${escapeHtml(v.routing.queue)}</span>` : ""}
       </div>`
    : v.note
      ? `<p class="vnote">${escapeHtml(v.note)}</p>`
      : "";

  box.innerHTML = `<div class="vaxes">${claim}${provider}</div>${routing}`;

}


// =============================================
// Stages
// =============================================

function renderStages(data) {

  const totalAgent = data.stages
    .filter((s) => s.kind === "agentic")
    .reduce((sum, s) => sum + s.durationMs, 0);

  const totalDet = data.stages
    .filter((s) => s.kind === "deterministic")
    .reduce((sum, s) => sum + s.durationMs, 0);

  const split = `
    <p class="split">
      <b>${data.stages.length} stages.</b>
      Deterministic work: <b>${totalDet} ms</b> across
      ${data.stages.filter((s) => s.kind === "deterministic").length} stages.
      Agent work: <b>${totalAgent} ms</b> across
      ${data.stages.filter((s) => s.kind === "agentic").length}.
      Everything slow is the model.
    </p>`;

  $("stages").innerHTML = split + data.stages.map(stageCard).join("");

  document.querySelectorAll(".stage details").forEach((d, i) => {
    // First stage open, so the page shows something at rest.
    if (i === 0) d.open = true;
  });

}


function stageCard(stage) {

  return `
    <article class="stage stage-${stage.kind}${stage.failed ? " stage-failed" : ""}">

      <header>
        <span class="k k-${stage.kind === "agentic" ? "ag" : "det"}"
              title="${stage.kind}">${stage.kind === "agentic" ? "A" : "D"}</span>
        <span class="sn">${stage.n}</span>
        <b>${escapeHtml(stage.title)}</b>
        <code>${escapeHtml(stage.fn)}</code>
        <span class="dur">${stage.durationMs} ms</span>
      </header>

      <p class="what">${escapeHtml(stage.what)}</p>

      <details>
        <summary>Raw output</summary>
        <pre>${escapeHtml(JSON.stringify(stage.output, null, 2))}</pre>
      </details>

    </article>`;

}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
  })[c]);
}


loadSubjects();
