import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Cache: in-memory only; switch to KV/R2 when you set up bindings.
  // Override in wrangler.toml + bindings if you need persistent cache.
});
