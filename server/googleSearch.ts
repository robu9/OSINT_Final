import { sleep } from "./utils.js";
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

async function fetchSearchPage(
  query: string,
  maxResults: number,
  tag: string,
  start: number
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
          gl: "in",
          hl: "en",
          start: String(start),
          safe: "off",
        });

        const resp = await fetch(
          `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
          { signal: AbortSignal.timeout(10000) }
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
  tag = "General"
): Promise<SearchResult[]> {
  const pages = maxResults > 10 ? [1, 11] : [1];
  const perPage = Math.min(maxResults, 10);
  const results: SearchResult[] = [];

  for (const start of pages) {
    const pageResults = await fetchSearchPage(query, perPage, tag, start);
    results.push(...pageResults);
    if (pageResults.length < perPage) break;
  }

  return results;
}

export async function runParallelSearches(queries: SearchQuery[]): Promise<SearchResult[][]> {
  const batchSize = 4;
  const allResults: SearchResult[][] = [];

  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((q) => googleApiSearch(q.query, q.maxResults || 8, q.tag))
    );
    allResults.push(...batchResults);
  }

  return allResults;
}

export function buildAdvancedQueries(
  name: string,
  city: string,
  extras: string[]
): SearchQuery[] {
  const extrasStr = extras.join(" ");
  const quotedName = `"${name}"`;
  const nameCity = city ? `"${name}" "${city}"` : quotedName;
  const nameExtras = extras.length ? `"${name}" ${extrasStr}` : quotedName;

  const newsSites =
    "site:ndtv.com OR site:thehindu.com OR site:indiatoday.in OR site:barandbench.com OR site:livelaw.in OR site:timesofindia.indiatimes.com OR site:hindustantimes.com";

  return [
    {
      query: `site:linkedin.com/in ${quotedName} ${city} ${extrasStr}`.trim(),
      tag: "LinkedIn",
      maxResults: 8,
      priority: 1,
    },
    {
      query: `${nameCity} profile OR biography OR resume OR CV ${extrasStr}`.trim(),
      tag: "Professional",
      maxResults: 8,
      priority: 1,
    },
    {
      query: `${quotedName} ${city} (crime OR FIR OR arrested OR chargesheet OR court OR lawsuit OR fraud OR scam) ${newsSites} ${extrasStr}`.trim(),
      tag: "Case/Legal",
      maxResults: 10,
      priority: 1,
    },
    {
      query: `${nameCity} ${extrasStr} -site:linkedin.com`.trim(),
      tag: "General",
      maxResults: 10,
      priority: 2,
    },
    {
      query: `site:en.wikipedia.org ${quotedName} ${city} ${extrasStr}`.trim(),
      tag: "Wikipedia",
      maxResults: 5,
      priority: 2,
    },
    {
      query: `site:reddit.com ${quotedName} ${city} ${extrasStr}`.trim(),
      tag: "Reddit",
      maxResults: 6,
      priority: 3,
    },
    {
      query: `${quotedName} site:crunchbase.com OR site:zaubacorp.com OR site:tofler.in OR site:opencorporates.com ${extrasStr}`.trim(),
      tag: "Business",
      maxResults: 6,
      priority: 2,
    },
    {
      query: `${quotedName} site:scholar.google.com OR site:researchgate.net OR site:academia.edu ${extrasStr}`.trim(),
      tag: "Academic",
      maxResults: 6,
      priority: 3,
    },
    {
      query: `${nameCity} site:twitter.com OR site:x.com OR site:instagram.com OR site:facebook.com OR site:youtube.com ${extrasStr}`.trim(),
      tag: "Social",
      maxResults: 8,
      priority: 2,
    },
    {
      query: `${quotedName} site:github.com OR site:stackoverflow.com OR site:medium.com ${extrasStr}`.trim(),
      tag: "Developer",
      maxResults: 6,
      priority: 3,
    },
    {
      query: `${nameExtras} interview OR announcement OR appointment OR award ${city}`.trim(),
      tag: "News",
      maxResults: 8,
      priority: 2,
    },
    {
      query: `${quotedName} ${city} site:gov.in OR site:nic.in OR site:indiankanoon.org ${extrasStr}`.trim(),
      tag: "Government",
      maxResults: 6,
      priority: 2,
    },
  ];
}
