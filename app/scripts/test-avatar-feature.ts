/**
 * End-to-end check of FB account avatar refresh feature.
 * Samples accounts from DB, runs the same logic the API uses (build URL +
 * probe Graph), reports outcome. Read-only — does not write to DB.
 */
import Database from "better-sqlite3";
import { buildFbAvatarUrl, probeFbAvatarUrl } from "../src/lib/facebook";
import path from "node:path";

async function main() {
  const sqlite = new Database(path.join(process.cwd(), "data", "app.db"), { readonly: true });

  const total = sqlite.prepare("SELECT COUNT(*) AS c FROM facebook_accounts").get() as { c: number };
  const withUid = sqlite.prepare("SELECT COUNT(*) AS c FROM facebook_accounts WHERE fb_user_id IS NOT NULL").get() as { c: number };
  const withoutUid = total.c - withUid.c;

  console.log("=== FB Account avatar refresh — feature test ===\n");
  console.log(`Total FB accounts: ${total.c}`);
  console.log(`  with fb_user_id: ${withUid.c} (avatar fetchable)`);
  console.log(`  without fb_user_id: ${withoutUid} (will be skipped — needs token sync)\n`);

  if (withUid.c === 0) {
    console.log("No accounts with UID — cannot test avatar fetch.");
    return;
  }

  // Sample up to 8 random accounts with UID
  const sample = sqlite
    .prepare(
      `SELECT id, username, fb_user_id, fb_name, fb_profile_pic
       FROM facebook_accounts
       WHERE fb_user_id IS NOT NULL
       ORDER BY RANDOM() LIMIT 8`,
    )
    .all() as Array<{
      id: number;
      username: string;
      fb_user_id: string;
      fb_name: string | null;
      fb_profile_pic: string | null;
    }>;

  console.log(`Probing ${sample.length} sample accounts via Graph picture endpoint:\n`);
  let ok = 0;
  let broken = 0;
  for (const r of sample) {
    const url = buildFbAvatarUrl(r.fb_user_id);
    const works = await probeFbAvatarUrl(url);
    const tag = works ? "✓ avatar live" : "✗ rejected/silhouette";
    if (works) ok++;
    else broken++;
    const stored = r.fb_profile_pic ? "(stored)" : "(NOT stored)";
    console.log(
      `  [${tag}] @${r.username.padEnd(20)} uid=${r.fb_user_id.padEnd(18)} name="${r.fb_name ?? "—"}" ${stored}`,
    );
  }

  console.log(`\n${ok}/${sample.length} avatars are live · ${broken} rejected`);
  console.log("\nSummary:");
  console.log(`  Refresh-avatar API will SUCCESSFULLY refresh ${ok}/${sample.length} of these.`);
  console.log(`  Remaining ${broken} would have fbProfilePic cleared to null (UI shows initial-letter placeholder).`);
  console.log(`  ${withoutUid} accounts without fb_user_id will be SKIPPED with "Thiếu fb_user_id" message.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
