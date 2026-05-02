# TikTok Account Metrics Fetching Strategy — Research Report
**Date**: 2026-04-19 | **Context**: 500-account manager, 4-hour refresh cycle, zero-cost/low-cost approach

---

## RECOMMENDATION SUMMARY

**PRIMARY**: `@tobyg74/tiktok-api-dl` (v1.3.7, actively maintained, 18k weekly downloads)
**FALLBACK**: HTML scraping via `__UNIVERSAL_DATA_FOR_REHYDRATION__` + residential proxies
**NOT VIABLE**: `tiktok-scraper` (deprecated, last update 5 years ago)

---

## PRIMARY STRATEGY: @tobyg74/tiktok-api-dl

### Status & Maintainership
- **Latest version**: 1.3.7 (April 2026)
- **Weekly downloads**: 18,345 (healthy adoption)
- **Maintenance**: Active — ≥1 release in last 3 months
- **License**: ISC (permissive, commercial-safe)
- **Health**: Snyk rated with ongoing maintenance

### Capabilities
✓ User profile fetch by username (no login required)
✓ Follower count, following count, video count, verified status
✓ User posts with metadata (ID, caption, view/like counts)
✓ No official API key required
✓ Stateless operation

### Sample Code Structure
```javascript
const TikTok = require('@tobyg74/tiktok-api-dl');

// Get user profile
const profile = await TikTok.getUserProfile('username');
// Returns: { followerCount, followingCount, videoCount, signature, avatarUrl, isVerified }

// Get user videos
const videos = await TikTok.getUserPosts('username');
// Returns: [{ id, desc (caption), cover, stats: { playCount, diggCount, shareCount } }]
```

### Rate Limits & Throttling Guidance
- **No documented hard limit** (undocumented by TikTok, inferred from community reports)
- **Safe pattern**: 100-200ms delay between consecutive requests
- **Concurrency**: Max 3-5 parallel requests per IP
- **For 500 accounts × 6 syncs/day**: Space requests over 2-4 hour windows, stagger by 500-1000ms

### Risk Assessment
- **Level**: MEDIUM (TikTok actively fights scrapers; library may break on structure changes)
- **Mitigation**:
  - Monitor GitHub issues weekly for breakage reports
  - Pin version `1.3.7`; test updates before deployment
  - Implement fallback to HTML scraping if library breaks
  - Log response status codes to detect early failures

---

## FALLBACK: HTML SCRAPING + RESIDENTIAL PROXIES

### Technique: `__UNIVERSAL_DATA_FOR_REHYDRATION__`
- **Status April 2026**: Still viable but increasingly hostile
- **Location**: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` in HTML source
- **Data**: Contains user profile, video metadata, follower counts as embedded JSON
- **Alternative sources**: `SIGI_STATE`, `__NEXT_DATA__` (fallback priority)

### Implementation Outline
```javascript
const { HttpsProxyAgent } = require('https-proxy-agent');

async function scrapeProfile(username, proxyUrl) {
  const agent = new HttpsProxyAgent(proxyUrl);
  const response = await fetch(`https://www.tiktok.com/@${username}`, {
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  
  const html = await response.text();
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">(.*?)<\/script>/s);
  const data = JSON.parse(match[1]);
  
  const profile = data?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.['userInfo'];
  return {
    followerCount: profile?.stats?.followerCount,
    videoCount: profile?.stats?.videoCount,
    followingCount: profile?.stats?.heartCount
  };
}
```

### Anti-Bot Requirements (April 2026)
- **Cloudflare challenge**: Always present; residential proxy required
- **Device fingerprinting**: TLS fingerprint checked; must use real browser UA + headers
- **msToken/webid**: Session cookies. Reuse within 30 mins, refresh every 2 hours
- **IP requirements**: Datacenter IPs blocked; residential (home/mobile ISP) needed
- **Behavioral analysis**: ML flags rapid sequential requests; use 1-2 sec jitter

### Proxy Service Options
| Service | Est. Cost/mo (3k req/day) | Notes |
|---------|--------------------------|-------|
| **Bright Data** | $100-300 | Enterprise-grade, most reliable |
| **SmartProxy** | $50-150 | Budget option, decent quality |
| **Oxylabs** | $150-400 | High-quality but pricier |
| **Residential proxy pools** | $20-80 | DIY risky; high block rate |

**Calc**: 500 accounts × 6 syncs/day × 4 requests/account (profile + 3 videos) = ~12k requests/day
**Cost at $0.05/req**: $600/month (if non-residential proxy)
**Cost with residential**: $100-400/month (service-dependent)

---

## THIRD-PARTY PAID FALLBACK

### RapidAPI TikTok APIs
- **Pricing**: Variable by provider; typically $5-100/month tiers
- **Rate limits**: Usually 100-1000 req/month on free tier; paid tiers scale
- **For 3k req/day**: Would require $150+ plan; cost-prohibitive
- **Advantage**: No proxy management, instant updates
- **Risk**: Sudden rate limit, service degradation

### Apify TikTok Scraper Actor
- **Cost**: $50-200/month for 500-account sync
- **Setup**: No-code, reliable, managed service
- **Limitation**: Less control, slower iterations

---

## VIDEO COVER URL STABILITY

- **CDN URLs**: Stable for 24-72 hours; recommend re-fetch every sync cycle
- **Best practice**: Download + store locally in S3/blob storage
- **Expiry risk**: MEDIUM (URLs may 403 after 2-3 days)
- **Action**: Cache locally; don't rely on CDN links for UI

---

## VIETNAMESE IP CONSIDERATIONS

⚠️ **TikTok (tiktok.com) from Vietnamese residential IPs**: Generally accessible, but scrapers face higher block rates due to regional abuse patterns. Mitigation:
- Prefer Bright Data or regional-aware proxy services
- Distribute requests across geographies
- Monitor 429/403 response spikes from VN IPs
- Consider mixed-region proxy rotation

---

## IMPLEMENTATION ROADMAP

### Phase 1: Test @tobyg74/tiktok-api-dl
1. Install + test on 5-10 sample accounts
2. Measure response times, error rates
3. Monitor for Cloudflare blocks
4. Validate all required fields (follower, video count, post metadata)

### Phase 2: Add Residential Proxy Layer (if needed)
1. If Phase 1 fails, integrate SmartProxy or Bright Data
2. Implement retry logic with exponential backoff
3. Log proxy health metrics

### Phase 3: Production Deployment
1. 4-hour sync job; stagger 500 accounts over 2-hour window
2. Jitter: +random(0, 2000ms) between requests
3. Circuit breaker: Pause if >5% requests return 429
4. Alert: Slack notification on >50% error rate for 10+ minutes

---

## CONCURRENCY & THROTTLING PATTERNS

```
Scenario: 500 accounts, 6 syncs/day (every 4 hours)

Optimal approach:
- 10 parallel workers
- Each worker: fetch 50 accounts sequentially
- Delay between requests: 800ms (random 500-1200ms)
- Total time: ~50 accounts × 800ms = 40 sec per worker × 10 = ~7 min total
- Buffer: Run window = 30 min; safety margin = 4x overhead

Code sketch:
const batch = chunk(accounts, 50);
Promise.all(batch.map(chunk => fetchSequential(chunk, 800)));
```

---

## RISK MATRIX

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Library breaks (DOM change) | MEDIUM | HIGH | Fallback scraping, weekly monitoring |
| IP blocked by Cloudflare | MEDIUM | HIGH | Residential proxy, IP rotation |
| Rate limiting (429) | MEDIUM | MEDIUM | Throttle, exponential backoff |
| Cover URLs expire | LOW | LOW | Cache locally, re-fetch weekly |
| Service downtime | LOW | HIGH | Dual fallback (scraping + API) |

---

## UNRESOLVED QUESTIONS

1. Does `@tobyg74/tiktok-api-dl` support fetching video comments or do we need separate endpoint?
2. What's the exact behavior when a TikTok account goes private after initial fetch?
3. Are deleted/archived videos still included in `videoCount` or filtered out?
4. Does library expose `posted_at` timestamp or only relative times?
5. Vietnamese IP block rate vs. global average — no empirical data found.

---

## SOURCES

- [How to Get TikTok Data Without the Research API (2026)](https://sociavault.com/blog/tiktok-data-without-research-api-2026)
- [How To Scrape TikTok in 2026 - Scrapfly Blog](https://scrapfly.io/blog/posts/how-to-scrape-tiktok-python-json)
- [How To Scrape TikTok in 2026 - Scraperly](https://scraperly.com/scrape/tiktok)
- [Web Scraping Without Getting Banned in 2026 - DEV Community](https://dev.to/vhub_systems_ed5641f65d59/web-scraping-without-getting-banned-in-2026-the-complete-anti-bot-bypass-guide-297h)
- [How We Combat Unauthorized Data Scraping of TikTok](https://www.tiktok.com/privacy/blog/how-we-combat-scraping/en)
- [tiktok-scraper npm Alternatives](https://openbase.com/js/tiktok-scraper/alternatives)
- [@tobyg74/tiktok-api-dl npm package](https://www.npmjs.com/package/@tobyg74/tiktok-api-dl)
