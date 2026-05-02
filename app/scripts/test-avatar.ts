import { buildFbAvatarUrl, probeFbAvatarUrl } from "../src/lib/facebook";

const inputs = [
  { type: "numeric UID", v: "100012345678901", expect: false }, // not a real account, may 400
  { type: "well-known UID", v: "4", expect: true },
  { type: "page slug", v: "cocacola", expect: true },
  { type: "user username", v: "zuck", expect: false },
  { type: "placeholder fb_xxx", v: "fb_user_1234", expect: false },
  { type: "special chars", v: "user.name+test", expect: false },
];

async function main() {
  console.log("Generated URLs:\n");
  for (const i of inputs) {
    console.log(`  ${i.type.padEnd(22)} → ${buildFbAvatarUrl(i.v)}`);
  }

  console.log("\nprobeFbAvatarUrl results vs expectation:\n");
  let mismatches = 0;
  for (const i of inputs) {
    const url = buildFbAvatarUrl(i.v);
    const ok = await probeFbAvatarUrl(url);
    const tag = ok ? "✓ image" : "✗ rejected";
    const expected = i.expect ? "✓ image" : "✗ rejected";
    const match = ok === i.expect;
    if (!match) mismatches++;
    console.log(
      `  ${i.type.padEnd(22)} → ${tag.padEnd(11)} (expected ${expected}) ${match ? "PASS" : "FAIL"}`,
    );
  }
  console.log(`\n${mismatches === 0 ? "All probe results match expectation." : `${mismatches} mismatch(es).`}`);
  if (mismatches > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
