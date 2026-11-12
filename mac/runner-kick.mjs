// Free fallback trigger for the ATH runner lane (Mac side). Run by LaunchAgent com.ath.runner-kick every 2 minutes.
// 1) Asks the database, with the Mac worker's existing restricted login (Keychain item ath-ops-worker-db, never printed),
//    how many runner jobs are waiting (ath_ops.runner_waiting(): a number only).
// 2) If > 0 and no ath-runner run is already queued/running, starts one with the Mac's existing gh login.
// No new token or secret. When the Mac is off, the GitHub cron (best effort) is the only trigger.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const pg = createRequire("/Users/dspaidnoosleep/spaidbot-app/package.json")("pg");
const GH = "/opt/homebrew/bin/gh", REPO = "spaidsnipes/ath-runner", WF = "ath-runner.yml";
const stamp = () => new Date().toISOString().slice(0, 19) + "Z";
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function main() {
  let url = process.env.ATH_OPS_DB_URL;
  if (!url) { try { url = sh("/usr/bin/security", ["find-generic-password", "-s", "ath-ops-worker-db", "-w"]); } catch { url = ""; } }
  if (!url) return console.log(stamp(), "no worker login in Keychain; nothing to do");
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true }, application_name: "mac-runner-kick" });
  await db.connect();
  let waiting;
  try { waiting = (await db.query("select ath_ops.runner_waiting() as n")).rows[0].n; } finally { await db.end(); }
  if (!waiting) return; // quiet when idle: no log line every 2 minutes
  const active = JSON.parse(sh(GH, ["run", "list", "-R", REPO, "-w", WF, "-L", "10", "--json", "status"]))
    .filter((r) => ["queued", "in_progress", "waiting", "pending", "requested"].includes(r.status)).length;
  if (active) return console.log(stamp(), `${waiting} runner job(s) waiting; a run is already active (${active})`);
  sh(GH, ["workflow", "run", WF, "-R", REPO, "--ref", "main"]);
  console.log(stamp(), `${waiting} runner job(s) waiting; started ${WF}`);
}
main().catch((e) => { console.error(stamp(), "runner-kick:", String(e?.message || e).replace(/postgres(ql)?:\/\/\S+/g, "[db-url]").slice(0, 300)); process.exit(0); });
