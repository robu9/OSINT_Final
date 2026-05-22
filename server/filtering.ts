import { ratio, partial_ratio, token_set_ratio } from "fuzzball";
import type { SearchResult } from "./types.js";
import { isNameEntityMatch } from "./nlp.js";

const TRUSTED_DOMAINS: Record<string, number> = {
  "linkedin.com": 12,
  "crunchbase.com": 10,
  "wikipedia.org": 10,
  "github.com": 8,
  "scholar.google.com": 8,
  "researchgate.net": 8,
  "barandbench.com": 9,
  "livelaw.in": 9,
  "ndtv.com": 7,
  "thehindu.com": 7,
  "indiatoday.in": 7,
};

const MIN_RELEVANCE_SCORE = 55;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDomainBoost(link: string): number {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, "");
    for (const [domain, boost] of Object.entries(TRUSTED_DOMAINS)) {
      if (hostname.includes(domain)) return boost;
    }
  } catch {
    // ignore invalid URLs
  }
  return 0;
}

function cityMatchScore(city: string, text: string): number {
  if (!city.trim()) return 0;
  const cityLower = city.toLowerCase();
  const textLower = text.toLowerCase();
  if (textLower.includes(cityLower)) return 15;
  const cityTokens = cityLower.split(/\s+/).filter(Boolean);
  const hits = cityTokens.filter((t) => textLower.includes(t)).length;
  if (hits === cityTokens.length && cityTokens.length > 0) return 12;
  if (hits > 0) return 6;
  return 0;
}

function extraTermsScore(extras: string[], text: string): number {
  if (extras.length === 0) return 0;
  const textLower = text.toLowerCase();
  let score = 0;
  for (const extra of extras) {
    if (textLower.includes(extra.toLowerCase())) score += 8;
  }
  return Math.min(score, 24);
}

export function scoreResult(
  result: SearchResult,
  name: string,
  city: string,
  extras: string[]
): { score: number; method: string } {
  const title = result.title || "";
  const snippet = result.snippet || "";
  const raw = `${title} ${snippet}`;
  const rawLower = raw.toLowerCase();
  const nameLower = name.toLowerCase();
  const nameTokens = name.split(/\s+/).filter(Boolean);

  let score = 0;
  let method = "Low Confidence";

  if (isNameEntityMatch(name, result.entities || [])) {
    score += 35;
    method = "NLP Entity";
  }

  if (nameTokens.length >= 2) {
    const fullNameRegex = new RegExp(
      `\\b${nameTokens.map(escapeRegex).join("\\s+")}\\b`,
      "i"
    );
    if (fullNameRegex.test(title)) {
      score += 40;
      method = "Exact Title Match";
    } else if (fullNameRegex.test(snippet)) {
      score += 28;
      method = "Exact Snippet Match";
    }
  } else if (nameTokens.length === 1) {
    const singleRegex = new RegExp(`\\b${escapeRegex(nameTokens[0])}\\b`, "i");
    if (singleRegex.test(title)) {
      score += 35;
      method = "Exact Title Match";
    } else if (singleRegex.test(snippet)) {
      score += 22;
      method = "Exact Snippet Match";
    }
  }

  const titleRatio = partial_ratio(nameLower, title.toLowerCase());
  const snippetRatio = partial_ratio(nameLower, snippet.toLowerCase());
  const tokenRatio = token_set_ratio(nameLower, rawLower);
  const fullRatio = ratio(nameLower, rawLower);

  score += Math.max(titleRatio * 0.35, snippetRatio * 0.25, tokenRatio * 0.2, fullRatio * 0.15);

  const tokenHits = nameTokens.filter(
    (tok) => partial_ratio(tok.toLowerCase(), rawLower) >= 85
  ).length;
  if (nameTokens.length >= 2 && tokenHits === nameTokens.length) {
    score += 12;
    if (method === "Low Confidence") method = "Token Match";
  }

  score += cityMatchScore(city, raw);
  score += extraTermsScore(extras, raw);
  score += getDomainBoost(result.link);

  if (result.source === "LinkedIn" || result.source === "Professional") score += 8;
  if (result.source === "Case/Legal") score += 5;

  score = Math.round(Math.min(score, 100));

  if (method === "Low Confidence") {
    if (score >= 80) method = "High Fuzzy Match";
    else if (score >= 65) method = "Fuzzy Match";
    else if (score >= MIN_RELEVANCE_SCORE) method = "Contextual Match";
  }

  return { score, method };
}

export function filterAndRankResults(
  combined: SearchResult[],
  name: string,
  city: string,
  extras: string[]
): SearchResult[] {
  const scored = combined.map((result) => {
    const { score, method } = scoreResult(result, name, city, extras);
    return {
      ...result,
      relevanceScore: score,
      confidence: Math.min(100, Math.round(score * 0.95)),
      matchMethod: method,
    };
  });

  return scored
    .filter((r) => (r.relevanceScore || 0) >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
}
