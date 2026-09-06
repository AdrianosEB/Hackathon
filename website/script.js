// =============================================
// DOM HELPER
// =============================================

const $ =
  (id) =>
    document.getElementById(
      id
    );


// =============================================
// STATE
// =============================================

let currentMode =
  "claims";

let processingBatch =
  false;

let batchEntries =
  [];

let currentSelectedClaimId =
  null;

let clarificationWatchId =
  null;


// Appeal state

let processingAppealBatch =
  false;

let appealBatchEntries =
  [];

let currentAppealView =
  "all";

let currentSelectedAppealId =
  null;


// Cached data

let cachedClaims =
  [];

let cachedAppeals =
  [];


// =============================================
// HTML ESCAPE
// =============================================

function escapeHtml(
  value
) {

  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


// =============================================
// MONEY
// =============================================

function money(
  value
) {

  return new Intl
    .NumberFormat(
      "en-US",
      {

        style:
          "currency",

        currency:
          "USD"

      }
    )
    .format(
      Number(
        value ||
        0
      )
    );

}


// =============================================
// PERCENT
// =============================================

function percent(
  value
) {

  return `${Number(
    value ||
    0
  ).toFixed(1)}%`;

}


// =============================================
// RISK BADGE
// =============================================

function riskBadge(
  risk
) {

  const normalized =
    String(
      risk ||
      "low"
    )
      .trim()
      .toLowerCase();


  if (
    normalized ===
    "high"
  ) {

    return `
      <span class="risk-badge risk-high">
        HIGH
      </span>
    `;

  }


  if (
    normalized ===
    "review"
  ) {

    return `
      <span class="risk-badge risk-review">
        REVIEW
      </span>
    `;

  }


  if (
    normalized ===
    "unavailable"
  ) {

    return `
      <span class="risk-badge risk-unavailable">
        N/A
      </span>
    `;

  }


  return `
    <span class="risk-badge risk-low">
      LOW
    </span>
  `;

}


// =============================================
// APPEAL OUTCOME LABEL
// =============================================

function outcomeLabel(
  outcome
) {

  const normalized =
    String(
      outcome ||
      "unavailable"
    )
      .trim()
      .toLowerCase();


  if (
    normalized ===
    "resolved"
  ) {

    return "RESOLVED";

  }


  if (
    normalized ===
    "partially_resolved"
  ) {

    return "PARTIALLY RESOLVED";

  }


  if (
    normalized ===
    "not_resolved"
  ) {

    return "NOT RESOLVED";

  }


  return "N/A";

}


// =============================================
// APPEAL OUTCOME BADGE
// =============================================

function outcomeBadge(
  outcome
) {

  const normalized =
    String(
      outcome ||
      "unavailable"
    )
      .trim()
      .toLowerCase();


  const allowed =
    [
      "resolved",
      "partially_resolved",
      "not_resolved",
      "unavailable"
    ];


  const safeOutcome =
    allowed.includes(
      normalized
    )
      ? normalized
      : "unavailable";


  return `
    <span
      class="outcome-badge outcome-${safeOutcome}"
    >
      ${outcomeLabel(
        safeOutcome
      )}
    </span>
  `;

}


// =============================================
// APPEAL WORKFLOW BADGE
// =============================================

function workflowBadge(
  status
) {

  const completed =
    String(
      status ||
      ""
    )
      .toLowerCase() ===
    "completed";


  return `
    <span
      class="outcome-badge ${
        completed
          ? "workflow-completed"
          : "workflow-pending"
      }"
    >
      ${
        completed
          ? "COMPLETED"
          : "PENDING"
      }
    </span>
  `;

}


// =============================================
// LIST / DETAIL NAVIGATION
// =============================================

function closeHeaderPopovers() {

  $("activityQueuePopover")
    .classList
    .add(
      "hidden"
    );


  $("uploadPopover")
    .classList
    .add(
      "hidden"
    );


  $("queueButton")
    .setAttribute(
      "aria-expanded",
      "false"
    );


  $("uploadButton")
    .setAttribute(
      "aria-expanded",
      "false"
    );


  $("popoverBackdrop")
    .classList
    .add(
      "hidden"
    );


  $("popoverBackdrop")
    .setAttribute(
      "aria-hidden",
      "true"
    );

}


function toggleHeaderPopover(
  popoverId,
  triggerId
) {

  const popover =
    $(popoverId);


  const shouldOpen =
    popover.classList.contains(
      "hidden"
    );


  closeHeaderPopovers();


  if (
    !shouldOpen
  ) {

    return;

  }


  popover
    .classList
    .remove(
      "hidden"
    );


  $(triggerId)
    .setAttribute(
      "aria-expanded",
      "true"
    );


  $("popoverBackdrop")
    .classList
    .remove(
      "hidden"
    );


  $("popoverBackdrop")
    .setAttribute(
      "aria-hidden",
      "false"
    );

}


function showClaimsList() {

  $("claimsListView")
    .classList
    .remove(
      "hidden"
    );


  $("claimsDetailView")
    .classList
    .add(
      "hidden"
    );


}


function showAppealsList() {

  $("appealsListView")
    .classList
    .remove(
      "hidden"
    );


  $("appealsDetailView")
    .classList
    .add(
      "hidden"
    );


}


function showClaimDetail() {

  $("claimsListView")
    .classList
    .add(
      "hidden"
    );


  $("claimsDetailView")
    .classList
    .remove(
      "hidden"
    );


  closeHeaderPopovers();
  window.scrollTo({ top: 0, behavior: "smooth" });

}


function showAppealDetail() {

  $("appealsListView")
    .classList
    .add(
      "hidden"
    );


  $("appealsDetailView")
    .classList
    .remove(
      "hidden"
    );


  closeHeaderPopovers();
  window.scrollTo({ top: 0, behavior: "smooth" });

}


function updateQueueCount() {

  const imports =
    currentMode ===
    "claims"

      ? batchEntries.length
      : appealBatchEntries.length;


  const calls =
    currentMode ===
    "claims"

      ? Number(
          $("callQueueCount")
            .textContent ||
          0
        )
      : 0;


  const total =
    imports +
    calls;


  $("queueCount")
    .textContent =
    String(
      total
    );


  $("queueSummary")
    .textContent =
    total ===
    0

      ? "Nothing queued"
      : `${total} item${
          total ===
          1
            ? ""
            : "s"
        }`;


}


function syncHeaderForMode() {

  const claimsMode =
    currentMode ===
    "claims";


  $("uploadButton")
    .textContent =
    claimsMode
      ? "Upload claims"
      : "Upload appeals";


  $("claimsUploadPanel")
    .classList
    .toggle(
      "hidden",
      !claimsMode
    );


  $("appealsUploadPanel")
    .classList
    .toggle(
      "hidden",
      claimsMode
    );


  $("claimsQueueContent")
    .classList
    .toggle(
      "hidden",
      !claimsMode
    );


  $("appealsQueueContent")
    .classList
    .toggle(
      "hidden",
      claimsMode
    );


  updateQueueCount();

}


// =============================================
// MODE SWITCH
// =============================================

function setMode(
  mode
) {

  currentMode =
    mode;


  const claimsMode =
    mode ===
    "claims";


  $("claimsMode")
    .classList
    .toggle(
      "hidden",
      !claimsMode
    );


  $("appealsMode")
    .classList
    .toggle(
      "hidden",
      claimsMode
    );


  $("claimsModeButton")
    .classList
    .toggle(
      "active",
      claimsMode
    );


  $("appealsModeButton")
    .classList
    .toggle(
      "active",
      !claimsMode
    );


  closeHeaderPopovers();
  syncHeaderForMode();


  if (
    claimsMode
  ) {

    showClaimsList();

    refreshClaims(
      false
    );

    refreshCallQueue();

  } else {

    showAppealsList();

    refreshAppeals(
      false
    );

  }

}


// =============================================
// MODE BUTTONS
// =============================================

$("claimsModeButton")
  .addEventListener(
    "click",
    () => {

      setMode(
        "claims"
      );

    }
  );


$("appealsModeButton")
  .addEventListener(
    "click",
    () => {

      setMode(
        "appeals"
      );

    }
  );


$("backToClaims")
  .addEventListener(
    "click",
    showClaimsList
  );


$("backToAppeals")
  .addEventListener(
    "click",
    showAppealsList
  );


$("queueButton")
  .addEventListener(
    "click",
    () => {

      toggleHeaderPopover(
        "activityQueuePopover",
        "queueButton"
      );

    }
  );


$("uploadButton")
  .addEventListener(
    "click",
    () => {

      toggleHeaderPopover(
        "uploadPopover",
        "uploadButton"
      );

    }
  );


$("popoverBackdrop")
  .addEventListener(
    "click",
    closeHeaderPopovers
  );


document
  .addEventListener(
    "click",
    (
      event
    ) => {

      if (
        !event.target.closest(
          "#queueButton, #uploadButton, #activityQueuePopover, #uploadPopover, [data-open-upload]"
        )
      ) {

        closeHeaderPopovers();

      }

    }
  );


// ==================================================
// CLAIM CSV
// ==================================================


// =============================================
// CSV PARSER
//
// This remains for CLAIMS only.
// =============================================

function parseCsv(
  text
) {

  const rawRows =
    [];

  let row =
    [];

  let value =
    "";

  let insideQuotes =
    false;


  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {

    const char =
      text[i];

    const next =
      text[i + 1];


    // ===========================================
    // QUOTED FIELD
    // ===========================================

    if (
      char ===
      '"'
    ) {

      if (
        insideQuotes &&
        next ===
        '"'
      ) {

        value +=
          '"';

        i +=
          1;

      } else {

        insideQuotes =
          !insideQuotes;

      }


      continue;

    }


    // ===========================================
    // COMMA
    // ===========================================

    if (
      char ===
        "," &&
      !insideQuotes
    ) {

      row.push(
        value
      );

      value =
        "";

      continue;

    }


    // ===========================================
    // NEW LINE
    // ===========================================

    if (
      (
        char ===
          "\n" ||
        char ===
          "\r"
      ) &&
      !insideQuotes
    ) {

      if (
        char ===
          "\r" &&
        next ===
          "\n"
      ) {

        i +=
          1;

      }


      row.push(
        value
      );

      value =
        "";


      const hasContent =
        row.some(
          (cell) =>
            String(
              cell
            ).trim() !==
            ""
        );


      if (
        hasContent
      ) {

        rawRows.push(
          row
        );

      }


      row =
        [];

      continue;

    }


    value +=
      char;

  }


  // ===========================================
  // LAST ROW
  // ===========================================

  if (
    value.length >
      0 ||
    row.length >
      0
  ) {

    row.push(
      value
    );


    const hasContent =
      row.some(
        (cell) =>
          String(
            cell
          ).trim() !==
          ""
      );


    if (
      hasContent
    ) {

      rawRows.push(
        row
      );

    }

  }


  if (
    rawRows.length <
    2
  ) {

    throw new Error(
      "CSV must contain a header and at least one claim line."
    );

  }


  const headers =
    rawRows[0]
      .map(
        (header) =>
          String(
            header
          ).trim()
      );


  return rawRows
    .slice(
      1
    )
    .map(
      (cells) => {

        const object =
          {};


        headers.forEach(
          (
            header,
            index
          ) => {

            object[header] =
              String(
                cells[index] ??
                ""
              ).trim();

          }
        );


        return object;

      }
    );

}


// =============================================
// CSV ROWS -> CLAIM
// =============================================

function csvRowsToClaim(
  rows
) {

  if (
    !Array.isArray(
      rows
    ) ||
    rows.length ===
      0
  ) {

    throw new Error(
      "CSV contains no claim data."
    );

  }


  const requiredHeaders =
    [
      "claimNumber",
      "providerName",
      "patientLabel",
      "diagnosisCodes",
      "clinicalNote",
      "code",
      "description",
      "serviceDate",
      "units",
      "amount"
    ];


  const first =
    rows[0];


  for (
    const header
    of requiredHeaders
  ) {

    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          first,
          header
        )
    ) {

      throw new Error(
        `Missing CSV column: ${header}`
      );

    }

  }


  const claimNumber =
    first.claimNumber;


  if (
    !claimNumber
  ) {

    throw new Error(
      "Claim number is missing."
    );

  }


  // ===========================================
  // ONE CLAIM PER CSV
  // ===========================================

  for (
    const row
    of rows
  ) {

    if (
      row.claimNumber !==
      claimNumber
    ) {

      throw new Error(
        "One CSV file must contain only one bill/claim."
      );

    }

  }


  const diagnosisCodes =
    String(
      first.diagnosisCodes ||
      ""
    )
      .split(
        /[;|]/
      )
      .map(
        (code) =>
          code.trim()
      )
      .filter(
        Boolean
      );


  const lineItems =
    rows.map(
      (row) => ({

        code:
          row.code,

        description:
          row.description,

        serviceDate:
          row.serviceDate,

        units:
          Number(
            row.units
          ),

        amount:
          Number(
            row.amount
          )

      })
    );


  return {

    claimNumber,

    providerName:
      first.providerName,

    patientLabel:
      first.patientLabel,

    diagnosisCodes,

    clinicalNote:
      first.clinicalNote,

    lineItems

  };

}


// =============================================
// CLAIM FILE SELECTION
// =============================================

$("csvFiles")
  .addEventListener(
    "change",
    async (
      event
    ) => {

      if (
        processingBatch
      ) {

        return;

      }


      const files =
        [
          ...event.target.files
        ];


      if (
        files.length ===
        0
      ) {

        return;

      }


      batchEntries =
        files.map(
          (file) => ({

            file,

            claim:
              null,

            result:
              null,

            status:
              "waiting",

            error:
              null

          })
        );


      $("batchSummary")
        .classList
        .remove(
          "hidden"
        );


      $("progressWrap")
        .classList
        .remove(
          "hidden"
        );


      $("importError")
        .classList
        .add(
          "hidden"
        );


      renderClaimQueue();

      updateClaimProgress();


      await processClaimBatch();

    }
  );


// =============================================
// PROCESS CLAIM CSVs SEQUENTIALLY
// =============================================

async function processClaimBatch() {

  processingBatch =
    true;


  $("csvFiles").disabled =
    true;


  try {

    for (
      const entry
      of batchEntries
    ) {

      try {

        // =======================================
        // READ
        // =======================================

        entry.status =
          "parsing";


        renderClaimQueue();


        const text =
          await entry.file.text();


        const rows =
          parseCsv(
            text
          );


        const claim =
          csvRowsToClaim(
            rows
          );


        entry.claim =
          claim;


        // =======================================
        // ANALYZE
        // =======================================

        entry.status =
          "analyzing";


        renderClaimQueue();


        $("headerStatus")
          .textContent =
            `Analyzing ${claim.claimNumber}...`;


        const response =
          await fetch(
            "/api/claims/analyze",
            {

              method:
                "POST",

              headers: {

                "Content-Type":
                  "application/json"

              },

              body:
                JSON.stringify(
                  claim
                )

            }
          );


        const data =
          await response.json();


        if (
          !response.ok
        ) {

          throw new Error(
            data.error ||
            "Analysis failed."
          );

        }


        // =======================================
        // DONE
        // =======================================

        entry.status =
          "done";


        entry.result =
          data;


        currentSelectedClaimId =
          data.id;


        await refreshClaims(
          false
        );


        if (
          data.id
        ) {

          await loadClaim(
            data.id
          );

        }


        await refreshCallQueue();

      } catch (
        error
      ) {

        entry.status =
          "failed";


        entry.error =
          error.message;


        console.error(
          "Claim CSV processing error:",
          error
        );

      }


      renderClaimQueue();

      updateClaimProgress();

    }

  } finally {

    processingBatch =
      false;


    $("csvFiles").disabled =
      false;


    $("headerStatus")
      .textContent =
        "Ready";


    renderClaimQueue();

    updateClaimProgress();


    await refreshClaims(
      false
    );


    await refreshCallQueue();

  }

}


// =============================================
// CLAIM IMPORT QUEUE
// =============================================

function renderClaimQueue() {

  const container =
    $("fileQueue");


  if (
    batchEntries.length ===
    0
  ) {

    container.innerHTML = `
      <div class="empty-small">
        No files selected.
      </div>
    `;


    updateQueueCount();


    return;

  }


  container.innerHTML =
    batchEntries
      .map(
        (entry) => {

          let statusText =
            "Waiting";

          let className =
            "";

          let icon =
            "·";


          if (
            entry.status ===
            "parsing"
          ) {

            statusText =
              "Reading CSV";

            className =
              "queue-active";

            icon =
              "…";

          }


          if (
            entry.status ===
            "analyzing"
          ) {

            statusText =
              "Analyzing";

            className =
              "queue-active";

            icon =
              "…";

          }


          if (
            entry.status ===
            "done"
          ) {

            statusText =
              entry.result
                ?.riskLevel

                ? String(
                    entry.result
                      .riskLevel
                  )
                    .toUpperCase()

                : "Analyzed";


            className =
              "queue-done";

            icon =
              "✓";

          }


          if (
            entry.status ===
            "failed"
          ) {

            statusText =
              entry.error ||
              "Failed";


            className =
              "queue-failed";

            icon =
              "!";

          }


          const title =
            entry.claim
              ?.claimNumber ||
            entry.file.name;


          return `
            <div class="queue-item ${className}">

              <div class="queue-icon">
                ${icon}
              </div>

              <div class="queue-info">

                <strong>
                  ${escapeHtml(
                    title
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    statusText
                  )}
                </span>

              </div>

            </div>
          `;

        }
      )
      .join(
        ""
      );


  updateQueueCount();

}


// =============================================
// CLAIM BATCH PROGRESS
// =============================================

function updateClaimProgress() {

  const total =
    batchEntries.length;


  const completed =
    batchEntries.filter(
      (entry) =>
        entry.status ===
        "done"
    ).length;


  const failed =
    batchEntries.filter(
      (entry) =>
        entry.status ===
        "failed"
    ).length;


  const processed =
    completed +
    failed;


  $("totalFiles")
    .textContent =
      String(
        total
      );


  $("completedFiles")
    .textContent =
      String(
        completed
      );


  $("failedFiles")
    .textContent =
      String(
        failed
      );


  $("progressText")
    .textContent =
      `${processed} / ${total}`;


  const progress =
    total >
    0

      ? (
          processed /
          total
        ) * 100

      : 0;


  $("progressBar")
    .style
    .width =
      `${progress}%`;

}


// ==================================================
// CLAIM DASHBOARD
// ==================================================


// =============================================
// REFRESH CLAIMS
// =============================================

async function refreshClaims(
  loadFirst = true
) {

  try {

    const response =
      await fetch(
        "/api/dashboard"
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Could not load claims."
      );

    }


    const data =
      await response.json();


    cachedClaims =
      Array.isArray(
        data.claims
      )

        ? data.claims

        : [];


    renderClaimsList();
    refreshProviderAnalyticsOverview();


    if (
      loadFirst &&
      !currentSelectedClaimId &&
      cachedClaims.length >
        0
    ) {

      currentSelectedClaimId =
        cachedClaims[0].id;


      await loadClaim(
        cachedClaims[0].id
      );

    }

  } catch (
    error
  ) {

    console.error(
      "Claims refresh error:",
      error
    );

  }

}


// =============================================
// CLAIM LIST
// =============================================

function renderClaimsList() {

  const container =
    $("claimsList");


  if (
    cachedClaims.length ===
    0
  ) {

    container.innerHTML = `
      <div class="empty-list-state">
        <strong>Nothing screened yet</strong>
        <span>Upload a CSV claim to begin the review queue.</span>
        <button type="button" data-open-upload>
          Upload claims
        </button>
      </div>
    `;


    container
      .querySelector(
        "[data-open-upload]"
      )
      ?.addEventListener(
        "click",
        () => {

          $("uploadButton")
            .click();

        }
      );


    return;

  }


  container.innerHTML =
    cachedClaims
      .map(
        (claim) => {

          const selected =
            Number(
              claim.id
            ) ===
            Number(
              currentSelectedClaimId
            );


          return `
            <button
              type="button"
              class="claim-list-item ${
                selected
                  ? "selected"
                  : ""
              }"
              data-claim-id="${claim.id}"
            >
              <span class="record-dot record-dot-${escapeHtml(claim.riskLevel || "low")}" aria-hidden="true"></span>
              <strong class="record-id">
                ${escapeHtml(claim.claimNumber)}
              </strong>
              <span class="record-provider">
                ${escapeHtml(claim.providerName)}
              </span>
              <span class="record-ratings">
                Rules ${escapeHtml(String(claim.rulesRiskLevel || "low").toUpperCase())}
                <i>·</i>
                AI ${escapeHtml(String(claim.aiRiskLevel || "unavailable").toUpperCase())}
              </span>
              <span class="record-amount">
                ${money(claim.totalBilled)}
              </span>
              ${riskBadge(claim.riskLevel)}
              <span class="record-chevron" aria-hidden="true">›</span>
            </button>
          `;

        }
      )
      .join(
        ""
      );


  container
    .querySelectorAll(
      "[data-claim-id]"
    )
    .forEach(
      (button) => {

        button
          .addEventListener(
            "click",
            async () => {

              const id =
                Number(
                  button.dataset
                    .claimId
                );


              currentSelectedClaimId =
                id;


              renderClaimsList();


              await loadClaim(
                id
              );

            }
          );

      }
    );

}


// =============================================
// LOAD CLAIM
// =============================================

async function loadClaim(
  id
) {

  try {

    const response =
      await fetch(
        `/api/claims/${id}`
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Could not load claim."
      );

    }


    const claim =
      await response.json();


    currentSelectedClaimId =
      claim.id;


    renderClaimDetail(
      claim
    );


    showClaimDetail();

  } catch (
    error
  ) {

    console.error(
      "Claim load error:",
      error
    );

  }

}


// =============================================
// CLAIM DETAIL
// =============================================

function renderClaimDetail(
  claim
) {

  $("emptyResult")
    .classList
    .add(
      "hidden"
    );


  const container =
    $("resultContent");


  container
    .classList
    .remove(
      "hidden"
    );


  const diagnosisText =
    Array.isArray(
      claim.diagnosisCodes
    ) &&
    claim.diagnosisCodes.length >
      0

      ? claim.diagnosisCodes
          .join(
            ", "
          )

      : "None supplied";


  const procedures =
    Array.isArray(
      claim.lineItems
    )

      ? claim.lineItems

      : [];


  const flags =
    Array.isArray(
      claim.flags
    )

      ? claim.flags

      : [];


  // ===========================================
  // PROCEDURES
  // ===========================================

  const proceduresHtml =
    procedures.length >
    0

      ? procedures
          .map(
            (item) => `
              <div class="procedure-row">

                <div>

                  <strong>
                    ${escapeHtml(
                      item.code
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      item.description
                    )}
                  </span>

                </div>


                <div class="procedure-meta">

                  <span>
                    ${escapeHtml(
                      item.serviceDate
                    )}
                  </span>

                  <span>
                    ${escapeHtml(
                      item.units
                    )} unit(s)
                  </span>

                  <strong>
                    ${money(
                      item.amount
                    )}
                  </strong>

                </div>

              </div>
            `
          )
          .join(
            ""
          )

      : `
          <div class="empty-small">
            No procedures.
          </div>
        `;


  // ===========================================
  // FINDINGS
  // ===========================================

  const findingsHtml =
    flags.length >
    0

      ? flags
          .map(
            (
              flag,
              index
            ) => {

              const detectedBy =
                Array.isArray(
                  flag.detectedBy
                )

                  ? flag.detectedBy
                      .map(
                        (source) =>
                          String(
                            source
                          )
                            .toUpperCase()
                      )
                      .join(
                        " + "
                      )

                  : "RULES";


              return `
                <div class="finding-card">

                  <div class="finding-top">

                    <div>

                      <span class="finding-number">
                        Finding ${index + 1}
                      </span>

                      <strong>
                        ${escapeHtml(
                          flag.lineCode ||
                          "Claim-level"
                        )}
                      </strong>

                    </div>


                    ${riskBadge(
                      flag.severity ===
                        "medium"

                        ? "review"

                        : flag.severity
                    )}

                  </div>


                  <div class="finding-source">

                    Detected by
                    ${escapeHtml(
                      detectedBy
                    )}

                  </div>


                  <p>
                    ${escapeHtml(
                      flag.message ||
                      flag.type ||
                      "Needs review."
                    )}
                  </p>


                  ${
                    flag.evidence

                      ? `
                        <div class="evidence-box">

                          <strong>
                            Evidence
                          </strong>

                          <span>
                            ${escapeHtml(
                              flag.evidence
                            )}
                          </span>

                        </div>
                      `

                      : ""
                  }


                  ${
                    flag.aiReview

                      ? `
                        <div class="ai-review-box">

                          <strong>
                            AI Evidence Review
                          </strong>

                          <span>
                            ${escapeHtml(
                              flag.aiReview
                                .message ||
                              ""
                            )}
                          </span>


                          ${
                            flag.aiReview
                              .evidence

                              ? `
                                <small>
                                  ${escapeHtml(
                                    flag.aiReview
                                      .evidence
                                  )}
                                </small>
                              `

                              : ""
                          }

                        </div>
                      `

                      : ""
                  }

                </div>
              `;

            }
          )
          .join(
            ""
          )

      : `
          <div class="empty-small">
            No findings for this claim.
          </div>
        `;


  // ===========================================
  // CLAIM PAGE
  // ===========================================

  container.innerHTML = `

    <div class="claim-detail-header">

      <div>

        <span class="eyebrow">
          Claim
        </span>

        <h2>
          ${escapeHtml(
            claim.claimNumber
          )}
        </h2>

        <p>
          ${escapeHtml(
            claim.providerName
          )}
        </p>

      </div>


      ${riskBadge(
        claim.riskLevel
      )}

    </div>


    <div class="rating-grid">

      <div class="rating-card">

        <span>
          Rules
        </span>

        ${riskBadge(
          claim.rulesRiskLevel ||
          "low"
        )}

      </div>


      <div class="rating-card">

        <span>
          AI
        </span>

        ${riskBadge(
          claim.aiRiskLevel ||
          "unavailable"
        )}

      </div>


      <div class="rating-card">

        <span>
          Final
        </span>

        ${riskBadge(
          claim.riskLevel ||
          "low"
        )}

      </div>


      <div class="rating-card">

        <span>
          Total Billed
        </span>

        <strong>
          ${money(
            claim.totalBilled
          )}
        </strong>

      </div>

    </div>


    <section class="detail-section">

      <h3>
        Claim Information
      </h3>


      <div class="info-grid">

        <div>

          <span>
            Patient
          </span>

          <strong>
            ${escapeHtml(
              claim.patientLabel ||
              "Not supplied"
            )}
          </strong>

        </div>


        <div>

          <span>
            Diagnosis
          </span>

          <strong>
            ${escapeHtml(
              diagnosisText
            )}
          </strong>

        </div>


        <div>

          <span>
            Review Amount
          </span>

          <strong>
            ${money(
              claim.reviewAmount
            )}
          </strong>

        </div>


        <div>

          <span>
            Risk Score
          </span>

          <strong>
            ${escapeHtml(
              claim.riskScore
            )}
          </strong>

        </div>

      </div>


      <div class="clinical-note">

        <span>
          Clinical Note
        </span>

        <p>
          ${escapeHtml(
            claim.clinicalNote ||
            "No clinical note supplied."
          )}
        </p>

      </div>

    </section>


    <section class="detail-section">

      <h3>
        Procedures
      </h3>

      <div class="procedure-list">
        ${proceduresHtml}
      </div>

    </section>


    <section class="detail-section">

      <h3>
        Evidence Findings
      </h3>

      <div class="findings-list">
        ${findingsHtml}
      </div>

    </section>


    <section class="detail-section">

      <h3>
        Clarification Call
      </h3>

      <div
        id="clarificationCall"
        class="clarification-call"
      >

        <div class="empty-small">
          Checking clarification status...
        </div>

      </div>

    </section>
  `;


  loadClarificationCall(
    claim.claimNumber
  );

}


// =============================================
// CLARIFICATION CALL
// =============================================

function getTranscriptTurns(
  call
) {

  const messages =
    Array.isArray(
      call.messages
    )

      ? call.messages
      : [];


  const structuredTurns =
    messages
      .filter(
        (message) => {

          const role =
            String(
              message?.role ||
              ""
            )
              .trim()
              .toLowerCase();


          return role !== "system";

        }
      )
      .map(
        (message) => {

          const role =
            String(
              message?.role ||
              ""
            )
              .trim()
              .toLowerCase();


          const text =
            String(
              message?.message ||
              message?.content ||
              message?.text ||
              ""
            )
              .trim();


          if (
            !text
          ) {

            return null;

          }


          const providerTurn =
            role === "user" ||
            role === "customer" ||
            role === "provider";


          return {
            speaker:
              providerTurn
                ? "Provider"
                : "Assistant",

            tone:
              providerTurn
                ? "provider"
                : "assistant",

            text,

            seconds:
              Number.isFinite(
                Number(
                  message?.secondsFromStart
                )
              )

                ? Number(
                    message.secondsFromStart
                  )

                : null
          };

        }
      )
      .filter(Boolean);


  if (
    structuredTurns.length >
    0
  ) {

    return structuredTurns;

  }


  const transcript =
    String(
      call.transcript ||
      ""
    ).trim();


  if (
    !transcript
  ) {

    return [];

  }


  const turns = [];
  let currentTurn = null;


  transcript
    .split("\n")
    .forEach(
      (line) => {

        const match =
          line.match(
            /^(AI|Assistant|User|Customer|Provider)\s*:\s*(.*)$/i
          );


        if (
          match
        ) {

          const providerTurn =
            /^(User|Customer|Provider)$/i.test(
              match[1]
            );


          currentTurn = {
            speaker:
              providerTurn
                ? "Provider"
                : "Assistant",

            tone:
              providerTurn
                ? "provider"
                : "assistant",

            text:
              match[2].trim(),

            seconds:
              null
          };


          turns.push(
            currentTurn
          );


          return;

        }


        if (
          currentTurn
        ) {

          currentTurn.text +=
            `${
              currentTurn.text
                ? "\n"
                : ""
            }${line}`;

        }

      }
    );


  return turns.length >
    0

      ? turns

      : [
          {
            speaker: "Call transcript",
            tone: "assistant",
            text: transcript,
            seconds: null
          }
        ];

}


function formatTranscriptTime(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return "";

  }


  const wholeSeconds =
    Math.max(
      0,
      Math.round(
        seconds
      )
    );


  return `${
    Math.floor(
      wholeSeconds /
      60
    )
  }:${String(
    wholeSeconds %
    60
  ).padStart(2, "0")}`;

}


async function loadClarificationCall(
  claimNumber
) {

  if (
    clarificationWatchId
  ) {

    clearInterval(
      clarificationWatchId
    );


    clarificationWatchId =
      null;

  }


  const refresh =
    async () => {

      const container =
        $("clarificationCall");


      if (
        !container
      ) {

        return;

      }


      const previousTranscript =
        container.querySelector(
          ".transcript-list"
        );


      const previousTranscriptScroll =
        previousTranscript

          ? {
              top:
                previousTranscript.scrollTop,

              atBottom:
                previousTranscript.scrollTop +
                  previousTranscript.clientHeight >=
                previousTranscript.scrollHeight -
                  24
            }

          : null;


      try {

        const response =
          await fetch(
            `/api/vapi/calls/${
              encodeURIComponent(
                claimNumber
              )
            }`
          );


        if (
          !response.ok
        ) {

          throw new Error(
            "Could not load clarification call."
          );

        }


        const data =
          await response.json();


        const calls =
          Array.isArray(
            data.calls
          )

            ? data.calls

            : [];


        if (
          calls.length ===
          0
        ) {

          container.innerHTML = `
            <div class="empty-small">
              No clarification call has started.
            </div>
          `;


          return;

        }


        const call =
          calls[0];


        const status =
          String(
            call.status ||
            "created"
          );


        const transcript =
          call.transcript ||
          "";


        const transcriptTurns =
          getTranscriptTurns(
            call
          );


        const transcriptHtml =
          transcriptTurns
            .map(
              (turn) => {

                const timestamp =
                  formatTranscriptTime(
                    turn.seconds
                  );


                return `
                  <article class="transcript-turn transcript-turn-${turn.tone}">
                    <div class="transcript-turn-meta">
                      <strong>${escapeHtml(turn.speaker)}</strong>
                      ${
                        timestamp

                          ? `<time>${escapeHtml(timestamp)}</time>`

                          : ""
                      }
                    </div>
                    <p>${escapeHtml(turn.text)}</p>
                  </article>
                `;

              }
            )
            .join(
              ""
            );


        container.innerHTML = `

          <div class="call-summary">
            <div class="call-status-block">
              <span>Call status</span>
              <strong class="call-status-value">
                ${escapeHtml(status)}
              </strong>
            </div>
            <div class="call-summary-meta">
              ${
                call.endedReason

                  ? `<span>Ended: ${escapeHtml(call.endedReason)}</span>`

                  : ""
              }
              ${
                transcriptTurns.length >
                0

                  ? `<span>${transcriptTurns.length} turn${transcriptTurns.length === 1 ? "" : "s"}</span>`

                  : ""
              }
            </div>
          </div>


          ${
            transcriptTurns.length >
            0

              ? `
                <div class="transcript-box">
                  <div class="transcript-heading">
                    <div>
                      <span>Conversation</span>
                      <strong>Clarification transcript</strong>
                    </div>
                    <span class="transcript-live-state">
                      ${
                        status === "ended"
                          ? "Complete"
                          : "Live"
                      }
                    </span>
                  </div>
                  <div class="transcript-list">
                    ${transcriptHtml}
                  </div>
                </div>
              `

              : `
                <div class="empty-small">

                  ${
                    status ===
                    "ended"

                      ? "No transcript was returned."

                      : "Call in progress. Waiting for transcript..."
                  }

                </div>
              `
          }
        `;


        const transcriptList =
          container.querySelector(
            ".transcript-list"
          );


        if (
          previousTranscriptScroll &&
          transcriptList
        ) {

          transcriptList.scrollTop =
            previousTranscriptScroll.atBottom
              ? transcriptList.scrollHeight
              : previousTranscriptScroll.top;

        }


        if (
          status ===
            "ended" ||
          status ===
            "failed"
        ) {

          if (
            clarificationWatchId
          ) {

            clearInterval(
              clarificationWatchId
            );


            clarificationWatchId =
              null;

          }

        }

      } catch (
        error
      ) {

        console.error(
          "Clarification call error:",
          error
        );

      }

    };


  await refresh();


  clarificationWatchId =
    setInterval(
      refresh,
      3000
    );

}


// =============================================
// VAPI QUEUE
// =============================================

async function refreshCallQueue() {

  try {

    const response =
      await fetch(
        "/api/vapi/queue"
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Could not load call queue."
      );

    }


    const data =
      await response.json();


    renderCallQueue(
      data
    );

  } catch (
    error
  ) {

    console.error(
      "Call queue refresh error:",
      error
    );

  }

}


// =============================================
// RENDER VAPI QUEUE
// =============================================

function renderCallQueue(
  queue
) {

  const container =
    $("callQueue");


  const count =
    $("callQueueCount");


  if (
    !container ||
    !count
  ) {

    return;

  }


  const waiting =
    Array.isArray(
      queue.queued
    )

      ? queue.queued

      : [];


  const active =
    queue.active ||
    null;


  const total =
    waiting.length +
    (
      active
        ? 1
        : 0
    );


  count.textContent =
    String(
      total
    );


  updateQueueCount();


  if (
    total ===
    0
  ) {

    container.innerHTML = `
      <div class="empty-small">
        No clarification calls queued.
      </div>
    `;


    return;

  }


  let html =
    "";


  if (
    active
  ) {

    html += `
      <div class="call-queue-item active-call">

        <div class="call-queue-icon">
          ☎
        </div>

        <div class="call-queue-info">

          <strong>
            ${escapeHtml(
              active.claimNumber
            )}
          </strong>

          <span class="calling-status">
            Calling
          </span>

        </div>

      </div>
    `;

  }


  for (
    const item
    of waiting
  ) {

    html += `
      <div class="call-queue-item">

        <div class="call-queue-icon">
          ·
        </div>

        <div class="call-queue-info">

          <strong>
            ${escapeHtml(
              item.claimNumber
            )}
          </strong>

          <span>
            Queued #${escapeHtml(
              item.position
            )}
          </span>

        </div>

      </div>
    `;

  }


  container.innerHTML =
    html;

}


// ==================================================
// APPEAL TXT PARSER
// ==================================================


// =============================================
// PARSE APPEAL TXT
//
// Expected:
//
// claimNumber: CLM-10007
// providerName: Metro Diagnostic Center
//
// appealReason:
// Corrected billing information
//
// appealNote:
// Duplicate was entered in error.
//
// diagnosisCodes:
// R10.84
//
// clinicalNote:
// Full documentation here.
//
// supportingEvidence:
// Corrected billing record attached.
//
// lineItems:
// 74177 | CT abdomen/pelvis | 2026-09-06 | 1 | 450
// 99215 | High-complexity office visit | 2026-09-06 | 1 | 230
// =============================================

function parseAppealTxt(
  text
) {

  const normalizedText =
    String(
      text ||
      ""
    )
      .replaceAll(
        "\r\n",
        "\n"
      )
      .replaceAll(
        "\r",
        "\n"
      );


  if (
    !normalizedText.trim()
  ) {

    throw new Error(
      "Appeal TXT file is empty."
    );

  }


  const lines =
    normalizedText
      .split(
        "\n"
      );


  const knownFields =
    new Set(
      [
        "claimNumber",
        "providerName",
        "appealReason",
        "appealNote",
        "diagnosisCodes",
        "clinicalNote",
        "supportingEvidence",
        "lineItems"
      ]
    );


  const sections = {

    claimNumber:
      "",

    providerName:
      "",

    appealReason:
      "",

    appealNote:
      "",

    diagnosisCodes:
      "",

    clinicalNote:
      "",

    supportingEvidence:
      "",

    lineItems:
      []

  };


  let currentField =
    null;


  // ===========================================
  // READ EACH LINE
  // ===========================================

  for (
    const rawLine
    of lines
  ) {

    const line =
      rawLine.trim();


    // =========================================
    // BLANK LINE
    //
    // Keep paragraph separation for text fields.
    // =========================================

    if (
      !line
    ) {

      if (
        currentField &&
        currentField !==
          "lineItems" &&
        sections[currentField]
      ) {

        sections[currentField] +=
          "\n";

      }


      continue;

    }


    // =========================================
    // DOES THIS LINE START A KNOWN FIELD?
    // =========================================

    const colonIndex =
      line.indexOf(
        ":"
      );


    if (
      colonIndex !==
      -1
    ) {

      const possibleField =
        line
          .slice(
            0,
            colonIndex
          )
          .trim();


      if (
        knownFields.has(
          possibleField
        )
      ) {

        currentField =
          possibleField;


        const sameLineValue =
          line
            .slice(
              colonIndex +
              1
            )
            .trim();


        if (
          currentField ===
          "lineItems"
        ) {

          if (
            sameLineValue
          ) {

            sections
              .lineItems
              .push(
                sameLineValue
              );

          }

        } else {

          sections[currentField] =
            sameLineValue;

        }


        continue;

      }

    }


    // =========================================
    // CONTENT UNDER CURRENT FIELD
    // =========================================

    if (
      !currentField
    ) {

      // Ignore decorative/header text before fields.

      continue;

    }


    if (
      currentField ===
      "lineItems"
    ) {

      sections
        .lineItems
        .push(
          line
        );


      continue;

    }


    if (
      sections[currentField]
    ) {

      sections[currentField] +=
        `\n${line}`;

    } else {

      sections[currentField] =
        line;

    }

  }


  // ===========================================
  // CLEAN TEXT FIELDS
  // ===========================================

  for (
    const field
    of [
      "claimNumber",
      "providerName",
      "appealReason",
      "appealNote",
      "diagnosisCodes",
      "clinicalNote",
      "supportingEvidence"
    ]
  ) {

    sections[field] =
      String(
        sections[field] ||
        ""
      )
        .trim();

  }


  // ===========================================
  // CLAIM NUMBER REQUIRED
  // ===========================================

  if (
    !sections.claimNumber
  ) {

    throw new Error(
      "Appeal TXT is missing claimNumber."
    );

  }


  // ===========================================
  // DIAGNOSIS CODES
  // ===========================================

  const diagnosisCodes =
    sections
      .diagnosisCodes
      .split(
        /[;,|\n]/
      )
      .map(
        (code) =>
          code.trim()
      )
      .filter(
        Boolean
      );


  // ===========================================
  // LINE ITEMS
  //
  // code | description | date | units | amount
  // ===========================================

  const lineItems =
    sections
      .lineItems
      .filter(
        (line) =>
          String(
            line
          ).trim()
      )
      .map(
        (
          line,
          index
        ) => {

          // Remove optional bullets.

          const cleanedLine =
            String(
              line
            )
              .replace(
                /^[-*•]\s*/,
                ""
              )
              .trim();


          const parts =
            cleanedLine
              .split(
                "|"
              )
              .map(
                (part) =>
                  part.trim()
              );


          if (
            parts.length <
            5
          ) {

            throw new Error(
              `Appeal line item ${index + 1} must use: code | description | serviceDate | units | amount`
            );

          }


          const code =
            parts[0];


          const description =
            parts[1];


          const serviceDate =
            parts[2];


          const units =
            Number(
              parts[3]
            );


          const amount =
            Number(
              String(
                parts[4]
              )
                .replaceAll(
                  "$",
                  ""
                )
                .replaceAll(
                  ",",
                  ""
                )
            );


          if (
            !code
          ) {

            throw new Error(
              `Appeal line item ${index + 1} is missing a procedure code.`
            );

          }


          if (
            !serviceDate
          ) {

            throw new Error(
              `Appeal line item ${index + 1} is missing a service date.`
            );

          }


          if (
            !Number.isFinite(
              units
            ) ||
            units <=
              0
          ) {

            throw new Error(
              `Appeal line item ${index + 1} has invalid units.`
            );

          }


          if (
            !Number.isFinite(
              amount
            ) ||
            amount <
              0
          ) {

            throw new Error(
              `Appeal line item ${index + 1} has an invalid amount.`
            );

          }


          return {

            code,

            description,

            serviceDate,

            units,

            amount

          };

        }
      );


  if (
    lineItems.length ===
    0
  ) {

    throw new Error(
      "Appeal TXT must contain at least one line under lineItems."
    );

  }


  // ===========================================
  // RETURN SAME OBJECT SERVER ALREADY EXPECTS
  // ===========================================

  return {

    claimNumber:
      sections.claimNumber,

    providerName:
      sections.providerName,

    appealReason:
      sections.appealReason,

    appealNote:
      sections.appealNote,

    diagnosisCodes,

    clinicalNote:
      sections.clinicalNote,

    supportingEvidence:
      sections.supportingEvidence,

    lineItems

  };

}


// ==================================================
// APPEAL TXT IMPORT
// ==================================================


// =============================================
// APPEAL FILE SELECTION
// =============================================

$("appealTxtFiles")
  .addEventListener(
    "change",
    async (
      event
    ) => {

      if (
        processingAppealBatch
      ) {

        return;

      }


      const files =
        [
          ...event.target.files
        ];


      if (
        files.length ===
        0
      ) {

        return;

      }


      appealBatchEntries =
        files.map(
          (file) => ({

            file,

            appeal:
              null,

            result:
              null,

            status:
              "waiting",

            error:
              null

          })
        );


      $("appealBatchSummary")
        .classList
        .remove(
          "hidden"
        );


      $("appealProgressWrap")
        .classList
        .remove(
          "hidden"
        );


      $("appealImportError")
        .classList
        .add(
          "hidden"
        );


      renderAppealQueue();

      updateAppealProgress();


      await processAppealBatch();

    }
  );


// =============================================
// PROCESS APPEAL TXT FILES
// =============================================

async function processAppealBatch() {

  processingAppealBatch =
    true;


  $("appealTxtFiles").disabled =
    true;


  try {

    for (
      const entry
      of appealBatchEntries
    ) {

      try {

        // =======================================
        // READ TXT
        // =======================================

        entry.status =
          "parsing";


        renderAppealQueue();


        const text =
          await entry.file.text();


        const appeal =
          parseAppealTxt(
            text
          );


        entry.appeal =
          appeal;


        // =======================================
        // RULES + AI
        // =======================================

        entry.status =
          "analyzing";


        renderAppealQueue();


        $("headerStatus")
          .textContent =
            `Reviewing appeal ${appeal.claimNumber}...`;


        const response =
          await fetch(
            "/api/appeals/analyze",
            {

              method:
                "POST",

              headers: {

                "Content-Type":
                  "application/json"

              },

              body:
                JSON.stringify(
                  appeal
                )

            }
          );


        const data =
          await response.json();


        if (
          !response.ok
        ) {

          throw new Error(
            data.error ||
            "Appeal review failed."
          );

        }


        // =======================================
        // DONE
        // =======================================

        entry.status =
          "done";


        entry.result =
          data;


        currentSelectedAppealId =
          data.appeal
            ?.id ||
          null;


        // Go back to ALL so newly-created appeal
        // is guaranteed to be visible.

        currentAppealView =
          "all";


        updateAppealTabSelection();


        await refreshAppeals(
          false
        );


        if (
          currentSelectedAppealId
        ) {

          await loadAppeal(
            currentSelectedAppealId
          );

        }

      } catch (
        error
      ) {

        entry.status =
          "failed";


        entry.error =
          error.message;


        console.error(
          "Appeal TXT processing error:",
          error
        );

      }


      renderAppealQueue();

      updateAppealProgress();

    }

  } finally {

    processingAppealBatch =
      false;


    $("appealTxtFiles").disabled =
      false;


    $("headerStatus")
      .textContent =
        "Ready";


    renderAppealQueue();

    updateAppealProgress();


    await refreshAppeals(
      false
    );

  }

}


// =============================================
// APPEAL IMPORT QUEUE
// =============================================

function renderAppealQueue() {

  const container =
    $("appealFileQueue");


  if (
    appealBatchEntries.length ===
    0
  ) {

    container.innerHTML = `
      <div class="empty-small">
        No appeal files selected.
      </div>
    `;


    updateQueueCount();


    return;

  }


  container.innerHTML =
    appealBatchEntries
      .map(
        (entry) => {

          let statusText =
            "Waiting";

          let icon =
            "·";

          let className =
            "";


          if (
            entry.status ===
            "parsing"
          ) {

            statusText =
              "Reading TXT";

            icon =
              "…";

            className =
              "queue-active";

          }


          if (
            entry.status ===
            "analyzing"
          ) {

            statusText =
              "Rules + AI Review";

            icon =
              "…";

            className =
              "queue-active";

          }


          if (
            entry.status ===
            "done"
          ) {

            const outcome =
              entry.result
                ?.review
                ?.finalOutcome ||
              entry.result
                ?.appeal
                ?.finalOutcome;


            statusText =
              outcomeLabel(
                outcome
              );


            icon =
              "✓";

            className =
              "queue-done";

          }


          if (
            entry.status ===
            "failed"
          ) {

            statusText =
              entry.error ||
              "Failed";


            icon =
              "!";

            className =
              "queue-failed";

          }


          const title =
            entry.appeal
              ?.claimNumber ||
            entry.file.name;


          return `
            <div class="queue-item ${className}">

              <div class="queue-icon">
                ${icon}
              </div>

              <div class="queue-info">

                <strong>
                  ${escapeHtml(
                    title
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    statusText
                  )}
                </span>

              </div>

            </div>
          `;

        }
      )
      .join(
        ""
      );


  updateQueueCount();

}


// =============================================
// APPEAL PROGRESS
// =============================================

function updateAppealProgress() {

  const total =
    appealBatchEntries.length;


  const completed =
    appealBatchEntries.filter(
      (entry) =>
        entry.status ===
        "done"
    ).length;


  const failed =
    appealBatchEntries.filter(
      (entry) =>
        entry.status ===
        "failed"
    ).length;


  const processed =
    completed +
    failed;


  $("appealTotalFiles")
    .textContent =
      String(
        total
      );


  $("appealCompletedFiles")
    .textContent =
      String(
        completed
      );


  $("appealFailedFiles")
    .textContent =
      String(
        failed
      );


  $("appealProgressText")
    .textContent =
      `${processed} / ${total}`;


  const progress =
    total >
    0

      ? (
          processed /
          total
        ) * 100

      : 0;


  $("appealProgressBar")
    .style
    .width =
      `${progress}%`;

}


// ==================================================
// APPEAL DASHBOARD
// ==================================================


// =============================================
// APPEAL FILTER BUTTONS
// =============================================

document
  .querySelectorAll(
    "[data-appeal-view]"
  )
  .forEach(
    (button) => {

      button
        .addEventListener(
          "click",
          async () => {

            currentAppealView =
              button.dataset
                .appealView;


            currentSelectedAppealId =
              null;


            updateAppealTabSelection();


            showAppealsList();


            await refreshAppeals(
              false
            );

          }
        );

    }
  );


// =============================================
// APPEAL TAB VISUAL STATE
// =============================================

function updateAppealTabSelection() {

  document
    .querySelectorAll(
      "[data-appeal-view]"
    )
    .forEach(
      (button) => {

        button
          .classList
          .toggle(
            "active",
            button.dataset
              .appealView ===
            currentAppealView
          );

      }
    );

}


// =============================================
// REFRESH APPEALS
// =============================================

async function refreshAppeals(
  loadFirst = false
) {

  try {

    const response =
      await fetch(
        `/api/appeals?view=${
          encodeURIComponent(
            currentAppealView
          )
        }`
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Could not load appeals."
      );

    }


    const data =
      await response.json();


    cachedAppeals =
      Array.isArray(
        data.appeals
      )

        ? data.appeals

        : [];


    const stats =
      data.stats ||
      {};


    $("appealAllCount")
      .textContent =
        String(
          stats.total ||
          0
        );


    $("appealPendingCount")
      .textContent =
        String(
          stats.pending ||
          0
        );


    $("appealCompletedCount")
      .textContent =
        String(
          stats.completed ||
          0
        );


    renderAppealsList();


    if (
      loadFirst &&
      !currentSelectedAppealId &&
      cachedAppeals.length >
        0
    ) {

      currentSelectedAppealId =
        cachedAppeals[0].id;


      await loadAppeal(
        currentSelectedAppealId
      );

    }

  } catch (
    error
  ) {

    console.error(
      "Appeals refresh error:",
      error
    );

  }

}


// =============================================
// APPEAL LIST
// =============================================

function renderAppealsList() {

  const container =
    $("appealsList");


  if (
    cachedAppeals.length ===
    0
  ) {

    container.innerHTML = `
      <div class="empty-list-state">
        <strong>No appeals in this view</strong>
        <span>Upload an appeal letter to add it to the review queue.</span>
        <button type="button" data-open-upload>
          Upload appeals
        </button>
      </div>
    `;


    container
      .querySelector(
        "[data-open-upload]"
      )
      ?.addEventListener(
        "click",
        () => {

          $("uploadButton")
            .click();

        }
      );


    return;

  }


  container.innerHTML =
    cachedAppeals
      .map(
        (appeal) => {

          const selected =
            Number(
              appeal.id
            ) ===
            Number(
              currentSelectedAppealId
            );


          return `
            <button
              type="button"
              class="claim-list-item ${
                selected
                  ? "selected"
                  : ""
              }"
              data-appeal-id="${appeal.id}"
            >
              <span class="record-dot record-dot-${escapeHtml(appeal.workflowStatus || "pending")}" aria-hidden="true"></span>
              <strong class="record-id">
                ${escapeHtml(appeal.claimNumber)}
              </strong>
              <span class="record-provider">
                ${escapeHtml(appeal.providerName || "Provider not supplied")}
              </span>
              <span class="record-ratings">
                ${escapeHtml(outcomeLabel(appeal.finalOutcome))}
              </span>
              ${workflowBadge(appeal.workflowStatus)}
              ${outcomeBadge(appeal.finalOutcome)}
              <span class="record-chevron" aria-hidden="true">›</span>
            </button>
          `;

        }
      )
      .join(
        ""
      );


  container
    .querySelectorAll(
      "[data-appeal-id]"
    )
    .forEach(
      (button) => {

        button
          .addEventListener(
            "click",
            async () => {

              currentSelectedAppealId =
                Number(
                  button.dataset
                    .appealId
                );


              renderAppealsList();


              await loadAppeal(
                currentSelectedAppealId
              );

            }
          );

      }
    );

}


// =============================================
// LOAD APPEAL
// =============================================

async function loadAppeal(
  id
) {

  try {

    const response =
      await fetch(
        `/api/appeals/${id}`
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Could not load appeal."
      );

    }


    const appeal =
      await response.json();


    currentSelectedAppealId =
      appeal.id;


    renderAppealDetail(
      appeal
    );


    showAppealDetail();

  } catch (
    error
  ) {

    console.error(
      "Appeal load error:",
      error
    );

  }

}


// =============================================
// APPEAL DETAIL
// =============================================

function renderAppealDetail(
  appeal
) {

  $("emptyAppealResult")
    .classList
    .add(
      "hidden"
    );


  const container =
    $("appealResultContent");


  container
    .classList
    .remove(
      "hidden"
    );


  const appealData =
    appeal.appealData ||
    {};


  const lineItems =
    Array.isArray(
      appealData.lineItems
    )

      ? appealData.lineItems

      : [];


  const rulesResults =
    Array.isArray(
      appeal.rulesResults
    )

      ? appeal.rulesResults

      : [];


  const aiResults =
    Array.isArray(
      appeal.aiResults
    )

      ? appeal.aiResults

      : [];


  // ===========================================
  // APPEALED BILLING LINES
  // ===========================================

  const procedureHtml =
    lineItems.length >
    0

      ? lineItems
          .map(
            (item) => `
              <div class="procedure-row">

                <div>

                  <strong>
                    ${escapeHtml(
                      item.code
                    )}
                  </strong>

                  <span>
                    ${escapeHtml(
                      item.description
                    )}
                  </span>

                </div>


                <div class="procedure-meta">

                  <span>
                    ${escapeHtml(
                      item.serviceDate
                    )}
                  </span>

                  <span>
                    ${escapeHtml(
                      item.units
                    )} unit(s)
                  </span>

                  <strong>
                    ${money(
                      item.amount
                    )}
                  </strong>

                </div>

              </div>
            `
          )
          .join(
            ""
          )

      : `
          <div class="empty-small">
            No corrected billing lines stored.
          </div>
        `;


  // ===========================================
  // RULES APPEAL RESULTS
  // ===========================================

  const rulesHtml =
    rulesResults.length >
    0

      ? rulesResults
          .map(
            (
              result,
              index
            ) => {

              const originalConcern =
                result.originalMessage ||
                result.originalFinding ||
                result.originalFindingMessage ||
                "";


              const resolutionText =
                result.message ||
                result.explanation ||
                result.resolution ||
                "";


              const evidence =
                result.evidence ||
                result.appealEvidence ||
                "";


              return `
                <div class="appeal-result-card">

                  <div class="appeal-result-top">

                    <div>

                      <span class="finding-number">
                        Rules Finding ${index + 1}
                      </span>

                      <strong>
                        ${escapeHtml(
                          result.lineCode ||
                          result.originalFindingType ||
                          result.type ||
                          "Claim-level"
                        )}
                      </strong>

                    </div>


                    ${outcomeBadge(
                      result.outcome
                    )}

                  </div>


                  ${
                    originalConcern

                      ? `
                        <div class="appeal-evidence-box">

                          <strong>
                            Original Concern
                          </strong>

                          <span>
                            ${escapeHtml(
                              originalConcern
                            )}
                          </span>

                        </div>
                      `

                      : ""
                  }


                  ${
                    resolutionText

                      ? `
                        <p>
                          ${escapeHtml(
                            resolutionText
                          )}
                        </p>
                      `

                      : ""
                  }


                  ${
                    evidence

                      ? `
                        <div class="appeal-evidence-box">

                          <strong>
                            Appeal Evidence
                          </strong>

                          <span>
                            ${escapeHtml(
                              evidence
                            )}
                          </span>

                        </div>
                      `

                      : ""
                  }

                </div>
              `;

            }
          )
          .join(
            ""
          )

      : `
          <div class="empty-small">
            No deterministic appeal results.
          </div>
        `;


  // ===========================================
  // AI APPEAL RESULTS
  // ===========================================

  const aiHtml =
    aiResults.length >
    0

      ? aiResults
          .map(
            (
              result,
              index
            ) => `
              <div class="appeal-result-card">

                <div class="appeal-result-top">

                  <div>

                    <span class="finding-number">
                      AI Finding ${index + 1}
                    </span>

                    <strong>
                      ${escapeHtml(
                        result.lineCode ||
                        result.originalFindingType ||
                        "Claim-level"
                      )}
                    </strong>

                  </div>


                  ${outcomeBadge(
                    result.outcome
                  )}

                </div>


                ${
                  result.originalFinding

                    ? `
                      <div class="appeal-evidence-box">

                        <strong>
                          Original Concern
                        </strong>

                        <span>
                          ${escapeHtml(
                            result.originalFinding
                          )}
                        </span>

                      </div>
                    `

                    : ""
                }


                ${
                  result.explanation

                    ? `
                      <p>
                        ${escapeHtml(
                          result.explanation
                        )}
                      </p>
                    `

                    : ""
                }


                ${
                  result.appealEvidence

                    ? `
                      <div class="appeal-evidence-box">

                        <strong>
                          Appeal Evidence
                        </strong>

                        <span>
                          ${escapeHtml(
                            result.appealEvidence
                          )}
                        </span>

                      </div>
                    `

                    : ""
                }

              </div>
            `
          )
          .join(
            ""
          )

      : `
          <div class="empty-small">

            ${
              appeal.aiOutcome ===
              "unavailable"

                ? "AI appeal review was unavailable."

                : "No AI appeal results."
            }

          </div>
        `;


  // ===========================================
  // DIAGNOSIS
  // ===========================================

  const appealDiagnosis =
    Array.isArray(
      appealData.diagnosisCodes
    ) &&
    appealData.diagnosisCodes.length >
      0

      ? appealData
          .diagnosisCodes
          .join(
            ", "
          )

      : "None supplied";


  // ===========================================
  // APPEAL DETAIL PAGE
  // ===========================================

  container.innerHTML = `

    <div class="claim-detail-header">

      <div>

        <span class="eyebrow">
          Appeal #${escapeHtml(
            appeal.id
          )}
        </span>

        <h2>
          ${escapeHtml(
            appeal.claimNumber
          )}
        </h2>

        <p>
          ${escapeHtml(
            appeal.providerName ||
            "Provider not supplied"
          )}
        </p>

      </div>


      ${workflowBadge(
        appeal.workflowStatus
      )}

    </div>


    <div class="rating-grid">

      <div class="rating-card">

        <span>
          Rules
        </span>

        ${outcomeBadge(
          appeal.rulesOutcome
        )}

      </div>


      <div class="rating-card">

        <span>
          AI
        </span>

        ${outcomeBadge(
          appeal.aiOutcome
        )}

      </div>


      <div class="rating-card">

        <span>
          Final
        </span>

        ${outcomeBadge(
          appeal.finalOutcome
        )}

      </div>


      <div class="rating-card">

        <span>
          Workflow
        </span>

        ${workflowBadge(
          appeal.workflowStatus
        )}

      </div>

    </div>


    <section class="detail-section">

      <h3>
        Appeal Submission
      </h3>


      <div class="appeal-copy-box">

        <span>
          Appeal Reason
        </span>

        <p>
          ${escapeHtml(
            appeal.appealReason ||
            appealData.appealReason ||
            "Not supplied."
          )}
        </p>

      </div>


      <div class="appeal-copy-box">

        <span>
          Appeal Note
        </span>

        <p>
          ${escapeHtml(
            appeal.appealNote ||
            appealData.appealNote ||
            "Not supplied."
          )}
        </p>

      </div>


      <div class="appeal-copy-box">

        <span>
          Supporting Evidence
        </span>

        <p>
          ${escapeHtml(
            appeal.supportingEvidence ||
            appealData.supportingEvidence ||
            "Not supplied."
          )}
        </p>

      </div>


      <div class="appeal-copy-box">

        <span>
          Diagnosis Codes
        </span>

        <p>
          ${escapeHtml(
            appealDiagnosis
          )}
        </p>

      </div>


      ${
        appealData.clinicalNote

          ? `
            <div class="appeal-copy-box">

              <span>
                Clinical Note
              </span>

              <p>
                ${escapeHtml(
                  appealData.clinicalNote
                )}
              </p>

            </div>
          `

          : ""
      }

    </section>


    <section class="detail-section">

      <h3>
        Appealed Billing Data
      </h3>

      <div class="procedure-list">
        ${procedureHtml}
      </div>

    </section>


    <section class="detail-section">

      <h3>
        Deterministic Appeal Review
      </h3>

      <div class="appeal-results-list">
        ${rulesHtml}
      </div>

    </section>


    <section class="detail-section">

      <h3>
        AI Appeal Evidence Review
      </h3>

      <div class="appeal-results-list">
        ${aiHtml}
      </div>

    </section>
  `;

}


// ==================================================
// PROVIDER ANALYTICS
// ==================================================


function setProviderAnalyticsOverview(
  {
    providers = "—",
    bills = "—",
    flagged = "—",
    rate = "—",
    summary = "Loading provider-level review activity…"
  } = {}
) {

  const summaryElement =
    $("providerAnalyticsSummary");


  if (
    !summaryElement
  ) {

    return;

  }


  summaryElement.textContent =
    summary;


  $("providerAnalyticsProviderCount")
    .textContent =
    String(
      providers
    );


  $("providerAnalyticsBillCount")
    .textContent =
    String(
      bills
    );


  $("providerAnalyticsFlaggedCount")
    .textContent =
    String(
      flagged
    );


  $("providerAnalyticsFlaggedRate")
    .textContent =
    rate;

}


async function refreshProviderAnalyticsOverview() {

  try {

    const response =
      await fetch(
        "/api/providers/stats"
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "Could not load provider analytics."
      );

    }


    const data =
      await response.json();


    const providers =
      Array.isArray(
        data.providers
      )

        ? data.providers
        : [];


    const totals =
      providers.reduce(
        (
          result,
          provider
        ) => ({
          bills:
            result.bills +
            Number(
              provider.totalClaims ||
              0
            ),
          flagged:
            result.flagged +
            Number(
              provider.flaggedClaims ||
              0
            )
        }),
        {
          bills: 0,
          flagged: 0
        }
      );


    const flaggedRate =
      totals.bills >
      0

        ? (
            totals.flagged /
            totals.bills
          ) * 100

        : 0;


    const highestSignal =
      [...providers]
        .sort(
          (
            first,
            second
          ) =>
            Number(
              second.flaggedPercent ||
              0
            ) -
            Number(
              first.flaggedPercent ||
              0
            )
        )[0];


    setProviderAnalyticsOverview({
      providers: providers.length,
      bills: totals.bills,
      flagged: totals.flagged,
      rate: percent(
        flaggedRate
      ),
      summary:
        providers.length ===
        0

          ? "Provider-level patterns will appear as claims are analyzed."

          : highestSignal

            ? `${highestSignal.providerName} has the highest flagged rate at ${percent(highestSignal.flaggedPercent)}.`

            : "Review activity is available across the analyzed provider portfolio."
    });

  } catch (
    error
  ) {

    setProviderAnalyticsOverview({
      providers: "—",
      bills: "—",
      flagged: "—",
      rate: "—",
      summary: "Provider analytics are temporarily unavailable."
    });

  }

}


// =============================================
// LOAD PROVIDER ANALYTICS
// =============================================

async function loadProviderAnalytics() {

  const modal =
    $("providerAnalyticsModal");


  const container =
    $("providerAnalyticsContent");


  modal
    .classList
    .remove(
      "hidden"
    );


  document.body
    .classList
    .add(
      "modal-open"
    );


  container.innerHTML = `
    <div class="empty-small">
      Loading provider analytics...
    </div>
  `;


  try {

    const response =
      await fetch(
        "/api/providers/stats"
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "Could not load provider analytics."
      );

    }


    renderProviderAnalytics(
      data.providers ||
      []
    );

  } catch (
    error
  ) {

    container.innerHTML = `
      <div class="analytics-error">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;

  }

}


// =============================================
// RENDER PROVIDER ANALYTICS
// =============================================

function renderProviderAnalytics(
  providers
) {

  const container =
    $("providerAnalyticsContent");


  if (
    providers.length ===
    0
  ) {

    container.innerHTML = `
      <div class="analytics-empty">

        <strong>
          No provider data yet
        </strong>

        <span>
          Analyze some claims first.
        </span>

      </div>
    `;


    return;

  }


  const totalClaims =
    providers.reduce(
      (
        total,
        provider
      ) =>
        total +
        Number(
          provider.totalClaims ||
          0
        ),
      0
    );


  const totalReview =
    providers.reduce(
      (
        total,
        provider
      ) =>
        total +
        Number(
          provider.reviewClaims ||
          0
        ),
      0
    );


  const totalHigh =
    providers.reduce(
      (
        total,
        provider
      ) =>
        total +
        Number(
          provider.highClaims ||
          0
        ),
      0
    );


  const totalFlagged =
    totalReview +
    totalHigh;


  const portfolioPercent =
    totalClaims >
    0

      ? (
          totalFlagged /
          totalClaims
        ) * 100

      : 0;


  const rows =
    providers
      .map(
        (provider) => {

          const flaggedPercent =
            Number(
              provider.flaggedPercent ||
              0
            );


          return `
            <tr>

              <td>

                <strong class="provider-name">
                  ${escapeHtml(
                    provider.providerName
                  )}
                </strong>

              </td>


              <td class="number-cell">
                ${provider.totalClaims}
              </td>


              <td class="number-cell">

                <span class="analytics-low">
                  ${provider.lowClaims}
                </span>

              </td>


              <td class="number-cell">

                <span class="analytics-review">
                  ${provider.reviewClaims}
                </span>

                <small>
                  ${percent(
                    provider.reviewPercent
                  )}
                </small>

              </td>


              <td class="number-cell">

                <span class="analytics-high">
                  ${provider.highClaims}
                </span>

                <small>
                  ${percent(
                    provider.highPercent
                  )}
                </small>

              </td>


              <td class="number-cell">
                ${provider.flaggedClaims}
              </td>


              <td>

                <div class="percentage-cell">

                  <strong>
                    ${percent(
                      flaggedPercent
                    )}
                  </strong>

                  <div class="percentage-track">

                    <div
                      class="percentage-fill"
                      style="width: ${Math.min(
                        flaggedPercent,
                        100
                      )}%"
                    ></div>

                  </div>

                </div>

              </td>

            </tr>
          `;

        }
      )
      .join(
        ""
      );


  container.innerHTML = `

    <div class="analytics-summary">

      <div class="analytics-summary-card">

        <span>
          Providers
        </span>

        <strong>
          ${providers.length}
        </strong>

      </div>


      <div class="analytics-summary-card">

        <span>
          Total Bills
        </span>

        <strong>
          ${totalClaims}
        </strong>

      </div>


      <div class="analytics-summary-card">

        <span>
          Review
        </span>

        <strong class="summary-review">
          ${totalReview}
        </strong>

      </div>


      <div class="analytics-summary-card">

        <span>
          High
        </span>

        <strong class="summary-high">
          ${totalHigh}
        </strong>

      </div>


      <div class="analytics-summary-card">

        <span>
          Review / High
        </span>

        <strong>
          ${totalFlagged}
        </strong>

      </div>


      <div class="analytics-summary-card">

        <span>
          Portfolio Flagged
        </span>

        <strong>
          ${percent(
            portfolioPercent
          )}
        </strong>

      </div>

    </div>


    <div class="analytics-definition">

      <strong>
        Flagged %
      </strong>

      <span>
        Percentage of this provider's analyzed bills
        with a final rating of REVIEW or HIGH.
      </span>

    </div>


    <div class="analytics-table-wrap">

      <table class="analytics-table">

        <thead>

          <tr>

            <th>
              Provider
            </th>

            <th>
              Bills
            </th>

            <th>
              Low
            </th>

            <th>
              Review
            </th>

            <th>
              High
            </th>

            <th>
              Review / High
            </th>

            <th>
              Flagged %
            </th>

          </tr>

        </thead>


        <tbody>
          ${rows}
        </tbody>

      </table>

    </div>
  `;

}


// =============================================
// CLOSE PROVIDER ANALYTICS
// =============================================

function closeProviderAnalytics() {

  $("providerAnalyticsModal")
    .classList
    .add(
      "hidden"
    );


  document.body
    .classList
    .remove(
      "modal-open"
    );

}


// =============================================
// PROVIDER ANALYTICS BUTTONS
// =============================================

["providerAnalyticsButton", "providerAnalyticsTopButton", "providerAnalyticsOverviewButton"]
  .forEach(
    (buttonId) => {

      $(buttonId)
        ?.addEventListener(
          "click",
          () => {

            closeHeaderPopovers();
            loadProviderAnalytics();

          }
        );

    }
  );


["csvFiles", "appealTxtFiles"]
  .forEach(
    (inputId) => {

      $(inputId)
        .addEventListener(
          "change",
          closeHeaderPopovers
        );

    }
  );


$("closeProviderAnalytics")
  .addEventListener(
    "click",
    closeProviderAnalytics
  );


$("providerAnalyticsModal")
  .addEventListener(
    "click",
    (
      event
    ) => {

      if (
        event.target ===
        $("providerAnalyticsModal")
      ) {

        closeProviderAnalytics();

      }

    }
  );


document
  .addEventListener(
    "keydown",
    (
      event
    ) => {

      if (
        event.key ===
        "Escape"
      ) {

        closeProviderAnalytics();
        closeHeaderPopovers();

      }

    }
  );


// =============================================
// INITIAL LOAD
// =============================================

updateAppealTabSelection();
syncHeaderForMode();
showClaimsList();


refreshClaims(
  false
);


refreshCallQueue();


refreshAppeals(
  false
);


// =============================================
// AUTOMATIC REFRESH
// =============================================

setInterval(
  () => {

    if (
      currentMode ===
      "claims"
    ) {

      refreshClaims(
        false
      );


      refreshCallQueue();

    } else {

      refreshAppeals(
        false
      );

    }

  },
  3000
);
