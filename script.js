// =============================================
// Helper
// =============================================

const $ = (id) =>
  document.getElementById(id);


const lineItems =
  $("lineItems");


// =============================================
// Add claim line
// =============================================

function addLine(data = {}) {

  const row =
    document.createElement("div");


  row.className =
    "line-item";


  row.innerHTML = `

    <label>

      Code

      <input
        data-field="code"
        placeholder="99215"
        value="${escapeHtml(data.code || "")}"
      >

    </label>


    <label>

      Description

      <input
        data-field="description"
        placeholder="Office visit"
        value="${escapeHtml(data.description || "")}"
      >

    </label>


    <label>

      Date

      <input
        data-field="serviceDate"
        type="date"
        value="${escapeHtml(data.serviceDate || "")}"
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
        placeholder="450"
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


  // Remove a claim line

  row
    .querySelector(
      ".remove-btn"
    )
    .onclick = () => {

      // Always leave at least one line

      if (
        lineItems.children.length > 1
      ) {

        row.remove();

      }

    };


  lineItems.appendChild(row);

}


// =============================================
// Add-line button
// =============================================

$("addLineBtn").onclick = () => {

  addLine();

};


// Add initial empty line

addLine();


// =============================================
// Form submission
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


        if (!response.ok) {

          throw new Error(

            (
              data.errors ||
              [data.error]
            )

              .filter(Boolean)

              .join(" ")

          );

        }


        // Show result

        renderResult(data);


        // Immediately refresh dashboard

        await refreshDashboard();


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
// Collect claim from form
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
        ...document.querySelectorAll(
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
                  .value || 1

              ),


            amount:

              Number(

                row
                  .querySelector(
                    '[data-field="amount"]'
                  )
                  .value || 0

              )

          })
        )

  };

}


// =============================================
// Render one analysis
// =============================================

function renderResult(claim) {

  $("emptyResult")
    .classList
    .add("hidden");


  const box =
    $("resultContent");


  box
    .classList
    .remove("hidden");


  const riskClass =
    `risk-${claim.riskLevel}`;


  box.innerHTML = `

    <div class="score-row">

      <div>

        <div class="score">
          ${claim.riskScore}
        </div>

        <div class="muted">
          anomaly score / 100
        </div>

      </div>


      <span
        class="risk-badge ${riskClass}"
      >

        ${
          claim.riskLevel === "review"
            ? "Needs review"
            : claim.riskLevel
        }

      </span>

    </div>



    <h2>
      ${escapeHtml(claim.claimNumber)}
    </h2>


    <p class="muted">
      ${escapeHtml(claim.providerName)}
    </p>



    <div class="result-meta">


      <div>

        <span>
          TOTAL BILLED
        </span>

        <strong>
          ${money(claim.totalBilled)}
        </strong>

      </div>


      <div>

        <span>
          REVIEW AMOUNT
        </span>

        <strong>
          ${money(claim.reviewAmount)}
        </strong>

      </div>


      <div>

        <span>
          FLAGS
        </span>

        <strong>
          ${claim.flags.length}
        </strong>

      </div>


      <div>

        <span>
          DIAGNOSES
        </span>

        <strong>

          ${
            claim.diagnosisCodes.length ||
            "—"
          }

        </strong>

      </div>


    </div>



    <h3>
      Evidence & screening signals
    </h3>



    <div class="flags">

      ${
        claim.flags.length

        ?

        claim.flags

          .map(
            (flag) => `

              <div class="flag">

                <strong>

                  ${escapeHtml(flag.message)}

                  <span class="severity">

                    ${escapeHtml(flag.severity)}

                  </span>

                </strong>


                <p>

                  ${escapeHtml(flag.evidence || "")}

                </p>

              </div>

            `
          )

          .join("")

        :

        `

          <div class="flag">

            <strong>
              No major screening signals detected.
            </strong>

            <p>

              This does not guarantee claim correctness;
              it means the current MVP rules did not flag it.

            </p>

          </div>

        `

      }

    </div>

  `;

}


// =============================================
// Dashboard
// =============================================

async function refreshDashboard() {

  try {

    const response =
      await fetch(
        "/api/dashboard"
      );


    const data =
      await response.json();


    // Update cards

    $("claimsAnalyzed")
      .textContent =
        data.stats.claimsAnalyzed;


    $("claimsFlagged")
      .textContent =
        data.stats.claimsFlagged;


    $("reviewAmount")
      .textContent =
        money(
          data.stats.reviewAmount
        );


    $("duplicateFlags")
      .textContent =
        data.stats.duplicateFlags;


    // Build dashboard table

    $("claimsTable")
      .innerHTML =

        data.claims.length

        ?

        data.claims

          .map(
            (claim) => `

              <tr
                data-id="${claim.id}"
              >

                <td>

                  <strong>
                    ${escapeHtml(claim.claimNumber)}
                  </strong>

                </td>


                <td>

                  ${escapeHtml(claim.providerName)}

                </td>


                <td>

                  ${money(claim.totalBilled)}

                </td>


                <td>

                  <span
                    class="risk-badge risk-${claim.riskLevel}"
                  >

                    ${
                      claim.riskLevel === "review"
                        ? "Review"
                        : claim.riskLevel
                    }

                  </span>

                </td>


                <td>

                  ${money(claim.reviewAmount)}

                </td>


                <td>

                  ${claim.flags.length}

                </td>


              </tr>

            `
          )

          .join("")

        :

        `

          <tr>

            <td
              colspan="6"
              class="muted"
            >

              No claims yet.

            </td>

          </tr>

        `;


    // Allow table rows to be clicked

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

              const response =
                await fetch(
                  `/api/claims/${row.dataset.id}`
                );


              const claim =
                await response.json();


              renderResult(
                claim
              );


              window.scrollTo({

                top:
                  250,

                behavior:
                  "smooth"

              });

            };

        }
      );


  } catch (error) {

    console.error(
      "Dashboard refresh failed:",
      error
    );

  }

}


// =============================================
// Demo claim
// =============================================

$("demoBtn").onclick = () => {

  // Random claim ID

  $("claimNumber").value =

    `CLM-${
      Math.floor(
        10000 +
        Math.random() *
        89999
      )
    }`;


  $("providerName").value =
    "Northside Medical Center";


  $("patientLabel").value =
    "Patient A";


  $("diagnosisCodes").value =
    "R10.9";


  $("clinicalNote").value =
    "Patient reports mild abdominal discomfort. Stable and in no acute distress.";


  // Clear existing claim lines

  lineItems.innerHTML =
    "";


  // Deliberately suspicious example

  addLine({

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

  });


  addLine({

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

  });


  addLine({

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

  });

};


// =============================================
// Money formatting
// =============================================

function money(value) {

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
    Number(value || 0)
  );

}


// =============================================
// Prevent HTML injection
// =============================================

function escapeHtml(value) {

  return String(
    value ?? ""
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
// Start dashboard
// =============================================

refreshDashboard();


// Refresh every 3 seconds

setInterval(

  refreshDashboard,

  3000

);