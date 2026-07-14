export type Strategy = "mobile" | "desktop";

export interface ConsoleIssue {
  text: string | null;
  source: string | null;
}

export interface RenderBlockingResource {
  url: string;
  wastedMs: number | null;
}

export interface ThirdPartyEntry {
  entity: string | null;
  mainThreadTimeMs: number | null;
  transferSize: number | null;
}

export type FieldDataSource = "page" | "origin" | "none";

export interface FieldData {
  source: FieldDataSource;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
}

export interface PageSpeedResult {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  perfScore: number | null;
  httpStatus: number | null;
  consoleErrors: ConsoleIssue[];
  deprecations: ConsoleIssue[];
  renderBlocking: RenderBlockingResource[];
  thirdPartySummary: ThirdPartyEntry[];
  field: FieldData;
}

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function runPageSpeed(targetUrl: string, strategy: Strategy): Promise<PageSpeedResult> {
  const apiKey = process.env.PSI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required environment variable: PSI_API_KEY");
  }

  const url = new URL(PSI_ENDPOINT);
  url.searchParams.set("url", targetUrl);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("strategy", strategy);
  // Both categories are required: render-blocking-resources/third-party-summary live under
  // "performance", errors-in-console/deprecations live under "best-practices". PSI only
  // includes audits for categories you explicitly ask for.
  url.searchParams.append("category", "performance");
  url.searchParams.append("category", "best-practices");

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PSI API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return parsePageSpeedResponse(data);
}

function parsePageSpeedResponse(data: any): PageSpeedResult {
  const audits = data?.lighthouseResult?.audits ?? {};

  const rawLcpMs = audits["largest-contentful-paint"]?.numericValue;
  const lcpMs = typeof rawLcpMs === "number" ? Math.round(rawLcpMs) : null;

  const cls = audits["cumulative-layout-shift"]?.numericValue ?? null;

  // Lighthouse lab runs can't measure true INP (it requires real user interaction);
  // Total Blocking Time is the standard lab proxy for responsiveness.
  const rawInpMs = audits["total-blocking-time"]?.numericValue;
  const inpMs = typeof rawInpMs === "number" ? Math.round(rawInpMs) : null;

  const perfScoreRaw = data?.lighthouseResult?.categories?.performance?.score;
  const perfScore = typeof perfScoreRaw === "number" ? Math.round(perfScoreRaw * 100) : null;

  const networkRequests: any[] = audits["network-requests"]?.details?.items ?? [];
  const documentRequest = networkRequests.find((item) => item.resourceType === "Document");
  const httpStatus = documentRequest?.statusCode ?? null;

  // "source" on these items is a category (e.g. "network", "violation"), not a URL - the
  // actual origin of the error/deprecation lives at sourceLocation.url (or subItems for
  // deprecations, depending on audit version).
  const consoleErrors: ConsoleIssue[] = (audits["errors-in-console"]?.details?.items ?? []).map((item: any) => ({
    text: item.description ?? null,
    source: item.sourceLocation?.url ?? item.source ?? null,
  }));

  const deprecations: ConsoleIssue[] = (audits["deprecations"]?.details?.items ?? []).map((item: any) => ({
    text: item.value ?? item.description ?? null,
    source: item.sourceLocation?.url ?? item.subItems?.items?.[0]?.source ?? item.source ?? null,
  }));

  // Lighthouse 12+ replaced the old "render-blocking-resources" / "third-party-summary"
  // audits with "render-blocking-insight" / "third-parties-insight". Checking both keys
  // keeps this working across PSI's Lighthouse version changes.
  const renderBlockingAudit = audits["render-blocking-insight"] ?? audits["render-blocking-resources"];
  const renderBlocking: RenderBlockingResource[] = (renderBlockingAudit?.details?.items ?? []).map((item: any) => ({
    url: item.url,
    wastedMs: item.wastedMs ?? null,
  }));

  const thirdPartyAudit = audits["third-parties-insight"] ?? audits["third-party-summary"];
  const thirdPartySummary: ThirdPartyEntry[] = (thirdPartyAudit?.details?.items ?? []).map((item: any) => ({
    entity: item.entity?.text ?? item.entity ?? null,
    mainThreadTimeMs: item.mainThreadTime ?? item.blockingTime ?? null,
    transferSize: item.transferSize ?? null,
  }));

  const field = parseFieldData(data?.loadingExperience, data?.originLoadingExperience);

  return {
    lcpMs,
    inpMs,
    cls,
    perfScore,
    httpStatus,
    consoleErrors,
    deprecations,
    renderBlocking,
    thirdPartySummary,
    field,
  };
}

function fieldMetricPercentile(metrics: any, key: string): number | null {
  const value = metrics?.[key]?.percentile;
  return typeof value === "number" ? value : null;
}

// loadingExperience is real Chrome UX Report (CrUX) data for this specific URL, aggregated
// from real users over the trailing 28 days - only present if the URL gets enough traffic.
// originLoadingExperience is the same thing aggregated across the whole site, used as a
// fallback for lower-traffic pages (most category/product pages won't have their own).
function parseFieldData(loadingExperience: any, originLoadingExperience: any): FieldData {
  const source: FieldDataSource = loadingExperience?.metrics
    ? "page"
    : originLoadingExperience?.metrics
      ? "origin"
      : "none";
  const metrics = loadingExperience?.metrics ?? originLoadingExperience?.metrics ?? null;

  if (!metrics) {
    return { source: "none", lcpMs: null, cls: null, inpMs: null, fcpMs: null, ttfbMs: null };
  }

  const clsPercentile = fieldMetricPercentile(metrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE");

  return {
    source,
    lcpMs: fieldMetricPercentile(metrics, "LARGEST_CONTENTFUL_PAINT_MS"),
    // CrUX reports CLS scaled by 100 (a percentile of 26 means a CLS of 0.26) - unscale it to
    // match the 0-1 range Lighthouse's lab CLS and our own rating thresholds use.
    cls: clsPercentile == null ? null : clsPercentile / 100,
    inpMs: fieldMetricPercentile(metrics, "INTERACTION_TO_NEXT_PAINT"),
    fcpMs: fieldMetricPercentile(metrics, "FIRST_CONTENTFUL_PAINT_MS"),
    ttfbMs: fieldMetricPercentile(metrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
  };
}
