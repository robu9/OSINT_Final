import { GoogleGenerativeAI } from "@google/generative-ai";
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

function parseAiResponse(jsonStr: string): AiAnalysisResult {
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
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
  } catch (error) {
    console.warn("Failed to parse AI JSON:", error);
    return fallbackAiResponse();
  }
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
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

Respond ONLY with valid JSON. No markdown fences.`;
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

  for (let keyIdx = 0; keyIdx < geminiKeys.length; keyIdx++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKeys[keyIdx]);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const resp = await model.generateContent(prompt);
        const txt = cleanJsonResponse(resp.response.text());
        console.log(`Gemma (${modelName}) responded (${txt.length} chars) with key #${keyIdx + 1}`);

        const parsed = parseAiResponse(txt);
        if (parsed.short_summary) return parsed;

        const jsonStart = txt.indexOf("{");
        const jsonEnd = txt.lastIndexOf("}") + 1;
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          const extracted = parseAiResponse(txt.slice(jsonStart, jsonEnd));
          if (extracted.short_summary) return extracted;
        }
      } catch (error) {
        console.error(`Gemma key #${keyIdx + 1}, attempt #${attempt + 1} failed:`, error);
        await new Promise((r) => setTimeout(r, 1000));
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
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      });

      const resp = await model.generateContent(prompt);
      const parsed = JSON.parse(cleanJsonResponse(resp.response.text())) as {
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
