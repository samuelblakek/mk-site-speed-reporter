export type Rating = "good" | "needs-improvement" | "poor";

// Google's official Core Web Vitals thresholds.
// https://web.dev/articles/defining-core-web-vitals-thresholds
export function rateLcp(ms: number): Rating {
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "needs-improvement";
  return "poor";
}

export function rateCls(value: number): Rating {
  if (value <= 0.1) return "good";
  if (value <= 0.25) return "needs-improvement";
  return "poor";
}

// True INP is a real-user, event-driven metric and can't be measured in a single lab run.
// Total Blocking Time is stored under inp_ms as the standard lab proxy for responsiveness.
// These bands are Lighthouse's own commonly-cited TBT scoring reference points - NOT the
// official INP thresholds (good <=200ms / poor >500ms). Do not conflate the two in reports.
export function rateTbtProxy(ms: number): Rating {
  if (ms <= 200) return "good";
  if (ms <= 600) return "needs-improvement";
  return "poor";
}

// Lighthouse's own performance score bands.
// https://developer.chrome.com/docs/lighthouse/performance/performance-scoring
export function ratePerfScore(score: number): Rating {
  if (score >= 90) return "good";
  if (score >= 50) return "needs-improvement";
  return "poor";
}
