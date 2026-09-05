// =============================================
// Helpers
// =============================================

const $ = (id) =>
  document.getElementById(id);


const lineItems =
  $("lineItems");


let clarificationWatchId =
  0;



// =============================================
// Risk badge HTML
// =============================================

function riskBadge(
  value
) {

  if (
    !value ||
    value === "unavailable"
  ) {

    return `
      <span class="muted">
        —
      </span>
    `;

  }


  const cssValue =
    value === "medium"
      ? "review"
      : value;


  const displayValue =
    value === "review" ||
    value === "medium"

      ? "REVIEW"

      : String(value)
          .toUpperCase();


  return `

    <span
      class="
        risk-badge
        risk-${escapeHtml(
          cssValue
        )}
      "
    >
      ${escapeHtml(
        displayValue
      )}
    </span>

  `;

}



// =============================================
// Add line
// =============================================

function addLine(
  data = {}
) {

  const row =
    document.createElement(
      "div"
    );


  row.className =
    "line-item";


  row.innerHTML = `

    <label>

      Code

      <input
        data-field="code"
        placeholder="99215"
        value="${escapeHtml(
          data.code || ""
        )}"
      >

    </label>


    <label>

      Description

      <input
        data-field="description"
        placeholder="Office visit"
        value="${escapeHtml(
          data.description || ""
        )}"
      >

    </label>


    <label>

      Date

      <input
        data-field="serviceDate"
        type="date"
        value="${escapeHtml(
          data.serviceDate || ""
        )}"
      >

    </label>


    <label>

      Units

      <input
        data-field="units"
        type="number"
        min="1"
        value="${data.units || 1}"
      >

    </label>


    <label>

      Amount

      <input
        data-field="amount"
        type="number"
        min="0"
        step="0.01"
        value="${data.amount ?? ""}"
      >

    </label>


    <button
      type="button"
      class="remove-btn"
      title="Remove"
    >
      ×
    </button>

  `;


  row
    .querySelector(
      ".remove-btn"
    )
    .onclick =
      () => {

        if (
          lineItems.children
            .length >
          1
        ) {

          row.remove();

        }

      };


  lineItems.appendChild(
    row
  );

}



// =============================================
// Add line button
// =============================================

$("addLineBtn").onclick =
  () => {

    addLine();

  };



addLine();



// =============================================
// Collect claim
// =============================================

function collectClaim() {

  return {

    claimNumber:
      $("claimNumber").value,

    providerName:
      $("providerName").value,

    patientLabel:
      $("patientLabel").value,


    diagnosisCodes:

      $("diagnosisCodes")
        .value
        .split(",")
        .map(
          (code) =>
            code.trim()
        )
        .filter(Boolean),


    clinicalNote:
      $("clinicalNote").value,


    lineItems:

      [
        ...document
          .querySelectorAll(
            ".line-item"
          )
      ]
        .map(
          (row) => ({

            code:

              row
                .querySelector(
                  '[data-field="code"]'
                )
                .value,


            description:

              row
                .querySelector(
                  '[data-field="description"]'
                )
                .value,


            serviceDate:

              row
                .querySelector(
                  '[data-field="serviceDate"]'
                )
                .value,


            units:

              Number(

                row
                  .querySelector(
                    '[data-field="units"]'
                  )
                  .value ||
                1

              ),


            amount:

              Number(

                row
                  .querySelector(
                    '[data-field="amount"]'
                  )
                  .value ||
                0

              )

          })
        )

  };

}



// =============================================
// Submit claim
// =============================================

$("claimForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();


      const payload =
        collectClaim();


      $("formError")
        .classList
        .add("hidden");


      try {

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
                  payload
                )

            }
          );


        const data =
          await response.json();


        if (
          !response.ok
        ) {

          throw new Error(

            (
              data.errors ||
              [data.error]
            )
              .filter(Boolean)
              .join(" ")

          );

        }


        renderResult(
          data
        );


        await refreshClaims();


      } catch (error) {

        $("formError")
          .textContent =
            error.message;


        $("formError")
          .classList
          .remove("hidden");

      }

    }
  );



// =============================================
// Render result
// =============================================

function renderResult(
  claim
) {

  $("emptyResult")
    .classList
    .add("hidden");


  const box =
    $("resultContent");


  box
    .classList
    .remove("hidden");



  // =============================================
  // Ratings
  // =============================================

  const rulesRiskLevel =
    claim.rulesRiskLevel ||
    "low";


  const aiRiskLevel =
    claim.aiRiskLevel ||
    "unavailable";


  const riskLevel =
    claim.riskLevel ||
    "low";



  // =============================================
  // Procedures
  // =============================================

  const proceduresHtml =

    Array.isArray(
      claim.lineItems
    )

      ? claim.lineItems
          .map(
            (item) => `

              <div
                class="procedure-row"
              >

                <strong>
                  ${escapeHtml(
                    item.code
                  )}
                </strong>


                <span>
                  ${escapeHtml(
                    item.description ||
                    "—"
                  )}
                </span>


                <span>

                  ${
                    item.units ||
                    1
                  }

                  unit${
                    Number(
                      item.units ||
                      1
                    ) === 1
                      ? ""
                      : "s"
                  }

                </span>


                <strong
                  class="procedure-amount"
                >
                  ${money(
                    item.amount
                  )}
                </strong>

              </div>

            `
          )
          .join("")

      : "";



  // =============================================
  // Findings
  // =============================================

  const findings =
    Array.isArray(
      claim.flags
    )
      ? claim.flags
      : [];


  const findingsHtml =

    findings.length

      ? findings
          .map(
            (flag) => {

              const detectedBy =

                Array.isArray(
                  flag.detectedBy
                )

                  ? flag.detectedBy

                  : ["rules"];


              let badges =
                "";


              if (
                detectedBy.includes(
                  "rules"
                )
              ) {

                badges += `

                  <span
                    class="
                      analysis-source
                      rules-source
                    "
                  >
                    RULES
                  </span>

                `;

              }


              if (
                detectedBy.includes(
                  "ai"
                )
              ) {

                badges += `

                  <span
                    class="
                      analysis-source
                      ai-source
                    "
                  >
                    AI
                  </span>

                `;

              }



              let aiReview =
                "";


              if (
                flag.aiReview
              ) {

                aiReview = `

                  <div
                    class="ai-review"
                  >

                    <div
                      class="ai-review-title"
                    >
                      AI REVIEW
                    </div>


                    ${
                      flag.aiReview
                        .message

                        ? `

                            <p>
                              ${escapeHtml(
                                flag
                                  .aiReview
                                  .message
                              )}
                            </p>

                          `

                        : ""
                    }


                    ${
                      flag.aiReview
                        .evidence

                        ? `

                            <div
                              class="ai-evidence"
                            >
                              ${escapeHtml(
                                flag
                                  .aiReview
                                  .evidence
                              )}
                            </div>

                          `

                        : ""
                    }


                    ${
                      flag.aiReview
                        .reason

                        ? `

                            <div
                              class="ai-reason"
                            >
                              ${escapeHtml(
                                flag
                                  .aiReview
                                  .reason
                              )}
                            </div>

                          `

                        : ""
                    }

                  </div>

                `;

              }


              const severityClass =

                flag.severity ===
                "medium"

                  ? "review"

                  : flag.severity;


              return `

                <div class="flag">


                  <div
                    class="finding-header"
                  >

                    <strong>
                      ${escapeHtml(
                        flag.message
                      )}
                    </strong>


                    <span
                      class="
                        risk-badge
                        risk-${severityClass}
                      "
                    >
                      ${
                        flag.severity ===
                        "medium"

                          ? "REVIEW"

                          : escapeHtml(
                              String(
                                flag.severity
                              ).toUpperCase()
                            )
                      }
                    </span>

                  </div>


                  ${
                    flag.lineCode

                      ? `

                          <div
                            class="finding-code"
                          >
                            Procedure
                            ${escapeHtml(
                              flag.lineCode
                            )}
                          </div>

                        `

                      : ""
                  }


                  <div
                    class="analysis-sources"
                  >
                    ${badges}
                  </div>


                  ${
                    flag.evidence

                      ? `

                          <p>
                            ${escapeHtml(
                              flag.evidence
                            )}
                          </p>

                        `

                      : ""
                  }


                  ${aiReview}


                </div>

              `;

            }
          )
          .join("")

      : `

          <div class="flag">

            <strong>
              No major findings
            </strong>

          </div>

        `;



  // =============================================
  // Diagnosis
  // =============================================

  const diagnosisText =

    Array.isArray(
      claim.diagnosisCodes
    ) &&
    claim.diagnosisCodes.length

      ? claim
          .diagnosisCodes
          .join(", ")

      : "—";



  // =============================================
  // Vapi section only for FINAL HIGH
  // =============================================

  const clarificationHtml =

    riskLevel === "high"

      ? `

          <div
            id="clarificationCall"
            class="clarification-call"
          >

            <h3>
              Clarification Call
            </h3>


            <p class="muted">
              Checking status...
            </p>

          </div>

        `

      : "";



  // =============================================
  // Main result
  // =============================================

  box.innerHTML = `

    <div
      class="claim-result-header"
    >

      <div>

        <h2>
          ${escapeHtml(
            claim.claimNumber
          )}
        </h2>


        <p class="muted">
          ${escapeHtml(
            claim.providerName
          )}
        </p>

      </div>


      ${riskBadge(
        riskLevel
      )}

    </div>



    <!-- ========================================
         THREE RATINGS
    ========================================= -->

    <div class="claim-meta">


      <div>

        <span>
          Rules
        </span>

        ${riskBadge(
          rulesRiskLevel
        )}

      </div>



      <div>

        <span>
          AI
        </span>

        ${riskBadge(
          aiRiskLevel
        )}

      </div>



      <div>

        <span>
          Final
        </span>

        ${riskBadge(
          riskLevel
        )}

      </div>



      <div>

        <span>
          Total billed
        </span>

        <strong>
          ${money(
            claim.totalBilled
          )}
        </strong>

      </div>


    </div>



    <div class="claim-meta">


      <div>

        <span>
          Review amount
        </span>

        <strong>
          ${money(
            claim.reviewAmount
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
          Findings
        </span>

        <strong>
          ${findings.length}
        </strong>

      </div>


    </div>



    ${
      claim.clinicalNote

        ? `

            <div
              class="result-section"
            >

              <h3>
                Clinical Note
              </h3>


              <div class="flag">

                <p>
                  ${escapeHtml(
                    claim.clinicalNote
                  )}
                </p>

              </div>

            </div>

          `

        : ""
    }



    <div
      class="result-section"
    >

      <h3>
        Procedures
      </h3>


      <div
        class="procedure-list"
      >
        ${proceduresHtml}
      </div>

    </div>



    <div
      class="result-section"
    >

      <h3>
        Findings
      </h3>


      <div class="flags">
        ${findingsHtml}
      </div>

    </div>



    ${clarificationHtml}

  `;



  // =============================================
  // Only final HIGH polls Vapi
  // =============================================

  if (
    riskLevel === "high"
  ) {

    watchClarificationCall(
      claim.claimNumber
    );

  } else {

    clarificationWatchId +=
      1;

  }

}



// =============================================
// Refresh past claims
// =============================================

async function refreshClaims() {

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


    $("claimsTable")
      .innerHTML =

        claims.length

          ? claims
              .map(
                (claim) => `

                  <tr
                    data-id="${claim.id}"
                  >


                    <td>

                      <strong>
                        ${escapeHtml(
                          claim.claimNumber
                        )}
                      </strong>

                    </td>



                    <td>
                      ${escapeHtml(
                        claim.providerName
                      )}
                    </td>



                    <td>
                      ${riskBadge(
                        claim.rulesRiskLevel
                      )}
                    </td>



                    <td>
                      ${riskBadge(
                        claim.aiRiskLevel
                      )}
                    </td>



                    <td>
                      ${riskBadge(
                        claim.riskLevel
                      )}
                    </td>


                  </tr>

                `
              )
              .join("")

          : `

              <tr>

                <td
                  colspan="5"
                  class="muted"
                >
                  No claims yet.
                </td>

              </tr>

            `;



    // =============================================
    // Open past claim
    // =============================================

    document
      .querySelectorAll(
        "#claimsTable tr[data-id]"
      )
      .forEach(
        (row) => {

          row.style.cursor =
            "pointer";


          row.onclick =
            async () => {

              try {

                const response =
                  await fetch(

                    `/api/claims/${
                      row.dataset.id
                    }`

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


                renderResult(
                  claim
                );


              } catch (error) {

                console.error(
                  "Could not open claim:",
                  error
                );

              }

            };

        }
      );


  } catch (error) {

    console.error(
      "Could not load claims:",
      error
    );

  }

}



// =============================================
// Load clarification call
// =============================================

async function loadClarificationCall(
  claimNumber,
  watchId
) {

  const container =
    $("clarificationCall");


  if (
    !container
  ) {

    return true;

  }


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
        "Could not load call."
      );

    }


    const calls =
      await response.json();


    if (
      watchId !==
      clarificationWatchId
    ) {

      return true;

    }



    // =============================================
    // No call yet
    // =============================================

    if (
      !Array.isArray(calls) ||
      calls.length === 0
    ) {

      container.innerHTML = `

        <h3>
          Clarification Call
        </h3>

        <p class="muted">
          Waiting for call...
        </p>

      `;


      return false;

    }



    const call =
      calls[0];



    // =============================================
    // Completed
    // =============================================

    if (
      call.status ===
      "ended"
    ) {

      container.innerHTML = `

        <h3>
          Clarification Call
        </h3>


        <div
          class="call-complete"
        >
          ✓ Completed
        </div>


        ${
          call.endedReason

            ? `

                <div
                  class="call-details"
                >

                  <p>

                    <strong>
                      End reason:
                    </strong>

                    ${escapeHtml(
                      call.endedReason
                    )}

                  </p>

                </div>

              `

            : ""
        }


        ${
          call.transcript

            ? `

                <div
                  class="transcript-section"
                >

                  <h4>
                    Transcript
                  </h4>


                  <div
                    class="transcript"
                  >
                    ${escapeHtml(
                      call.transcript
                    )}
                  </div>

                </div>

              `

            : `

                <p class="muted">
                  No transcript available.
                </p>

              `
        }

      `;


      return true;

    }



    // =============================================
    // Active call
    // =============================================

    container.innerHTML = `

      <h3>
        Clarification Call
      </h3>


      <div
        class="call-in-progress"
      >

        Status:
        ${escapeHtml(
          call.status ||
          "in-progress"
        )}

      </div>


      <p class="muted">
        Waiting for clarification...
      </p>

    `;


    return false;


  } catch (error) {

    console.error(
      "Clarification check failed:",
      error
    );


    container.innerHTML = `

      <h3>
        Clarification Call
      </h3>

      <p class="muted">
        Clarification status unavailable.
      </p>

    `;


    return false;

  }

}



// =============================================
// Poll every 3 seconds
// =============================================

function watchClarificationCall(
  claimNumber
) {

  clarificationWatchId +=
    1;


  const thisWatch =
    clarificationWatchId;


  let attempts =
    0;


  const maxAttempts =
    120;


  async function check() {

    if (
      thisWatch !==
      clarificationWatchId
    ) {

      return;

    }


    attempts +=
      1;


    const finished =
      await loadClarificationCall(
        claimNumber,
        thisWatch
      );


    if (
      finished
    ) {

      return;

    }


    if (
      attempts >=
      maxAttempts
    ) {

      return;

    }


    setTimeout(
      check,
      3000
    );

  }


  check();

}



// =============================================
// Demo claims
// =============================================

const demoClaims = {


  // =============================================
  // Demo 1 — Clean
  // =============================================

  clean: {

    providerName:
      "Northside Medical Center",

    patientLabel:
      "Patient A",

    diagnosisCodes:
      "J06.9",

    clinicalNote:
      "Patient presents with mild upper respiratory symptoms. Exam is consistent with a routine outpatient visit.",


    lineItems: [

      {

        code:
          "99213",

        description:
          "Office visit",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          105

      },


      {

        code:
          "85025",

        description:
          "Complete blood count",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          25

      }

    ]

  },



  // =============================================
  // Demo 2 — Review
  // =============================================

  review: {

    providerName:
      "Lakeside Health Clinic",

    patientLabel:
      "Patient B",

    diagnosisCodes:
      "R07.9",

    clinicalNote:
      "Patient reports intermittent chest discomfort. Patient is stable. Evaluation performed during outpatient visit.",


    lineItems: [

      {

        code:
          "93000",

        description:
          "Electrocardiogram",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          145

      },


      {

        code:
          "99214",

        description:
          "Office visit",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          190

      }

    ]

  },



  // =============================================
  // Demo 3 — High
  // =============================================

  high: {

    providerName:
      "Northside Medical Center",

    patientLabel:
      "Patient C",

    diagnosisCodes:
      "R10.9",

    clinicalNote:
      "Patient reports mild abdominal discomfort. Stable and in no acute distress.",


    lineItems: [

      {

        code:
          "74177",

        description:
          "CT abdomen/pelvis",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          1850

      },


      {

        code:
          "74177",

        description:
          "CT abdomen/pelvis",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          1850

      },


      {

        code:
          "99215",

        description:
          "High-complexity office visit",

        serviceDate:
          "2026-09-05",

        units:
          1,

        amount:
          620

      }

    ]

  }

};



// =============================================
// Load selected demo
// =============================================

$("demoBtn").onclick =
  () => {

    const demo =
      demoClaims[
        $("demoSelect").value
      ];


    if (
      !demo
    ) {

      return;

    }


    $("claimNumber").value =

      `CLM-${
        Math.floor(
          10000 +
          Math.random() *
          89999
        )
      }`;


    $("providerName").value =
      demo.providerName;


    $("patientLabel").value =
      demo.patientLabel;


    $("diagnosisCodes").value =
      demo.diagnosisCodes;


    $("clinicalNote").value =
      demo.clinicalNote;


    lineItems.innerHTML =
      "";


    demo.lineItems.forEach(
      (item) => {

        addLine(
          item
        );

      }
    );

  };



// =============================================
// Money
// =============================================

function money(
  value
) {

  return new Intl.NumberFormat(
    "en-US",
    {

      style:
        "currency",

      currency:
        "USD",

      maximumFractionDigits:
        0

    }
  ).format(
    Number(
      value ||
      0
    )
  );

}



// =============================================
// Escape HTML
// =============================================

function escapeHtml(
  value
) {

  return String(
    value ??
    ""
  ).replace(
    /[&<>'"]/g,
    (character) => ({

      "&":
        "&amp;",

      "<":
        "&lt;",

      ">":
        "&gt;",

      "'":
        "&#039;",

      '"':
        "&quot;"

    })[character]
  );

}



// =============================================
// Start
// =============================================

refreshClaims();


setInterval(
  refreshClaims,
  3000
);