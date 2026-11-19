import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { AuthError } from "@/lib/auth";
import { YtError, resolveChannel } from "@/lib/youtube";
import {
  NexlevError,
  facelessOutliers,
  nicheFinder,
  nicheOverview,
  searchYoutube,
  similarChannels,
  type FinderParams,
  type OutlierParams,
  type SearchParams,
} from "@/lib/nexlev";

// POST — NexLev niche research for Bookmark Key (signed-in users only).
//   { mode: "search", query, type?, sortBy?, uploadDate?, duration?, token? }
//   { mode: "similar", channel, level?: 1|2|3, channelType?: "all"|"short" }
//   { mode: "niche", channel }
//   { mode: "finder", query, page?, minSubscribers?, …FinderParams }   (MCP)
//   { mode: "outliers", query?, page?, minOutlierScore?, …OutlierParams } (MCP)
// `channel` is a UC… id or any YouTube channel / @handle / video link.

const UC_RE = /^UC[\w-]{22}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Copy only known keys with the expected type (numbers ≥ 0, booleans, YYYY-MM-DD dates). */
function filters(body: Record<string, unknown>, spec: { nums?: string[]; bools?: string[]; dates?: string[] }) {
  const out: Record<string, unknown> = {};
  for (const k of spec.nums ?? []) {
    const v = typeof body[k] === "string" ? Number(body[k]) : body[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  for (const k of spec.bools ?? []) if (typeof body[k] === "boolean") out[k] = body[k];
  for (const k of spec.dates ?? []) if (typeof body[k] === "string" && DATE_RE.test(body[k] as string)) out[k] = body[k];
  return out;
}

const page = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 50 ? v : 1);

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

async function toChannelId(raw: unknown): Promise<{ id: string; title: string | null }> {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new YtError("Chưa nhập link kênh");
  if (UC_RE.test(s)) return { id: s, title: null };
  const fromPath = s.match(/\/channel\/(UC[\w-]{22})/)?.[1];
  if (fromPath) return { id: fromPath, title: null };
  const info = await resolveChannel(s);
  return { id: info.channelId, title: info.title };
}

export async function POST(req: Request) {
  try {
    await getOwnerId();
    const body = await readBody<Record<string, unknown>>(req);
    const mode = body.mode;

    if (mode === "search") {
      const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
      if (!query) return NextResponse.json({ error: "Nhập chủ đề cần tìm" }, { status: 400 });
      const params: SearchParams = {
        query,
        type: pick(body.type, ["channel", "video", "shorts"] as const) ?? "channel",
        sortBy: pick(body.sortBy, ["relevance", "popularity", "date", "views"] as const),
        uploadDate: pick(body.uploadDate, ["hour", "today", "week", "month", "year"] as const),
        duration: pick(body.duration, ["short", "medium", "long"] as const),
        token: typeof body.token === "string" ? body.token.slice(0, 4000) : undefined,
      };
      return NextResponse.json(await searchYoutube(params));
    }

    if (mode === "finder") {
      const params: FinderParams = {
        query: typeof body.query === "string" ? body.query.trim().slice(0, 200) : "",
        page: page(body.page),
        sortBy: pick(body.sortBy, ["subscribers", "avgViewsPerVideo", "daysSinceStart", "totalVideos", "totalRevenue", "createdAt"] as const),
        ...filters(body, {
          nums: ["minSubscribers", "maxSubscribers", "minMonthlyRevenue", "minRpm", "minAvgViewsPerVideo", "minOutlierScore"],
          bools: ["isFaceless", "isMonetizationEnabled", "isShortsOnly"],
          dates: ["channelCreatedAfter", "lastUploadAfter"],
        }),
      };
      const r = await nicheFinder(params);
      return NextResponse.json({ ...r, videos: [] });
    }

    if (mode === "outliers") {
      const params: OutlierParams = {
        query: typeof body.query === "string" ? body.query.trim().slice(0, 200) : "",
        page: page(body.page),
        videoType: pick(body.videoType, ["long", "shorts"] as const),
        sortBy: pick(body.sortBy, ["outlierScore", "videoViews", "videoPublishedAt", "channelSubCount"] as const),
        ...filters(body, { nums: ["minOutlierScore", "maxSubscribers", "minViews"], bools: ["isAiContent"], dates: ["minUploadDate"] }),
      };
      const r = await facelessOutliers(params);
      return NextResponse.json({ ...r, channels: [] });
    }

    if (mode === "similar" || mode === "niche") {
      const source = await toChannelId(body.channel);
      if (mode === "similar") {
        const level = ([1, 2, 3] as const).find((l) => l === body.level) ?? 1;
        const channelType = body.channelType === "short" ? "short" : "all";
        return NextResponse.json({ source, channels: await similarChannels(source.id, level, channelType), videos: [] });
      }
      return NextResponse.json({ source, ...(await nicheOverview(source.id)) });
    }

    return NextResponse.json({ error: "mode không hợp lệ" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof NexlevError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof YtError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `Lỗi server: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
