import { partial_ratio, token_set_ratio } from "fuzzball";
import type { SearchResult } from "./types.js";
import { isNameEntityMatch } from "./nlp.js";
import { extractEventFromResult } from "./profile.js";

const TRUSTED_DOMAINS: Record<string, number> = {
  "linkedin.com": 95,
  "crunchbase.com": 90,
  "wikipedia.org": 92,
  "github.com": 85,
  "scholar.google.com": 88,
  "researchgate.net": 86,
  "barandbench.com": 82,
  "livelaw.in": 82,
  "ndtv.com": 75,
  "thehindu.com": 75,
  "indiatoday.in": 75,
  "gov.in": 88,
  "nic.in": 85,
  "indiankanoon.org": 84,
};

const SOURCE_QUALITY: Record<string, number> = {
  LinkedIn: 95,
  Professional: 88,
  "Case/Legal": 85,
  Wikipedia: 92,
  Government: 90,
  Business: 82,
  Academic: 80,
  News: 78,
  Social: 72,
  Developer: 75,
  General: 65,
  Reddit: 60,
  "Deep/Variant": 70,
  "Deep/Follow-up": 75,
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getDomainQuality(link: string): number {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, "");
    for (const [domain, quality] of Object.entries(TRUSTED_DOMAINS)) {
      if (hostname.includes(domain)) return quality;
    }
  } catch {
    // ignore invalid URLs
  }
  return 50;
}

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function urlContainsNameSlug(link: string, name: string): boolean {
  const slug = slugifyName(name);
  if (slug.length < 4) return false;
  return link.toLowerCase().includes(slug);
}

function getSearchableText(result: SearchResult): string {
  const parts = [result.title, result.snippet, result.pageContent || ""];
  const pagemap = (result.pagemap || {}) as Record<string, Array<Record<string, string>>>;

  for (const meta of pagemap.metatags || []) {
    parts.push(meta["og:title"] || "", meta["og:description"] || "");
  }
  for (const person of pagemap.person || []) {
    parts.push(person.name || "", person.jobtitle || "", person.worksfor || "");
  }

  return parts.filter(Boolean).join(" ");
}

function scoreIdentity(name: string, result: SearchResult): {
  score: number;
  method: string;
  tokenCoverage: number;
} {
  const title = result.title || "";
  const snippet = result.snippet || "";
  const raw = getSearchableText(result);
  const rawLower = raw.toLowerCase();
  const nameLower = name.toLowerCase();
  const nameTokens = name.split(/\s+/).filter(Boolean);

  let score = 0;
  let method = "Weak Match";
  let tokenCoverage = 0;

  if (urlContainsNameSlug(result.link, name)) {
    score += 35;
    method = "Profile URL Match";
  }

  if (isNameEntityMatch(name, result.entities || [])) {
    score += 28;
    method = "NLP Entity Match";
  }

  if (nameTokens.length >= 2) {
    const fullNameRegex = new RegExp(
      `\\b${nameTokens.map(escapeRegex).join("\\s+")}\\b`,
      "i"
    );
    if (fullNameRegex.test(title)) {
      score += 45;
      method = "Exact Title Match";
    } else if (fullNameRegex.test(raw)) {
      score += 32;
      if (method === "Weak Match") method = "Exact Content Match";
    }
  } else if (nameTokens.length === 1) {
    const singleRegex = new RegExp(`\\b${escapeRegex(nameTokens[0])}\\b`, "i");
    if (singleRegex.test(title)) {
      score += 38;
      method = "Exact Title Match";
    } else if (singleRegex.test(raw)) {
      score += 25;
      if (method === "Weak Match") method = "Exact Content Match";
    }
  }

  const fuzzyBest = Math.max(
    partial_ratio(nameLower, title.toLowerCase()),
    partial_ratio(nameLower, rawLower),
    token_set_ratio(nameLower, rawLower)
  );

  if (fuzzyBest >= 92) score += 18;
  else if (fuzzyBest >= 85) score += 12;
  else if (fuzzyBest >= 75) score += 6;
  else if (fuzzyBest < 60 && score < 25) score -= 15;

  const matchedTokens = nameTokens.filter((tok) => {
    const tokLower = tok.toLowerCase();
    return (
      rawLower.includes(tokLower) ||
      partial_ratio(tokLower, rawLower) >= 88
    );
  }).length;

  tokenCoverage = nameTokens.length > 0 ? matchedTokens / nameTokens.length : 0;

  if (nameTokens.length >= 2) {
    if (tokenCoverage === 1) score += 10;
    else if (tokenCoverage >= 0.5) score += 4;
    else score -= 20;
  }

  if (result.pageContent && result.pageContent.length > 100) {
    score += 5;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    method,
    tokenCoverage,
  };
}

function scoreContext(city: string, extras: string[], raw: string): number {
  let score = 0;
  const rawLower = raw.toLowerCase();

  if (city.trim()) {
    const cityLower = city.toLowerCase();
    if (rawLower.includes(cityLower)) score += 35;
    else {
      const cityTokens = cityLower.split(/\s+/).filter(Boolean);
      const hits = cityTokens.filter((t) => rawLower.includes(t)).length;
      if (hits === cityTokens.length && cityTokens.length > 0) score += 28;
      else if (hits > 0) score += 12;
    }
  }

  if (extras.length > 0) {
    let hits = 0;
    for (const extra of extras) {
      if (rawLower.includes(extra.toLowerCase())) hits++;
    }
    score += Math.min(hits * 15, 45);
  }

  return Math.min(100, score);
}

function scoreRecency(result: SearchResult): number {
  const eventDate = extractEventFromResult(result);
  if (!eventDate) return 50;

  const ageDays = (Date.now() - eventDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 365) return 95;
  if (ageDays <= 730) return 80;
  if (ageDays <= 1825) return 65;
  return 45;
}

function scoreCorroboration(result: SearchResult): number {
  const tags = result.sourceTags?.length || (result.source ? 1 : 0);
  if (tags >= 3) return 100;
  if (tags === 2) return 75;
  return 40;
}

function dynamicThreshold(city: string, extras: string[]): number {
  if (city.trim() && extras.length > 0) return 38;
  if (city.trim() || extras.length > 0) return 44;
  return 50;
}

export function scoreResult(
  result: SearchResult,
  name: string,
  city: string,
  extras: string[]
): { score: number; method: string; confidence: number } {
  const raw = getSearchableText(result);
  const nameTokens = name.split(/\s+/).filter(Boolean);

  const identity = scoreIdentity(name, result);
  const context = scoreContext(city, extras, raw);
  const sourceQuality = Math.max(
    getDomainQuality(result.link),
    SOURCE_QUALITY[result.source] || 55
  );
  const recency = scoreRecency(result);
  const corroboration = scoreCorroboration(result);

  const hasContext = Boolean(city.trim() || extras.length > 0);

  let finalScore =
    identity.score * 0.52 +
    context * (hasContext ? 0.22 : 0.08) +
    sourceQuality * 0.14 +
    recency * 0.06 +
    corroboration * 0.06;

  if (nameTokens.length >= 2 && identity.tokenCoverage < 0.5 && identity.score < 40) {
    finalScore *= 0.35;
    identity.method = "Partial Name Only";
  }

  if (!hasContext && nameTokens.length >= 2 && identity.score < 55) {
    finalScore *= 0.7;
  }

  if (!hasContext && nameTokens.length === 1 && identity.score < 50) {
    finalScore *= 0.5;
  }

  if (result.source === "LinkedIn" && urlContainsNameSlug(result.link, name)) {
    finalScore = Math.max(finalScore, 78);
  }

  finalScore = Math.round(Math.min(100, Math.max(0, finalScore)));

  const confidence = Math.round(
    Math.min(
      100,
      identity.score * 0.6 + context * 0.25 + (corroboration > 70 ? 15 : 0)
    )
  );

  return {
    score: finalScore,
    method: identity.method,
    confidence,
  };
}

export function filterAndRankResults(
  combined: SearchResult[],
  name: string,
  city: string,
  extras: string[]
): SearchResult[] {
  const threshold = dynamicThreshold(city, extras);
  const softThreshold = Math.max(30, threshold - 12);

  const scored = combined.map((result) => {
    const { score, method, confidence } = scoreResult(result, name, city, extras);
    return {
      ...result,
      relevanceScore: score,
      confidence,
      matchMethod: method,
    };
  });

  const strong = scored
    .filter((r) => (r.relevanceScore || 0) >= threshold)
    .sort((a, b) => {
      const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });

  if (strong.length >= 8) return strong;

  const strongLinks = new Set(strong.map((r) => r.link));
  const medium = scored
    .filter(
      (r) =>
        !strongLinks.has(r.link) &&
        (r.relevanceScore || 0) >= softThreshold
    )
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, Math.max(0, 20 - strong.length))
    .map((r) => ({
      ...r,
      matchMethod: r.matchMethod === "Weak Match" ? "Possible Match" : r.matchMethod,
    }));

  return [...strong, ...medium];
}
