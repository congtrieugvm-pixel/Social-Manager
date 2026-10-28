export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runAutoComment(env));
  },
};

async function runAutoComment(env) {
  const res = await env.APP.fetch("https://social-manager/api/cron/autocomment", {
    method: "POST",
    headers: { "x-cron-secret": env.CRON_SECRET ?? "" },
  });
  // Visible in `wrangler tail social-manager-cron`.
  console.log("autocomment", res.status, (await res.text()).slice(0, 500));
}
