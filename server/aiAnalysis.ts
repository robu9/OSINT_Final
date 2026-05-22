import { GoogleGenerativeAI, type GenerateContentResult } from "@google/generative-ai";
import type { AiAnalysisResult, SearchResult } from "./types.js";

const DEFAULT_MODEL = "gemma-4-31b-it";

let geminiKeys: string[] = [];
let modelName = DEFAULT_MODEL;

export function initGeminiKeys(keys: string[], model?: string): void {
  geminiKeys = keys.map((k) => k.trim()).filter(Boolean);
  if (model?.trim()) modelName = model.trim();
}

export function getGeminiKeyCount(): number {
  return geminiKeys.length;
}

export function getModelName(): string {
  return modelName;
}

function extractModelText(resp: GenerateContentResult): string {
  const parts = resp.response.candidates?.[0]?.content?.parts;
  if (!parts?.length) return resp.response.text();

  const answerParts = parts.filter(
    (part): part is { text: string; thought?: boolean } =>
      typeof (part as { text?: string }).text === "string" && !(part as { thought?: boolean }).thought
  );

  if (answerParts.length > 0) {
    return answerParts.map((part) => part.text).join("");
  }

  return resp.response.text();
}

function isRetryableApiError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 429 || status === 500 || status === 503;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackAiResponse(): AiAnalysisResult {
  return {
    short_summary:
      "An error occurred during AI analysis. The search results are still available below.",
    detailed_summary:
      "The detailed AI analysis could not be generated. Please review the raw intelligence data for your own conclusions.",
    riskAnalysis: {
      riskScore: 0,
      riskJustification: "AI analysis was unavailable — no risk assessment could be made.",
      sentimentScore: 0,
      sentimentJustification: "AI analysis was unavailable — no sentiment assessment could be made.",
    },
    keyFindings: [],
    associatedEntities: [],
  };
}

function mapAiData(data: Record<string, unknown>): AiAnalysisResult {
  return {
    short_summary: String(data.short_summary || ""),
    detailed_summary: String(data.detailed_summary || ""),
    riskAnalysis: {
      riskScore: Number(data.riskScore) || 0,
      riskJustification: String(data.riskJustification || ""),
      sentimentScore: Number(data.sentimentScore) || 0,
      sentimentJustification: String(data.sentimentJustification || ""),
    },
    keyFindings: Array.isArray(data.keyFindings)
      ? data.keyFindings.map(String)
      : [],
    associatedEntities: Array.isArray(data.associatedEntities)
      ? (data.associatedEntities as Array<Record<string, string>>).map((e) => ({
          name: String(e.name || ""),
          type: String(e.type || ""),
          relationship: String(e.relationship || ""),
        }))
      : [],
  };
}

function isValidAiResult(result: AiAnalysisResult): boolean {
  return Boolean(result.short_summary && !result.short_summary.startsWith("An error occurred during AI analysis"));
}

function parseAiResponse(jsonStr: string): AiAnalysisResult | null {
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    return mapAiData(data);
  } catch (error) {
    console.warn("Failed to parse AI JSON:", error);
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  const end = text.lastIndexOf("}");
  return end > start ? text.slice(start, end + 1) : null;
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function tryParseAiResponse(text: string): AiAnalysisResult | null {
  const candidates = [text, cleanJsonResponse(text), extractJsonObject(text)].filter(
    (value): value is string => Boolean(value?.trim())
  );

  for (const candidate of [...new Set(candidates)]) {
    const parsed = parseAiResponse(candidate);
    if (parsed && isValidAiResult(parsed)) return parsed;
  }

  return null;
}

function buildAnalysisPrompt(name: string, city: string, snippets: string[]): string {
  const joined = snippets.join("\n---\n");

  return `You are an expert OSINT (Open Source Intelligence) analyst. Analyze search results about "${name}" in or around "${city}".

RULES:
- Base analysis ONLY on provided evidence. Do not fabricate information.
- If snippets may refer to multiple people, note uncertainty explicitly.
- Cross-reference name + location + context before attributing findings.
- Prioritize high-confidence professional, legal, and verified sources.
- Distinguish homonyms and similarly named individuals.

Return JSON with this EXACT structure:
{
  "short_summary": "2-3 sentence executive summary",
  "detailed_summary": "3-5 paragraph thorough analysis with source references",
  "riskScore": <integer 1-10>,
  "riskJustification": "Evidence-based risk explanation",
  "sentimentScore": <integer -5 to 5>,
  "sentimentJustification": "Public sentiment explanation",
  "keyFindings": ["Finding 1", "Finding 2", "Finding 3"],
  "associatedEntities": [
    {"name": "Entity", "type": "person|organization|location", "relationship": "Relationship to target"}
  ]
}

Intelligence snippets (${snippets.length} items, ranked by relevance):
---
${joined}
---

CRITICAL: Your entire response must be a single raw JSON object. No markdown, no bullet points, no prose before or after the JSON.`;
}

export async function gemmaAnalyzeResults(
  name: string,
  city: string,
  filteredResults: SearchResult[]
): Promise<AiAnalysisResult> {
  if (!geminiKeys.length || !filteredResults.length) {
    return fallbackAiResponse();
  }

  const snippets = filteredResults.slice(0, 35).map((r) => {
    const score = r.relevanceScore ?? 0;
    const confidence = r.confidence ?? score;
    return `[${r.source}] score=${score} confidence=${confidence}% (${r.displayLink || "unknown"})\n${r.title}\n${r.snippet}`;
  });

  const prompt = buildAnalysisPrompt(name, city, snippets);
  const retryPrompt = `${prompt}

REMINDER: Your previous response was rejected because it was not valid JSON. Output ONLY the JSON object starting with { and ending with }. No markdown, no asterisks, no headings.`;

  for (let keyIdx = 0; keyIdx < geminiKeys.length; keyIdx++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKeys[keyIdx]);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: attempt === 0 ? 0.2 : 0,
          },
        });

        const resp = await model.generateContent(attempt === 0 ? prompt : retryPrompt);
        const raw = extractModelText(resp);
        console.log(`Gemma (${modelName}) responded (${raw.length} chars) with key #${keyIdx + 1}`);

        const parsed = tryParseAiResponse(raw);
        if (parsed) return parsed;

        console.warn(
          `Gemma key #${keyIdx + 1}, attempt #${attempt + 1}: response was not valid JSON`,
          raw.slice(0, 200)
        );
      } catch (error) {
        console.error(`Gemma key #${keyIdx + 1}, attempt #${attempt + 1} failed:`, error);
        if (isRetryableApiError(error)) {
          await sleep(1500 * (attempt + 1));
        } else {
          await sleep(1000);
        }
      }
    }
  }

  console.error("All Gemma keys exhausted — returning fallback");
  return fallbackAiResponse();
}

export async function gemmaRerankResults(
  name: string,
  city: string,
  candidates: SearchResult[]
): Promise<SearchResult[]> {
  if (!geminiKeys.length || candidates.length <= 3) {
    return candidates;
  }

  const topCandidates = candidates.slice(0, 20);
  const listing = topCandidates
    .map(
      (r, i) =>
        `[${i}] source=${r.source} title="${r.title}" snippet="${r.snippet.slice(0, 180)}"`
    )
    .join("\n");

  const prompt = `Target person: "${name}" in "${city}".
For each indexed result below, decide if it likely refers to the SAME person.
Return JSON: {"keep": [array of index numbers to keep], "reason": "brief note"}
Only keep results with strong identity match (name + context). Be strict to avoid false positives.

Results:
${listing}`;

  for (const key of geminiKeys) {
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.1 },
      });

      const resp = await model.generateContent(prompt);
      const raw = extractModelText(resp);
      const extracted = extractJsonObject(raw) ?? cleanJsonResponse(raw);
      const parsed = JSON.parse(extracted) as {
        keep?: number[];
      };

      if (Array.isArray(parsed.keep) && parsed.keep.length > 0) {
        const kept = parsed.keep
          .filter((i) => i >= 0 && i < topCandidates.length)
          .map((i) => topCandidates[i]);

        const remainder = candidates.slice(topCandidates.length);
        return [...kept, ...remainder];
      }
      break;
    } catch {
      // fall back to heuristic ranking
      break;
    }
  }

  return candidates;
}
