export function sanitizeInput(text: string): string {
  if (!text) return "";
  return text
    .replace(/[^\p{L}\p{N}\s\-.,']/gu, "")
    .trim()
    .slice(0, 200);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MergeableResult {
  link: string;
  title?: string;
  snippet?: string;
  source?: string;
  sourceTags?: string[];
  queryPriority?: number;
  pagemap?: Record<string, unknown>;
  displayLink?: string;
}

export function mergeAndDedupe<T extends MergeableResult>(listOfLists: T[][]): T[] {
  const byLink = new Map<string, T>();

  for (const sub of listOfLists) {
    for (const r of sub) {
      const link = r.link || "";
      if (!link) continue;

      const existing = byLink.get(link);
      if (!existing) {
        byLink.set(link, {
          ...r,
          sourceTags: r.sourceTags?.length
            ? [...new Set(r.sourceTags)]
            : r.source
              ? [r.source]
              : [],
        });
        continue;
      }

      const mergedTags = new Set([
        ...(existing.sourceTags || []),
        ...(r.sourceTags || []),
        ...(existing.source ? [existing.source] : []),
        ...(r.source ? [r.source] : []),
      ]);

      const bestPriority = Math.min(
        existing.queryPriority ?? 99,
        r.queryPriority ?? 99
      );

      const longerSnippet =
        (r.snippet?.length || 0) > (existing.snippet?.length || 0)
          ? r.snippet
          : existing.snippet;

      byLink.set(link, {
        ...existing,
        ...r,
        title: existing.title || r.title,
        snippet: longerSnippet || existing.snippet || r.snippet,
        source: existing.queryPriority !== undefined &&
          (r.queryPriority ?? 99) < (existing.queryPriority ?? 99)
          ? r.source || existing.source
          : existing.source || r.source,
        sourceTags: [...mergedTags],
        queryPriority: bestPriority,
        pagemap: existing.pagemap || r.pagemap,
      });
    }
  }

  return [...byLink.values()].sort((a, b) => {
    const priorityDiff = (a.queryPriority ?? 99) - (b.queryPriority ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    return (b.sourceTags?.length || 0) - (a.sourceTags?.length || 0);
  });
}

export function buildNameVariants(name: string): string[] {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const variants = new Set<string>();
  variants.add(`"${name}"`);
  variants.add(name);

  if (tokens.length >= 2) {
    variants.add(`"${tokens[0]} ${tokens[tokens.length - 1]}"`);
    variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    if (tokens.length >= 3) {
      variants.add(`"${tokens[0]} ${tokens.slice(1, -1).join(" ")} ${tokens[tokens.length - 1]}"`);
    }
    const initials = tokens.map((t) => t[0]).join("");
    variants.add(`${initials} ${tokens[tokens.length - 1]}`);
  }

  return [...variants];
}

export function parseFlexibleDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const monthMatch = value.match(
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i
  );
  if (monthMatch) {
    const d = new Date(monthMatch[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function emptyResult(
  name: string,
  city: string,
  message: string,
  detail: string,
  scanned = 0
) {
  return {
    name,
    location: city,
    short_summary: message,
    detailed_summary: detail,
    riskAnalysis: {
      riskScore: 0,
      riskJustification: "No data available to assess risk.",
      sentimentScore: 0,
      sentimentJustification: "No data available to assess sentiment.",
    },
    keyFindings: scanned > 0 ? ["No results could be confidently attributed to the target individual."] : [],
    associatedEntities: [],
    sourceAnalysis: [],
    timelineEvents: [],
    raw_data: [],
    profileInfo: {
      profileImages: [],
      socialProfiles: [],
      knownTitles: [],
      knownOrganizations: [],
    },
    entityAnalysis: {
      relatedPersons: [],
      relatedOrganizations: [],
      relatedLocations: [],
    },
    searchMeta: {
      totalResultsScanned: scanned,
      totalResultsFiltered: 0,
      searchTimestamp: new Date().toISOString(),
      sourcesQueried: 0,
    },
  };
}
