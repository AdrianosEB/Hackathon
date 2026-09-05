import { DatabaseSync } from "node:sqlite";

const db =
  new DatabaseSync("claims.db");

const claims =
  db.prepare(`
    SELECT *
    FROM claims
    ORDER BY created_at DESC
  `).all();

const vapiCalls =
  db.prepare(`
    SELECT *
    FROM vapi_calls
    ORDER BY created_at DESC
  `).all();

console.log("\n=== CLAIMS ===\n");
console.dir(claims, {
  depth: null
});

console.log("\n=== VAPI CALLS ===\n");
console.dir(vapiCalls, {
  depth: null
});