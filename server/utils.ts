export function sanitizeInput(text: string): string {
  if (!text) return "";
  return text.replace(/[^\w\s\-.,']/g, "").trim().slice(0, 200);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mergeAndDedupe(listOfLists: Array<Array<{ link: string }>>): Array<{ link: string }> {
  const seen = new Set<string>();
  const out: Array<{ link: string }> = [];

  for (const sub of listOfLists) {
    for (const r of sub) {
      const link = r.link || "";
      if (link && !seen.has(link)) {
        seen.add(link);
        out.push(r);
      }
    }
  }
  return out;
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
