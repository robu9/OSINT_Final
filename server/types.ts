export interface SearchResult {
  source: string;
  title: string;
  link: string;
  snippet: string;
  pagemap?: Record<string, unknown>;
  displayLink?: string;
  entities?: Entity[];
  matchMethod?: string;
  relevanceScore?: number;
  confidence?: number;
}

export interface Entity {
  text: string;
  label: string;
}

export interface ProgressEntry {
  percentage: number;
  stage: string;
  status: "running" | "completed" | "error";
  result?: OsintResult;
  error?: string;
  _startedAt?: number;
  _finishedAt?: number;
}

export interface RiskAnalysis {
  riskScore: number;
  riskJustification: string;
  sentimentScore: number;
  sentimentJustification: string;
}

export interface AssociatedEntity {
  name: string;
  type: string;
  relationship: string;
}

export interface AiAnalysisResult {
  short_summary: string;
  detailed_summary: string;
  riskAnalysis: RiskAnalysis;
  keyFindings: string[];
  associatedEntities: AssociatedEntity[];
}

export interface ProfileInfo {
  profileImages: Array<{ url: string; source: string; sourceUrl: string }>;
  socialProfiles: Array<{ platform: string; url: string }>;
  knownTitles: string[];
  knownOrganizations: string[];
}

export interface EntityAnalysis {
  relatedPersons: Array<{ name: string; mentions: number }>;
  relatedOrganizations: Array<{ name: string; mentions: number }>;
  relatedLocations: Array<{ name: string; mentions: number }>;
}

export interface TimelineEvent {
  date: string;
  title: string;
  source: string;
  link: string;
}

export interface SourceAnalysis {
  name: string;
  count: number;
}

export interface SearchMeta {
  totalResultsScanned: number;
  totalResultsFiltered: number;
  searchTimestamp: string;
  sourcesQueried: number;
  averageRelevanceScore?: number;
  queryVariantsUsed?: number;
}

export interface OsintResult {
  name: string;
  location: string;
  short_summary: string;
  detailed_summary: string;
  riskAnalysis: RiskAnalysis;
  keyFindings: string[];
  associatedEntities: AssociatedEntity[];
  sourceAnalysis: SourceAnalysis[];
  timelineEvents: TimelineEvent[];
  raw_data: Array<{
    title: string;
    snippet: string;
    link: string;
    source: string;
    matchMethod: string;
    displayLink: string;
    relevanceScore?: number;
    confidence?: number;
  }>;
  profileInfo: ProfileInfo;
  entityAnalysis: EntityAnalysis;
  searchMeta: SearchMeta;
}

export interface SearchQuery {
  query: string;
  tag: string;
  maxResults?: number;
  priority?: number;
}
