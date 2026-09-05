// =============================================
// Claim Integrity — front end
//
// Renders TWO axes and never merges them.
//
//   claim axis     reviewPriority / reviewLevel /
//                  observations
//   provider axis  dataConfidenceScore /
//                  confidenceBand / checks
//
// Collapsing them into one number is the thing the
// backend deliberately refuses to do, so the UI must
// not quietly do it either: a claim with billing
// observations from a well-matched provider and an
// ordinary claim from a provider we could not match
// are completely different problems.
//
// Vocabulary rules apply here too. Nothing on this
// page concludes fraud. Bands describe the state of
// the evidence, not the character of a provider.
// =============================================

const $ = (id) => document.getElementById(id);

const lineItems = $("lineItems");


// =============================================
// Claim line items
// =============================================

function addLine(data = {}) {

  const row = document.createElement("div");
  row.className = "line-item";

  row.innerHTML = `
    <label>Code
      <input data-field="code" placeholder="99213" value="${escapeHtml(data.code || "")}">
    </label>
    <label>Description
      <input data-field="description" placeholder="Office visit"
             value="${escapeHtml(data.description || "")}">
    </label>
    <label>Date
      <input data-field="serviceDate" type="date"
             value="${escapeHtml(data.serviceDate || "")}">
    </label>
    <label>Units
      <input data-field="units" type="number" min="1" value="${data.units || 1}">
    </label>
    <label>Amount
      <input data-field="amount" type="number" min="0" step="0.01" placeholder="110"
             value="${data.amount ?? ""}">
    </label>
    <button type="button" class="remove-btn" title="Remove">×</button>
  `;

  row.querySelector(".remove-btn").onclick = () => {
    if (lineItems.children.length > 1) {
      row.remove();
    }
  };

  lineItems.appendChild(row);

}

$("addLineBtn").onclick = () => addLine();

addLine();


// =============================================
// Demo scenarios
//
// Every NPI starts with 9 — a range CMS has never
// assigned — so no real provider can be implicated.
// These resolve against the local fixture registry
// on :3101 and the fixture practice sites on :3102.
// =============================================

const SCENARIOS = [

  {
    name: "1 · Clean provider — registry corroborates",
    expect: "identity match · no outreach · auto-process",
    claim: {
      providerName: "Riverbend Family Medicine",
      npi: "9000000015",
      practiceWebsite: "http://localhost:3102/riverbend",
      practiceAddressLine1: "4120 SE Hawthorne Blvd",
      practiceCity: "Portland",
      practiceState: "OR",
      practicePhone: "503-555-0118",
      patientLabel: "Patient A",
      diagnosisCodes: ["J06.9"],
      clinicalNote:
        "Established patient seen for upper respiratory symptoms of four days duration. " +
        "Afebrile, chest clear on auscultation. Supportive care advised, return " +
        "precautions given.",
      lineItems: [
        { code: "99213", description: "Office visit, established patient",
          serviceDate: "2026-08-14", units: 1, amount: 112.00 }
      ]
    }
  },

  {
    name: "2 · Repeated line items — a coding question",
    expect: "claim axis rises, provider record still matches — this is a coding review, not a call",
    claim: {
      providerName: "Riverbend Family Medicine",
      npi: "9000000015",
      practiceWebsite: "http://localhost:3102/riverbend",
      practiceAddressLine1: "4120 SE Hawthorne Blvd",
      practiceCity: "Portland",
      practiceState: "OR",
      practicePhone: "503-555-0118",
      patientLabel: "Patient A",
      diagnosisCodes: ["R10.9"],
      clinicalNote: "Abdominal pain. Imaging ordered.",
      lineItems: [
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-09-01", units: 1, amount: 1850 },
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-09-01", units: 1, amount: 1850 },
        { code: "99215", description: "Office visit, high complexity",
          serviceDate: "2026-09-01", units: 1, amount: 620 }
      ]
    }
  },

  {
    name: "3 · Stale address — a practice that moved",
    expect: "ordinary administrative drift; NPPES addresses are self-reported and often old",
    claim: {
      providerName: "Cascade Imaging Partners",
      npi: "9000000023",
      practiceWebsite: "http://localhost:3102/cascade",
      practiceAddressLine1: "1500 Denny Way Ste 410",
      practiceCity: "Seattle",
      practiceState: "WA",
      practicePhone: "206-555-0142",
      patientLabel: "Patient B",
      diagnosisCodes: ["R10.9"],
      clinicalNote:
        "Abdominal pain, non-localised. CT abdomen and pelvis with contrast ordered to " +
        "exclude acute intra-abdominal pathology.",
      lineItems: [
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-08-19", units: 1, amount: 470.00 }
      ]
    }
  },

  {
    name: "4 · Deactivated NPI — blocking, nobody is called",
    expect: "held for provider data review · outreach refuses: there is no verified party to contact",
    claim: {
      providerName: "Summit Care Group",
      npi: "9000000031",
      practiceAddressLine1: "15 Commerce Way",
      practiceCity: "Tempe",
      practiceState: "AZ",
      practicePhone: "480-555-0177",
      patientLabel: "Patient C",
      diagnosisCodes: ["M54.5"],
      clinicalNote: "Lower back pain, ongoing. Conservative management continued.",
      lineItems: [
        { code: "99214", description: "Office visit, moderate complexity",
          serviceDate: "2026-08-20", units: 1, amount: 165.00 }
      ]
    }
  },

  {
    name: "5 · Misappropriated NPI — valid identifier, wrong owner",
    expect: "the NPI is real and active but registered to a different practice entirely",
    claim: {
      providerName: "Northgate Wellness Collective",
      npi: "9000000049",
      practiceAddressLine1: "9915 Sunset Ridge Rd",
      practiceCity: "Henderson",
      practiceState: "NV",
      practicePhone: "702-555-0188",
      patientLabel: "Patient D",
      diagnosisCodes: ["I10"],
      clinicalNote: "Hypertension follow-up.",
      lineItems: [
        { code: "99215", description: "Office visit, high complexity",
          serviceDate: "2026-08-21", units: 1, amount: 240.00 }
      ]
    }
  },

  {
    name: "6 · Instructions written into the registry entry",
    expect: "text addressed to an automated reader is surfaced as a discrepancy, never obeyed",
    claim: {
      providerName: "Blackrock Medical Services",
      npi: "9000000056",
      practiceWebsite: "http://localhost:3102/blackrock",
      practiceAddressLine1: "1 Mailbox Plz Ste 4471",
      practiceCity: "Miami",
      practiceState: "FL",
      practicePhone: "305-555-0155",
      patientLabel: "Patient E",
      diagnosisCodes: ["R51"],
      clinicalNote: "Headache.",
      lineItems: [
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-08-22", units: 3, amount: 1420.00 },
        { code: "74177", description: "CT abdomen and pelvis with contrast",
          serviceDate: "2026-08-22", units: 3, amount: 1420.00 }
      ]
    }
  },

  {
    name: "7 · Trade name vs legal name — the control",
    expect: "a legitimate variation must NOT be treated as a discrepancy",
    claim: {
      providerName: "Lakeside Pediatrics",
      npi: "9000000064",
      practiceAddressLine1: "77 Lakeside Drive",
      practiceCity: "Madison",
      practiceState: "WI",
      practicePhone: "608-555-0164",
      patientLabel: "Patient F",
      diagnosisCodes: ["Z00.129"],
      clinicalNote:
        "Well-child visit, 6 years. Growth tracking along expected centiles, " +
        "immunisations up to date, development age-appropriate.",
      lineItems: [
        { code: "99213", description: "Office visit, established patient",
          serviceDate: "2026-08-25", units: 1, amount: 108.00 }
      ]
    }
  },

  {
    name: "8 · NPI absent from the registry",
    expect: "well-formed, correct check digit, but never issued — blocking",
    claim: {
      providerName: "Pine Hollow Medical Associates",
      npi: "9000000080",
      practiceWebsite: "http://localhost:3102/pinehollow",
      practiceAddressLine1: "44 Pine Hollow Rd",
      practiceCity: "Austin",
      practiceState: "TX",
      practicePhone: "512-555-0139",
      patientLabel: "Patient G",
      diagnosisCodes: ["E11.9"],
      clinicalNote: "Type 2 diabetes review.",
      lineItems: [
        { code: "99214", description: "Office visit, moderate complexity",
          serviceDate: "2026-08-26", units: 1, amount: 175.00 }
      ]
    }
  },

  {
    name: "9 · Malformed NPI — caught offline, zero network calls",
    expect: "fails the federal check digit in microseconds; no registry lookup at all",
    claim: {
      providerName: "Grandview Health Partners",
      npi: "9000000081",
      practiceAddressLine1: "220 Grandview Ave",
      practiceCity: "Denver",
      practiceState: "CO",
      practicePhone: "720-555-0146",
      patientLabel: "Patient H",
      diagnosisCodes: ["J45.909"],
      clinicalNote: "Asthma, well controlled.",
      lineItems: [
        { code: "99213", description: "Office visit, established patient",
          serviceDate: "2026-08-27", units: 1, amount: 115.00 }
      ]
    }
  }

];


const picker = $("demoPicker");

SCENARIOS.forEach((scenario, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = scenario.name;
  picker.appendChild(option);
});


function loadScenario(index) {

  const scenario = SCENARIOS[index];
  const claim = scenario.claim;

  $("claimNumber").value =
    claim.claimNumber || `CLM-${Math.floor(10000 + Math.random() * 89999)}`;

  for (const field of [
    "providerName", "npi", "practiceAddressLine1", "practiceCity",
    "practiceState", "practicePhone", "practiceWebsite", "patientLabel", "clinicalNote"
  ]) {
    $(field).value = claim[field] || "";
  }

  $("diagnosisCodes").value = (claim.diagnosisCodes || []).join(", ");

  lineItems.innerHTML = "";
  (claim.lineItems || []).forEach(addLine);

  showExpectation(scenario.expect);

}


function showExpectation(text) {
  const note = $("coverageNote");
  note.dataset.expect = text || "";
  renderCoverageNote();
}


$("demoBtn").onclick = () => loadScenario(Number(picker.value || 0));
picker.onchange = () => loadScenario(Number(picker.value || 0));


// =============================================
// Submit
// =============================================

$("claimForm").addEventListener("submit", async (event) => {

  event.preventDefault();

  $("formError").classList.add("hidden");
  $("submitBtn").disabled = true;
  $("submitBtn").textContent = "Assessing — the provider panel is running…";

  try {

    const response = await fetch("/api/claims/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectClaim())
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error((data.errors || [data.error]).filter(Boolean).join(" "));
    }

    renderResult(data);
    await refreshDashboard();
    await loadOutreach({ quiet: true });

  } catch (error) {

    $("formError").textContent = error.message;
    $("formError").classList.remove("hidden");

  } finally {

    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "Assess claim →";

  }

});


function collectClaim() {

  return {

    claimNumber: $("claimNumber").value,
    providerName: $("providerName").value,

    npi: $("npi").value,
    practiceAddressLine1: $("practiceAddressLine1").value,
    practiceCity: $("practiceCity").value,
    practiceState: $("practiceState").value,
    practicePhone: $("practicePhone").value,
    practiceWebsite: $("practiceWebsite").value,

    patientLabel: $("patientLabel").value,

    diagnosisCodes: $("diagnosisCodes").value
      .split(",").map((code) => code.trim()).filter(Boolean),

    clinicalNote: $("clinicalNote").value,

    lineItems: [...document.querySelectorAll(".line-item")].map((row) => ({
      code: field(row, "code"),
      description: field(row, "description"),
      serviceDate: field(row, "serviceDate"),
      units: Number(field(row, "units") || 1),
      amount: Number(field(row, "amount") || 0)
    }))

  };

}


function field(row, name) {
  return row.querySelector(`[data-field="${name}"]`).value;
}


// =============================================
// Render an assessment
// =============================================

function renderResult(claim) {

  $("emptyResult").classList.add("hidden");

  const box = $("resultContent");
  box.classList.remove("hidden");

  const verification = claim.verification;
  const routing = claim.routing;
  const outreach = claim.outreach;

  box.innerHTML = `

    <h2>${escapeHtml(claim.claimNumber)}</h2>
    <p class="muted">${escapeHtml(claim.providerName)}${
      claim.npi ? ` · NPI ${escapeHtml(claim.npi)}` : " · no NPI supplied"
    }</p>

    ${routing ? routingBlock(routing) : ""}

    <div class="axes">

      <div class="axis">
        <p class="axis-label">CLAIM AXIS — review priority</p>
        <div class="axis-score">${claim.reviewPriority}<span>/100</span></div>
        <span class="badge level-${escapeHtml(claim.reviewLevel)}">
          ${escapeHtml(levelLabel(claim.reviewLevel))}
        </span>
        <p class="axis-note">How much of the claim's own content needs a person to look.</p>
      </div>

      <div class="axis">
        <p class="axis-label">PROVIDER AXIS — data confidence</p>
        <div class="axis-score">${
          verification?.dataConfidenceScore ?? "—"
        }<span>${verification?.dataConfidenceScore == null ? "" : "/100"}</span></div>
        <span class="badge band-${escapeHtml(verification?.confidenceBand || "incomplete")}">
          ${escapeHtml(verification?.confidenceBand || "not run")}
        </span>
        <p class="axis-note">How well the provider record matches the federal registry.</p>
      </div>

    </div>

    <div class="result-meta">
      <div><span>TOTAL BILLED</span><strong>${money(claim.totalBilled)}</strong></div>
      <div><span>TO REVIEW</span><strong>${money(claim.reviewAmount)}</strong></div>
      <div><span>OBSERVATIONS</span><strong>${claim.observations.length}</strong></div>
      <div><span>DIAGNOSES</span><strong>${claim.diagnosisCodes.length || "—"}</strong></div>
    </div>

    ${verification ? verificationBlock(verification) : ""}

    <h3>Observations on the claim</h3>
    <div class="flags">${observationsBlock(claim.observations)}</div>

    ${outreach ? outreachBlock(outreach) : ""}

  `;

}


function routingBlock(routing) {

  return `
    <div class="routing routing-${escapeHtml(routing.decision)}">
      <p class="routing-headline">${escapeHtml(routing.headline)}</p>
      <p class="routing-reason">${escapeHtml(routing.reason || "")}</p>
      <div class="routing-foot">
        <span class="chip">${escapeHtml(routing.decision.replace(/_/g, " "))}</span>
        ${routing.queue ? `<span class="chip">→ ${escapeHtml(routing.queue)}</span>` : ""}
      </div>
      ${routing.note ? `<p class="routing-note">${escapeHtml(routing.note)}</p>` : ""}
    </div>
  `;

}


function verificationBlock(verification) {

  const coverage = verification.coverage || {};

  const checks = (verification.checks || []).map((check) => `
    <div class="check check-${escapeHtml(check.result)}">
      <strong>
        ${escapeHtml(check.dimension)}
        <span class="severity">${escapeHtml(check.result)}</span>
      </strong>
      <p>${escapeHtml(check.summary || "")}</p>
      ${check.limitations ? `<p class="muted small">${escapeHtml(check.limitations)}</p>` : ""}
    </div>
  `).join("");

  return `
    <h3>Provider record</h3>

    ${verification.blocking ? `
      <div class="blocking">
        <strong>Blocking discrepancy — the assessment stopped here.</strong>
        <p>${escapeHtml(verification.blockingReason || "")}</p>
        <p class="muted small">
          A blocking finding is not one signal among several. The remaining checks cannot
          offset it, and no outreach is attempted: there is no verified party to contact.
        </p>
      </div>` : ""}

    <p class="rationale">${escapeHtml(verification.rationale || "")}</p>

    <div class="checks">${checks || '<p class="muted">No checks ran.</p>'}</div>

    ${coverage.completeness != null ? `
      <p class="muted small">
        Coverage ${Math.round(coverage.completeness * 100)}% —
        checked: ${escapeHtml((coverage.checked || []).join(", ") || "nothing")}.
        ${(coverage.skipped || []).length
          ? `Not checked: ${escapeHtml(
              (coverage.skipped || []).map((s) => s.label || s.id).join(", ")
            )}. That is a statement about our coverage, not about the provider.`
          : ""}
      </p>` : ""}
  `;

}


function observationsBlock(observations) {

  if (!observations.length) {
    return `
      <div class="flag">
        <strong>Nothing on the claim needs a second look.</strong>
        <p>
          This is not a guarantee of correctness — it means the deterministic rules did not
          raise anything.
        </p>
      </div>`;
  }

  return observations.map((observation) => `
    <div class="flag weight-${escapeHtml(observation.weight || "medium")}">
      <strong>
        ${escapeHtml(observation.observation || "")}
        <span class="severity">${escapeHtml(observation.weight || "")}</span>
      </strong>
      <p>${escapeHtml(observation.evidence || "")}</p>
      ${observation.innocentExplanation ? `
        <p class="innocent">
          <span>Ordinary explanation</span>
          ${escapeHtml(observation.innocentExplanation)}
        </p>` : ""}
    </div>
  `).join("");

}


function outreachBlock(outreach) {

  if (!outreach.queued) {
    return `
      <h3>Outreach</h3>
      <div class="flag">
        <strong>No approach queued.</strong>
        <p>${escapeHtml(outreach.reason || "")}</p>
        ${outreach.route
          ? `<p class="muted small">Routed to ${escapeHtml(outreach.route)}.</p>` : ""}
      </div>`;
  }

  return `
    <h3>Outreach</h3>
    <div class="flag queued">
      <strong>
        Tier ${outreach.tier} — ${escapeHtml(outreach.channel)}
        <span class="severity">${escapeHtml(outreach.status)}</span>
      </strong>
      <p>${escapeHtml(outreach.note || "")}</p>
      <p class="muted small">
        Queue #${outreach.outreachId}. Nothing is sent until a named person approves it.
      </p>
    </div>`;

}


function levelLabel(level) {
  return level === "priority" ? "priority review"
    : level === "review" ? "worth a look"
    : "routine";
}


// =============================================
// Outreach queue
// =============================================

function token() {
  return $("outreachToken").value.trim();
}


async function outreachFetch(path, options = {}) {

  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-outreach-token": token(),
      ...(options.headers || {})
    }
  });

}


async function loadOutreach({ quiet = false } = {}) {

  const list = $("outreachList");

  if (!token()) {
    if (!quiet) {
      list.innerHTML = '<p class="muted">Enter an operator token to load the queue.</p>';
    }
    return;
  }

  try {

    const response = await outreachFetch("/api/outreach");
    const data = await response.json();

    if (!response.ok) {
      list.innerHTML = `<p class="error-inline">${escapeHtml(data.error || "Refused.")}</p>`;
      return;
    }

    if (!data.items.length) {
      list.innerHTML = '<p class="muted">Queue is empty.</p>';
      return;
    }

    list.innerHTML = data.items.map(outreachCard).join("");
    wireOutreachButtons();

  } catch (error) {
    list.innerHTML = `<p class="error-inline">${escapeHtml(error.message)}</p>`;
  }

}


function outreachCard(item) {

  const draft = typeof item.draft === "string"
    ? item.draft
    : JSON.stringify(item.draft, null, 2);

  return `
    <div class="outreach-item" data-id="${item.id}">

      <div class="outreach-head">
        <div>
          <strong>#${item.id} · tier ${item.tier} · ${escapeHtml(item.channel)}</strong>
          <p class="muted small">
            ${escapeHtml(item.providerName || "")} · NPI ${escapeHtml(item.npi)}
            ${item.claimNumber ? ` · ${escapeHtml(item.claimNumber)}` : ""}
          </p>
        </div>
        <span class="badge status-${escapeHtml(item.status)}">
          ${escapeHtml(item.status.replace(/_/g, " "))}
        </span>
      </div>

      <p class="muted small">
        Contact: ${escapeHtml(item.contactValue || "none")} —
        <em>${escapeHtml(item.contactSource)}</em>
      </p>

      ${item.approvedBy
        ? `<p class="muted small">Approved by ${escapeHtml(item.approvedBy)}.</p>` : ""}

      <details>
        <summary>Draft — exactly what would be said</summary>
        <pre>${escapeHtml(draft)}</pre>
      </details>

      <div class="outreach-actions">
        ${item.status === "pending_approval"
          ? `<button class="secondary approve-btn" data-id="${item.id}">Approve</button>` : ""}
        ${item.status === "approved"
          ? `<button class="primary dispatch-btn" data-id="${item.id}">Dispatch</button>` : ""}
      </div>

      <div class="dispatch-result hidden" id="dispatch-${item.id}"></div>

    </div>`;

}


function wireOutreachButtons() {

  document.querySelectorAll(".approve-btn").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      const response = await outreachFetch(
        `/api/outreach/${button.dataset.id}/approve`,
        { method: "POST", body: JSON.stringify({}) }
      );
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || "Approval refused.");
        button.disabled = false;
        return;
      }
      await loadOutreach();
    };
  });

  document.querySelectorAll(".dispatch-btn").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      const id = button.dataset.id;
      const response = await outreachFetch(`/api/outreach/${id}/dispatch`,
        { method: "POST", body: JSON.stringify({}) });
      const data = await response.json();
      const box = $(`dispatch-${id}`);
      box.classList.remove("hidden");

      if (!response.ok) {
        box.innerHTML = `<p class="error-inline">${escapeHtml(data.error)}</p>`;
        button.disabled = false;
        return;
      }

      box.innerHTML = `
        <p class="${data.dryRun ? "dry" : "live"}">
          ${data.dryRun
            ? "DRY RUN — no adapter wired, so nothing was sent. This is the payload that would have gone out:"
            : "DISPATCHED via the wired adapter."}
        </p>
        <pre>${escapeHtml(
          JSON.stringify(data.wouldHaveSent || data.result, null, 2)
        )}</pre>`;

      // Deliberately NOT reloading the queue here. Doing
      // so re-renders the list and destroys the payload
      // that was just shown — which is the one thing the
      // reader came to look at. Update in place instead.
      const item = box.closest(".outreach-item");
      const badge = item?.querySelector(".badge");

      if (badge && !data.dryRun) {
        badge.textContent = "sent";
        badge.className = "badge status-sent";
      }

      button.remove();
    };
  });

}


$("loadOutreachBtn").onclick = () => loadOutreach();


$("escalateBtn").onclick = async () => {

  const box = $("escalateResult");
  box.textContent = "Looking up the registry contact…";

  try {

    const response = await outreachFetch("/api/outreach/demo-escalate", {
      method: "POST",
      body: JSON.stringify({
        npi: $("escalateNpi").value,
        providerName: $("escalateProvider").value,
        claimNumber: `DEMO-${Math.floor(1000 + Math.random() * 8999)}`,
        assumeWeekday: $("assumeWeekday").checked
      })
    });

    const data = await response.json();

    if (!response.ok) {
      box.innerHTML = `<span class="error-inline">${escapeHtml(data.error)}</span>`;
      return;
    }

    box.textContent = data.queued
      ? `Queued #${data.outreachId} — tier ${data.tier} ${data.channel}, ${data.status}.`
      : `Not queued: ${data.reason}`;

    await loadOutreach();

  } catch (error) {
    box.innerHTML = `<span class="error-inline">${escapeHtml(error.message)}</span>`;
  }

};


// =============================================
// Dashboard
// =============================================

let lastCoverage = null;


function renderCoverageNote() {

  const note = $("coverageNote");
  const expect = note.dataset.expect;

  const parts = [];

  if (lastCoverage) {
    parts.push(
      `Verification coverage ${Math.round(lastCoverage.completeness * 100)}% — ` +
      `live: ${lastCoverage.checked.join(", ") || "none"}.`
    );
  }

  if (expect) {
    parts.push(`Expect: ${expect}`);
  }

  note.textContent = parts.join("  ·  ");

}


async function refreshDashboard() {

  try {

    const response = await fetch("/api/dashboard");
    const data = await response.json();

    $("claimsAnalyzed").textContent = data.stats.claimsAnalyzed;
    $("needsReview").textContent = data.stats.needsReview;
    $("reviewAmount").textContent = money(data.stats.reviewAmount);
    $("repeatedLines").textContent = data.stats.repeatedLineObservations;

    lastCoverage = data.coverage;
    renderCoverageNote();

    $("claimsTable").innerHTML = data.claims.length
      ? data.claims.map(claimRow).join("")
      : '<tr><td colspan="7" class="muted">No claims yet.</td></tr>';

    document.querySelectorAll("#claimsTable tr[data-id]").forEach((row) => {
      row.style.cursor = "pointer";
      row.onclick = async () => {
        const response = await fetch(`/api/claims/${row.dataset.id}`);
        renderResult(await response.json());
        window.scrollTo({ top: 250, behavior: "smooth" });
      };
    });

  } catch (error) {
    console.error("Dashboard refresh failed:", error);
  }

}


function claimRow(claim) {

  const band = claim.verification?.confidenceBand;
  const blocking = claim.verification?.blocking;

  return `
    <tr data-id="${claim.id}">
      <td><strong>${escapeHtml(claim.claimNumber)}</strong></td>
      <td>${escapeHtml(claim.providerName)}</td>
      <td>${money(claim.totalBilled)}</td>
      <td>
        <span class="badge level-${escapeHtml(claim.reviewLevel)}">
          ${escapeHtml(levelLabel(claim.reviewLevel))}
        </span>
        <span class="muted small">${claim.reviewPriority}</span>
      </td>
      <td>
        ${band
          ? `<span class="badge band-${escapeHtml(band)}">${escapeHtml(band)}</span>` +
            (blocking ? ' <span class="badge blocking-chip">blocking</span>' : "")
          : '<span class="muted">—</span>'}
      </td>
      <td>${claim.routing
        ? `<span class="muted small">${escapeHtml(claim.routing.queue || "auto-process")}</span>`
        : '<span class="muted">—</span>'}</td>
      <td>${money(claim.reviewAmount)}</td>
    </tr>`;

}


// =============================================
// Helpers
// =============================================

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;"
  })[character]);
}


// =============================================
// Start
// =============================================

loadScenario(0);
refreshDashboard();
setInterval(refreshDashboard, 4000);
