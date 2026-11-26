import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { AuthError } from "@/lib/auth";
import { readBody } from "@/lib/req-body";
import * as service from "@/lib/browser-service";

export const dynamic = "force-dynamic";
async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if ((req.headers.get("x-body")?.length ?? 0) > 16000 || Number(req.headers.get("content-length") ?? 0) > 16000) service.fail("Dữ liệu quá lớn", 413);
    const b = req.method === "GET" ? {} : await readBody<Record<string, unknown>>(req);
    if (!b || typeof b !== "object" || Array.isArray(b)) service.fail("Dữ liệu không hợp lệ");
    if (route === "agent/enroll" && req.method === "POST") return reply(await service.enroll(b));
    if (route === 'agent/login' && req.method === 'POST') return reply(await service.loginDevice(b, process.env.APP_RUNTIME === 'cloudflare' ? req.headers.get('cf-connecting-ip') ?? 'unknown' : 'local'));
    if (route.startsWith("agent/")) {
      const device = await service.authenticateDevice(req);
      if (route === "agent/sync" && req.method === "POST") return reply(await service.sync(device, b));
      if (route === "agent/claim" && req.method === "POST") return reply(await service.claim(device, service.str(b.id, 40)));
      service.fail("Không tìm thấy", 404);
    }
    const owner = await getOwnerId();
    if (req.method !== "GET" && req.headers.get("origin") !== new URL(req.url).origin) service.fail("Nguồn yêu cầu không hợp lệ", 403);
    if (route === "dashboard" && req.method === "GET") {
      const u = new URL(req.url); const raw = u.searchParams.get("ids");
      const selected = raw ? service.ids(raw.split(",").map(Number)) : [];
      return reply(await service.dashboard(owner, u.searchParams.get("q") ?? "", selected));
    }
    if (route === "state" && req.method === "GET") return reply(await service.browserState(owner));
    if (req.method !== "POST") service.fail("Phương thức không hỗ trợ", 405);
    if (route === "proxies/save") return reply(await service.saveProxy(owner, b));
    if (route === "proxies/delete") return reply(await service.deleteProxy(owner, service.id(b.id)));
    if (route === "assign") return reply(await service.assign(owner, b));
    if (route === "account-proxy") return reply(await service.setAccountProxy(owner, b));
    if (route === 'posting/save') return reply(await service.savePosting(owner, b));
    if (route === "pairings") return reply(await service.createPairing(owner));
    if (route === "devices/settings") return reply(await service.deviceSettings(owner, b));
    if (route === "devices/revoke") return reply(await service.revokeDevice(owner, service.str(b.id, 40)));
    if (route === "jobs") return reply(await service.queue(owner, b));
    if (route === "jobs/cancel") return reply(await service.cancel(owner, service.str(b.id, 40)));
    if (route === "profiles/relocate") return reply(await service.relocate(owner, b));
    service.fail("Không tìm thấy", 404);
  } catch (e) {
    if (e instanceof AuthError) return reply({ error: e.message }, e.status);
    return reply({ error: "Không thể xử lý yêu cầu trình duyệt. Hãy thử lại." }, 500);
  }
}
export const GET = handle;
export const POST = handle;
