import { sleep } from "./utils.js";
import type { SearchResult } from "./types.js";

const MAX_CONTENT_LENGTH = 3000;
const FETCH_TIMEOUT_MS = 8000;
const BATCH_SIZE = 4;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaDescription(html: string): string {
  const match = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i
  );
  return match?.[1]?.trim() || "";
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OSINTBot/3.0; +https://github.com/osint-investigator)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!resp.ok) return "";

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return "";
    }

    const html = await resp.text();
    const meta = extractMetaDescription(html);
    const body = stripHtml(html);
    const combined = [meta, body].filter(Boolean).join(" ");
    return combined.slice(0, MAX_CONTENT_LENGTH);
  } catch {
    return "";
  }
}

export async function enrichResultsWithPageContent(
  results: SearchResult[],
  limit = 18
): Promise<SearchResult[]> {
  const targets = results.slice(0, limit);

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const texts = await Promise.all(batch.map((r) => fetchPageText(r.link)));

    for (let j = 0; j < batch.length; j++) {
      const text = texts[j];
      if (!text || text.length < 80) continue;

      const result = batch[j];
      result.pageContent = text;
      result.snippet = `${result.snippet} ${text}`.slice(0, MAX_CONTENT_LENGTH);
    }

    if (i + BATCH_SIZE < targets.length) {
      await sleep(200);
    }
  }

  return results;
}
