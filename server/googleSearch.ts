import { sleep, buildNameVariants } from "./utils.js";
import type { SearchQuery, SearchResult } from "./types.js";

export interface GoogleKeyPair {
  apiKey: string;
  cseId: string;
}

interface GoogleSearchItem {
  title?: string;
  link?: string;
  snippet?: string;
  pagemap?: Record<string, unknown>;
  displayLink?: string;
}

let googleKeysPool: GoogleKeyPair[] = [];

export function initGoogleKeys(apiKeys: string[], cseIds: string[]): void {
  googleKeysPool = apiKeys
    .map((apiKey, index) => ({
      apiKey: apiKey.trim(),
      cseId: (cseIds[index] || cseIds[0] || "").trim(),
    }))
    .filter((pair) => pair.apiKey && pair.cseId);
}

export function getGoogleKeyCount(): number {
  return googleKeysPool.length;
}

function inferGeoCode(city: string): string {
  const c = city.toLowerCase();
  const usCities = [
    "new york", "los angeles", "chicago", "houston", "san francisco",
    "seattle", "boston", "miami", "dallas", "austin", "denver",
  ];
  const ukCities = ["london", "manchester", "birmingham", "edinburgh", "glasgow"];
  const inCities = [
    "mumbai", "delhi", "bangalore", "bengaluru", "chennai", "kolkata",
    "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow", "india",
  ];

  if (usCities.some((x) => c.includes(x))) return "us";
  if (ukCities.some((x) => c.includes(x))) return "uk";
  if (inCities.some((x) => c.includes(x))) return "in";
  return "us";
}

async function fetchSearchPage(
  query: string,
  maxResults: number,
  tag: string,
  start: number,
  geoCode: string
): Promise<SearchResult[]> {
  for (let idx = 0; idx < googleKeysPool.length; idx++) {
    const { apiKey, cseId } = googleKeysPool[idx];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const params = new URLSearchParams({
          q: query,
          key: apiKey,
          cx: cseId,
          num: String(Math.min(maxResults, 10)),
          gl: geoCode,
          hl: "en",
          start: String(start),
          safe: "off",
        });

        const resp = await fetch(
          `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
          { signal: AbortSignal.timeout(12000) }
        );

        if (resp.status === 429) {
          await sleep(2 ** attempt * 1000);
          continue;
        }

        if (!resp.ok) {
          console.warn(`[${tag}] HTTP ${resp.status} with key #${idx + 1}`);
          break;
        }

        const data = (await resp.json()) as { items?: GoogleSearchItem[] };
        const items = data.items || [];

        return items.map((item) => ({
          source: tag,
          title: item.title || "",
          link: item.link || "",
          snippet: item.snippet || "",
          pagemap: item.pagemap,
          displayLink: item.displayLink || "",
          queryPriority: undefined as number | undefined,
        }));
      } catch (error) {
        console.warn(`[${tag}] Search error key #${idx + 1}, attempt #${attempt + 1}:`, error);
        await sleep(1000);
      }
    }
  }

  console.error(`[${tag}] All Google keys exhausted for query: ${query.slice(0, 80)}...`);
  return [];
}

export async function googleApiSearch(
  query: string,
  maxResults = 10,
  tag = "General",
  geoCode = "us",
  deep = false
): Promise<SearchResult[]> {
  const pageStarts = deep
    ? maxResults > 20
      ? [1, 11, 21]
      : maxResults > 10
        ? [1, 11]
        : [1]
    : maxResults > 10
      ? [1, 11]
      : [1];

  const perPage = Math.min(maxResults, 10);
  const results: SearchResult[] = [];

  for (const start of pageStarts) {
    const pageResults = await fetchSearchPage(query, perPage, tag, start, geoCode);
    results.push(...pageResults);
    if (pageResults.length < perPage) break;
    if (deep) await sleep(150);
  }

  return results;
}

export async function runParallelSearches(
  queries: SearchQuery[],
  geoCode = "us",
  deep = false
): Promise<SearchResult[][]> {
  const sorted = [...queries].sort(
    (a, b) => (a.priority ?? 3) - (b.priority ?? 3)
  );

  const batchSize = deep ? 3 : 4;
  const allResults: SearchResult[][] = [];

  for (let i = 0; i < sorted.length; i += batchSize) {
    const batch = sorted.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((q) => {
        const maxResults = q.maxResults || (deep ? 20 : 10);
        return googleApiSearch(q.query, maxResults, q.tag, geoCode, deep).then(
          (results) =>
            results.map((r) => ({
              ...r,
              queryPriority: q.priority,
              sourceTags: [q.tag],
            }))
        );
      })
    );
    allResults.push(...batchResults);
    if (i + batchSize < sorted.length) await sleep(deep ? 300 : 100);
  }

  return allResults;
}

export function buildAdvancedQueries(
  name: string,
  city: string,
  extras: string[],
  deep = false
): SearchQuery[] {
  const extrasStr = extras.join(" ");
  const quotedName = `"${name}"`;
  const nameCity = city ? `"${name}" "${city}"` : quotedName;
  const nameExtras = extras.length ? `"${name}" ${extrasStr}` : quotedName;
  const geoNews =
    "site:reuters.com OR site:bbc.com OR site:nytimes.com OR site:theguardian.com OR site:ndtv.com OR site:thehindu.com OR site:indiatoday.in OR site:barandbench.com OR site:livelaw.in OR site:timesofindia.indiatimes.com";

  const baseQueries: SearchQuery[] = [
    {
      query: `site:linkedin.com/in ${quotedName} ${city} ${extrasStr}`.trim(),
      tag: "LinkedIn",
      maxResults: deep ? 15 : 10,
      priority: 1,
    },
    {
      query: `${nameCity} profile OR biography OR resume OR CV ${extrasStr}`.trim(),
      tag: "Professional",
      maxResults: deep ? 15 : 10,
      priority: 1,
    },
    {
      query: `${quotedName} ${city} (crime OR FIR OR arrested OR chargesheet OR court OR lawsuit OR fraud OR scam) ${geoNews} ${extrasStr}`.trim(),
      tag: "Case/Legal",
      maxResults: deep ? 20 : 12,
      priority: 1,
    },
    {
      query: `${nameCity} ${extrasStr} -site:linkedin.com`.trim(),
      tag: "General",
      maxResults: deep ? 20 : 12,
      priority: 2,
    },
    {
      query: `site:en.wikipedia.org ${quotedName} ${city} ${extrasStr}`.trim(),
      tag: "Wikipedia",
      maxResults: deep ? 8 : 5,
      priority: 2,
    },
    {
      query: `site:reddit.com ${quotedName} ${city} ${extrasStr}`.trim(),
      tag: "Reddit",
      maxResults: deep ? 10 : 6,
      priority: 3,
    },
    {
      query: `${quotedName} site:crunchbase.com OR site:zaubacorp.com OR site:tofler.in OR site:opencorporates.com ${extrasStr}`.trim(),
      tag: "Business",
      maxResults: deep ? 10 : 6,
      priority: 2,
    },
    {
      query: `${quotedName} site:scholar.google.com OR site:researchgate.net OR site:academia.edu ${extrasStr}`.trim(),
      tag: "Academic",
      maxResults: deep ? 10 : 6,
      priority: 3,
    },
    {
      query: `${nameCity} site:twitter.com OR site:x.com OR site:instagram.com OR site:facebook.com OR site:youtube.com ${extrasStr}`.trim(),
      tag: "Social",
      maxResults: deep ? 12 : 8,
      priority: 2,
    },
    {
      query: `${quotedName} site:github.com OR site:stackoverflow.com OR site:medium.com ${extrasStr}`.trim(),
      tag: "Developer",
      maxResults: deep ? 10 : 6,
      priority: 3,
    },
    {
      query: `${nameExtras} interview OR announcement OR appointment OR award ${city}`.trim(),
      tag: "News",
      maxResults: deep ? 12 : 8,
      priority: 2,
    },
    {
      query: `${quotedName} ${city} site:gov.in OR site:nic.in OR site:indiankanoon.org OR site:sec.gov ${extrasStr}`.trim(),
      tag: "Government",
      maxResults: deep ? 10 : 6,
      priority: 2,
    },
  ];

  if (!deep) return baseQueries;

  const variantQueries: SearchQuery[] = [];
  const variants = buildNameVariants(name).slice(0, 4);

  for (const variant of variants) {
    if (variant === name || variant === quotedName) continue;
    variantQueries.push({
      query: `${variant} ${city} ${extrasStr}`.trim(),
      tag: "Deep/Variant",
      maxResults: 12,
      priority: 2,
    });
  }

  if (extras.length > 0) {
    for (const extra of extras.slice(0, 2)) {
      variantQueries.push({
        query: `"${name}" "${extra}" ${city}`.trim(),
        tag: "Deep/Follow-up",
        maxResults: 12,
        priority: 2,
      });
    }
  }

  return [...baseQueries, ...variantQueries];
}

export function buildFollowUpQueries(
  name: string,
  city: string,
  extras: string[],
  organizations: string[],
  aliases: string[]
): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const quotedName = `"${name}"`;

  for (const org of organizations.slice(0, 4)) {
    queries.push({
      query: `${quotedName} "${org}" ${city}`.trim(),
      tag: "Deep/Follow-up",
      maxResults: 12,
      priority: 1,
    });
  }

  for (const alias of aliases.slice(0, 3)) {
    if (alias.toLowerCase() === name.toLowerCase()) continue;
    queries.push({
      query: `"${alias}" ${city} ${extras.join(" ")}`.trim(),
      tag: "Deep/Variant",
      maxResults: 10,
      priority: 2,
    });
  }

  if (city.trim()) {
    queries.push({
      query: `${quotedName} ${city} (director OR founder OR CEO OR manager OR professor OR attorney)`.trim(),
      tag: "Professional",
      maxResults: 12,
      priority: 2,
    });
  }

  return queries;
}

export function getGeoCodeForCity(city: string): string {
  return inferGeoCode(city);
}
