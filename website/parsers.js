// ==================================================
// DEMO FILE PARSERS
//
// demo/*.csv and demo_appeal/*.txt are normally read
// by the browser: website/script.js owns parseCsv and
// parseAppealTxt, and that path is authoritative.
//
// These are faithful mirrors of those two functions,
// so examples/run-demo-files.js can check the shipped
// demo assets from Node without a browser.
//
// The two formats are frozen demo formats. If either
// ever changes, change it in both places.
// ==================================================


// ==================================================
// CSV
//
// One bill per file. Every row repeats the claim
// level columns and contributes one billed line.
// ==================================================

export function parseCsv(
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

      rawRows.push(
        row
      );

      row =
        [];

      value =
        "";

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

    rawRows.push(
      row
    );

  }


  const rows =
    rawRows.filter(
      (entry) =>
        entry.some(
          (cell) =>
            String(
              cell
            ).trim()
        )
    );


  if (
    rows.length <
    2
  ) {

    throw new Error(
      "CSV file needs a header row and at least one billed line."
    );

  }


  const header =
    rows[0].map(
      (cell) =>
        cell.trim()
    );


  return rows
    .slice(1)
    .map(
      (entry) => {

        const record =
          {};


        header.forEach(
          (column, index) => {

            record[column] =
              String(
                entry[index] ||
                ""
              ).trim();

          }
        );


        return record;

      }
    );

}


// --------------------------------------------------
// CSV rows -> one claim
//
// diagnosisCodes are separated by ; or | because the
// comma is already the CSV delimiter.
// --------------------------------------------------

export function claimFromCsv(
  text
) {

  const rows =
    parseCsv(
      text
    );


  const first =
    rows[0];


  const claimNumber =
    first.claimNumber;


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


  return {

    claimNumber,

    providerName:
      first.providerName,

    patientLabel:
      first.patientLabel,

    diagnosisCodes:
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
        .filter(Boolean),

    clinicalNote:
      first.clinicalNote,

    lineItems:
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
      )

  };

}


// ==================================================
// APPEAL TXT
//
//   claimNumber: CLM-10007
//
//   appealNote:
//   Free text, possibly several paragraphs.
//
//   lineItems:
//   74177 | CT abdomen/pelvis | 2026-09-06 | 1 | 450
// ==================================================

const KNOWN_FIELDS =
  new Set([
    "claimNumber",
    "providerName",
    "appealReason",
    "appealNote",
    "diagnosisCodes",
    "clinicalNote",
    "supportingEvidence",
    "lineItems"
  ]);


export function appealFromTxt(
  text
) {

  const normalized =
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
    !normalized.trim()
  ) {

    throw new Error(
      "Appeal TXT file is empty."
    );

  }


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


  for (
    const rawLine
    of normalized.split("\n")
  ) {

    const line =
      rawLine.trim();


    // Blank line keeps paragraph separation.

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
        KNOWN_FIELDS.has(
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

            sections.lineItems.push(
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


    // Text before any known field is decorative.

    if (
      !currentField
    ) {

      continue;

    }


    if (
      currentField ===
      "lineItems"
    ) {

      sections.lineItems.push(
        line
      );


      continue;

    }


    sections[currentField] =

      sections[currentField]
        ? `${sections[currentField]}\n${line}`
        : line;

  }


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
      ).trim();

  }


  if (
    !sections.claimNumber
  ) {

    throw new Error(
      "Appeal TXT is missing claimNumber."
    );

  }


  return {

    claimNumber:
      sections.claimNumber,

    providerName:
      sections.providerName,

    appealReason:
      sections.appealReason,

    appealNote:
      sections.appealNote,

    supportingEvidence:
      sections.supportingEvidence,

    clinicalNote:
      sections.clinicalNote,

    diagnosisCodes:
      sections.diagnosisCodes
        .split(
          /[;,|\n]/
        )
        .map(
          (code) =>
            code.trim()
        )
        .filter(Boolean),

    lineItems:
      sections.lineItems
        .filter(
          (line) =>
            String(
              line
            ).includes("|")
        )
        .map(
          (line) => {

            const parts =
              line
                .split("|")
                .map(
                  (part) =>
                    part.trim()
                );


            return {

              code:
                parts[0] ||
                "",

              description:
                parts[1] ||
                "",

              serviceDate:
                parts[2] ||
                "",

              units:
                Number(
                  parts[3] ||
                  1
                ),

              amount:
                Number(
                  parts[4] ||
                  0
                )

            };

          }
        )

  };

}
