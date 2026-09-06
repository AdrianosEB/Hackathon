// =============================================
// DOM helper
// =============================================

const $ =
  (id) =>
    document.getElementById(
      id
    );


// =============================================
// State
// =============================================

let clarificationWatchId =
  null;


let processingBatch =
  false;


let batchEntries =
  [];


let currentSelectedClaimId =
  null;


// =============================================
// HTML escape
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
// Money
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
// Percentage
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
// Risk badge
// =============================================

function riskBadge(
  risk
) {

  const normalized =
    String(
      risk ||
      "low"
    ).toLowerCase();


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
// CSV parser
// =============================================

function parseCsv(
  text
) {

  const rows =
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

        rows.push(
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

      rows.push(
        row
      );

    }

  }


  if (
    rows.length <
    2
  ) {

    throw new Error(
      "CSV must contain a header and at least one claim line."
    );

  }


  const headers =
    rows[0]
      .map(
        (header) =>
          String(
            header
          ).trim()
      );


  return rows
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
// CSV rows -> claim
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
// File selection
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


      renderQueue();

      updateBatchProgress();


      await processBatch();

    }
  );


// =============================================
// Process CSVs sequentially
// =============================================

async function processBatch() {

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

        entry.status =
          "parsing";


        renderQueue();


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


        entry.status =
          "analyzing";


        renderQueue();


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


        entry.status =
          "done";


        entry.result =
          data;


        await refreshClaims(
          false
        );


        await refreshCallQueue();


        if (
          !currentSelectedClaimId &&
          data.id
        ) {

          currentSelectedClaimId =
            data.id;


          await loadClaim(
            data.id
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
          "CSV processing error:",
          error
        );

      }


      renderQueue();

      updateBatchProgress();

    }

  } finally {

    processingBatch =
      false;


    $("csvFiles").disabled =
      false;


    $("headerStatus")
      .textContent =
        "Ready";


    renderQueue();

    updateBatchProgress();


    await refreshClaims(
      false
    );


    await refreshCallQueue();

  }

}


// =============================================
// Import queue
// =============================================

function renderQueue() {

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
                  ).toUpperCase()

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

}


// =============================================
// Batch progress
// =============================================

function updateBatchProgress() {

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


  $("totalFiles").textContent =
    String(
      total
    );


  $("completedFiles").textContent =
    String(
      completed
    );


  $("failedFiles").textContent =
    String(
      failed
    );


  $("progressText").textContent =
    `${processed} / ${total}`;


  const progress =

    total > 0

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


// =============================================
// Refresh claims
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


    const claims =

      Array.isArray(
        data.claims
      )

        ? data.claims

        : [];


    renderClaimsList(
      claims
    );


    if (
      loadFirst &&
      !currentSelectedClaimId &&
      claims.length >
        0
    ) {

      currentSelectedClaimId =
        claims[0].id;


      await loadClaim(
        claims[0].id
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
// Claim list
// =============================================

function renderClaimsList(
  claims
) {

  const container =
    $("claimsList");


  if (
    claims.length ===
    0
  ) {

    container.innerHTML = `
      <div class="empty-small">
        No analyzed claims yet.
      </div>
    `;


    return;

  }


  container.innerHTML =
    claims
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

              <div class="claim-list-top">

                <strong>
                  ${escapeHtml(
                    claim.claimNumber
                  )}
                </strong>

                ${riskBadge(
                  claim.riskLevel
                )}

              </div>

              <span>
                ${escapeHtml(
                  claim.providerName
                )}
              </span>

              <div class="claim-list-ratings">

                <small>
                  Rules:
                  ${escapeHtml(
                    String(
                      claim.rulesRiskLevel ||
                      "low"
                    ).toUpperCase()
                  )}
                </small>

                <small>
                  AI:
                  ${escapeHtml(
                    String(
                      claim.aiRiskLevel ||
                      "unavailable"
                    ).toUpperCase()
                  )}
                </small>

              </div>

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


              renderClaimsList(
                claims
              );


              await loadClaim(
                id
              );

            }
          );

      }
    );

}


// =============================================
// Load one claim
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


    renderResult(
      claim
    );

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
// Claim details
// =============================================

function renderResult(
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

      ? claim.diagnosisCodes.join(
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
                          ).toUpperCase()
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
// Clarification call
// =============================================

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


      try {

        const response =
          await fetch(
            `/api/vapi/calls/${encodeURIComponent(
              claimNumber
            )}`
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


        container.innerHTML = `

          <div class="call-summary">

            <div>

              <span>
                Status
              </span>

              <strong>
                ${escapeHtml(
                  status
                )}
              </strong>

            </div>


            ${
              call.endedReason

                ? `
                  <div>

                    <span>
                      Ended Reason
                    </span>

                    <strong>
                      ${escapeHtml(
                        call.endedReason
                      )}
                    </strong>

                  </div>
                `

                : ""
            }

          </div>


          ${
            transcript

              ? `
                <div class="transcript-box">

                  <strong>
                    Transcript
                  </strong>

                  <pre>${escapeHtml(
                    transcript
                  )}</pre>

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
// Vapi call queue
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
// Render call queue
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


// =============================================
// Provider analytics
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
// Render provider analytics
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
// Close analytics
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
// Analytics buttons
// =============================================

$("providerAnalyticsButton")
  .addEventListener(
    "click",
    loadProviderAnalytics
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

      }

    }
  );


// =============================================
// Initial load
// =============================================

refreshClaims();

refreshCallQueue();


// =============================================
// Automatic refresh
// =============================================

setInterval(
  () => {

    refreshClaims(
      false
    );


    refreshCallQueue();

  },
  3000
);