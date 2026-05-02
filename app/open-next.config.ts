import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Cache: in-memory only; switch to KV/R2 when bindings are added.
  // Override in wrangler.toml + bindings if persistent cache is needed.
});
