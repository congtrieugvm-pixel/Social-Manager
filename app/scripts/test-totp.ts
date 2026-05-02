import { generateTotpCode } from "../src/lib/totp";

const cases = [
  "JBSWY3DPEHPK3PXP",
  "jbsw y3dp ehpk 3pxp",
  "JBSW-Y3DP-EHPK-3PXP",
  "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&issuer=X",
  "not-a-secret",
  "",
  "   ",
];

for (const s of cases) {
  console.log(JSON.stringify(s), "=>", generateTotpCode(s));
}
