import {
  buildAdvancedQueries,
  buildFollowUpQueries,
  getGeoCodeForCity,
  runParallelSearches,
} from "./googleSearch.js";
import { enrichResultsWithPageContent } from "./contentFetch.js";
import { enrichWithNlp, aggregateEntities } from "./nlp.js";
import { filterAndRankResults } from "./filtering.js";
import { extractProfileInfo, buildTimeline } from "./profile.js";
import { gemmaAnalyzeResults, gemmaRerankResults } from "./aiAnalysis.js";
import { mergeAndDedupe, sanitizeInput, sleep, emptyResult } from "./utils.js";
import type { OsintResult, ProgressEntry, SearchResult, SourceAnalysis } from "./types.js";

export const progressStore: Record<string, ProgressEntry> = {};

const SOURCE_TAGS = [
  "LinkedIn",
  "Professional",
  "Case/Legal",
  "General",
  "Wikipedia",
  "Reddit",
  "Business",
  "Academic",
  "Social",
  "Developer",
  "News",
  "Government",
  "Deep/Variant",
  "Deep/Follow-up",
];

function updateProgress(searchId: string, pct: number, stage: string): void {
  const entry = progressStore[searchId];
  if (entry) {
    entry.percentage = pct;
    entry.stage = stage;
  }
}

function buildSourceAnalysis(filtered: SearchResult[]): SourceAnalysis[] {
  return SOURCE_TAGS.map((name) => ({
    name,
    count: filtered.filter((r) => r.source === name || r.sourceTags?.includes(name)).length,
  }));
}

function extractFollowUpSignals(results: SearchResult[], targetName: string): {
  organizations: string[];
  aliases: string[];
} {
  const orgs = new Set<string>();
  const aliases = new Set<string>();
  const targetLower = targetName.toLowerCase();

  for (const result of results.slice(0, 15)) {
    for (const ent of result.entities || []) {
      if (ent.label === "ORG" && ent.text.length >= 3) {
        orgs.add(ent.text.trim());
      }
      if (ent.label === "PERSON" && ent.text.length >= 3) {
        const personLower = ent.text.toLowerCase();
        if (
          personLower !== targetLower &&
          !targetLower.includes(personLower) &&
          !personLower.includes(targetLower)
        ) {
          aliases.add(ent.text.trim());
        }
      }
    }

    const pagemap = (result.pagemap || {}) as Record<string, Array<Record<string, string>>>;
    for (const person of pagemap.person || []) {
      if (person.worksfor) orgs.add(person.worksfor.trim());
    }
  }

  return {
    organizations: [...orgs].slice(0, 5),
    aliases: [...aliases].slice(0, 4),
  };
}

export async function runOsintWithProgress(
  name: string,
  city: string,
  extras: string[],
  searchId: string,
  deepSearch = true
): Promise<OsintResult> {
  name = sanitizeInput(name);
  city = sanitizeInput(city);
  extras = extras.map(sanitizeInput).filter(Boolean);

  if (!name) throw new Error("Name is required for OSINT search.");

  const geoCode = getGeoCodeForCity(city);
  let totalQueries = 0;
  let searchRounds = 1;
  let contentEnrichedCount = 0;

  console.log(
    `Starting OSINT for: name='${name}', city='${city}', extras='${extras.join(", ")}', deep=${deepSearch}`
  );

  updateProgress(searchId, 5, deepSearch ? "🔍 Building deep search query plan..." : "🔍 Building search queries...");
  await sleep(50);

  const round1Queries = buildAdvancedQueries(name, city, extras, deepSearch);
  totalQueries += round1Queries.length;

  updateProgress(
    searchId,
    10,
    `🌐 Round 1: Running ${round1Queries.length} targeted searches...`
  );

  const round1Batches = await runParallelSearches(round1Queries, geoCode, deepSearch);
  let combined = mergeAndDedupe(round1Batches) as SearchResult[];
  console.log(`Round 1 unique results: ${combined.length}`);

  if (deepSearch && combined.length > 0) {
    updateProgress(searchId, 35, "🧠 Analyzing results for follow-up queries...");
    enrichWithNlp(combined);
    const preliminary = filterAndRankResults(combined, name, city, extras);
    const signals = extractFollowUpSignals(preliminary, name);

    const followUpQueries = buildFollowUpQueries(
      name,
      city,
      extras,
      signals.organizations,
      signals.aliases
    );

    if (followUpQueries.length > 0) {
      searchRounds = 2;
      totalQueries += followUpQueries.length;
      updateProgress(
        searchId,
        42,
        `🔎 Round 2: Running ${followUpQueries.length} follow-up deep searches...`
      );

      const round2Batches = await runParallelSearches(followUpQueries, geoCode, true);
      combined = mergeAndDedupe([combined, ...round2Batches]) as SearchResult[];
      console.log(`After round 2 unique results: ${combined.length}`);
    }
  }

  updateProgress(searchId, 52, "🔄 Merging and deduplicating results...");

  if (combined.length === 0) {
    return emptyResult(
      name,
      city,
      "No results were found for this search query.",
      "The search across all sources returned zero results. This person may not have a significant public online presence, or the search terms may need to be refined."
    );
  }

  updateProgress(searchId, 58, "🧠 Running NLP entity recognition...");
  enrichWithNlp(combined);

  if (deepSearch) {
    updateProgress(searchId, 62, "📄 Fetching full page content for top results...");
    const beforeEnrich = combined.length;
    await enrichResultsWithPageContent(combined, 20);
    contentEnrichedCount = combined.filter((r) => r.pageContent).length;
    console.log(`Content enriched ${contentEnrichedCount}/${beforeEnrich} results`);
    enrichWithNlp(combined);
  }

  updateProgress(searchId, 70, "🎯 Scoring identity relevance...");
  let filtered = filterAndRankResults(combined, name, city, extras);

  if (filtered.length === 0) {
    return emptyResult(
      name,
      city,
      "No data found matching this person.",
      "The search returned results, but none could be confidently linked to the target person. Try adding city, employer, or other keywords to disambiguate common names.",
      combined.length
    );
  }

  updateProgress(searchId, 78, "🤖 AI re-ranking with Gemma 4 31B...");
  filtered = await gemmaRerankResults(name, city, filtered);

  updateProgress(searchId, 82, "👤 Extracting profile metadata...");
  const profileInfo = extractProfileInfo(filtered);

  updateProgress(searchId, 86, "🔗 Analyzing entity relationships...");
  const entityAnalysis = aggregateEntities(filtered, name);

  updateProgress(searchId, 90, "🤖 Running Gemma 4 31B intelligence analysis...");
  const aiResult = await gemmaAnalyzeResults(name, city, filtered);

  updateProgress(searchId, 95, "📅 Building evidence timeline...");
  const timelineEvents = buildTimeline(filtered);

  const sourceAnalysis = buildSourceAnalysis(filtered);
  const avgScore =
    filtered.reduce((sum, r) => sum + (r.relevanceScore || 0), 0) / filtered.length;

  updateProgress(searchId, 97, "📦 Packaging results...");

  const raw_data = filtered.map((r) => ({
    title: r.title,
    snippet: r.snippet,
    link: r.link,
    source: r.source,
    matchMethod: r.matchMethod || "",
    displayLink: r.displayLink || "",
    relevanceScore: r.relevanceScore,
    confidence: r.confidence,
  }));

  console.log(
    `OSINT complete for '${name}': ${filtered.length} results, ${timelineEvents.length} timeline events, deep=${deepSearch}`
  );

  return {
    name,
    location: city,
    short_summary: aiResult.short_summary,
    detailed_summary: aiResult.detailed_summary,
    riskAnalysis: aiResult.riskAnalysis,
    keyFindings: aiResult.keyFindings,
    associatedEntities: aiResult.associatedEntities,
    sourceAnalysis,
    timelineEvents,
    raw_data,
    profileInfo,
    entityAnalysis,
    searchMeta: {
      totalResultsScanned: combined.length,
      totalResultsFiltered: filtered.length,
      searchTimestamp: new Date().toISOString(),
      sourcesQueried: totalQueries,
      averageRelevanceScore: Math.round(avgScore),
      queryVariantsUsed: totalQueries,
      deepSearch,
      searchRounds,
      contentEnrichedCount,
    },
  };
}
