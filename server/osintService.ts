import {
  buildAdvancedQueries,
  runParallelSearches,
} from "./googleSearch.js";
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
    count: filtered.filter((r) => r.source === name).length,
  }));
}

export async function runOsintWithProgress(
  name: string,
  city: string,
  extras: string[],
  searchId: string
): Promise<OsintResult> {
  name = sanitizeInput(name);
  city = sanitizeInput(city);
  extras = extras.map(sanitizeInput).filter(Boolean);

  if (!name) throw new Error("Name is required for OSINT search.");

  console.log(`Starting OSINT for: name='${name}', city='${city}', extras='${extras.join(", ")}'`);

  updateProgress(searchId, 5, "🔍 Building advanced search queries...");
  await sleep(50);

  const queries = buildAdvancedQueries(name, city, extras);
  updateProgress(searchId, 12, `🌐 Running ${queries.length} targeted searches in parallel...`);

  const searchBatches = await runParallelSearches(queries);
  updateProgress(searchId, 55, "🔄 Merging and deduplicating results...");

  const combined = mergeAndDedupe(searchBatches) as SearchResult[];
  console.log(`Total unique results after merge: ${combined.length}`);

  if (combined.length === 0) {
    return emptyResult(
      name,
      city,
      "No results were found for this search query.",
      "The search across all sources returned zero results. This person may not have a significant public online presence, or the search terms may need to be refined."
    );
  }

  updateProgress(searchId, 62, "🧠 Running NLP entity recognition...");
  enrichWithNlp(combined);

  updateProgress(searchId, 70, "🎯 Scoring and ranking relevance...");
  let filtered = filterAndRankResults(combined, name, city, extras);

  if (filtered.length === 0) {
    return emptyResult(
      name,
      city,
      "No data found matching this person.",
      "The search returned results, but none could be confidently linked to the target person. They may not have a significant public profile, or more specific search terms may be needed.",
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
    `OSINT complete for '${name}': ${filtered.length} results, ${timelineEvents.length} timeline events`
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
      sourcesQueried: queries.length,
      averageRelevanceScore: Math.round(avgScore),
      queryVariantsUsed: queries.length,
    },
  };
}
