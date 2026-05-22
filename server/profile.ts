import type { SearchResult, ProfileInfo, TimelineEvent } from "./types.js";
import { parseFlexibleDate } from "./utils.js";

export function extractProfileInfo(results: SearchResult[]): ProfileInfo {
  const profile: ProfileInfo = {
    profileImages: [],
    socialProfiles: [],
    knownTitles: [],
    knownOrganizations: [],
  };
  const seenImages = new Set<string>();
  const seenSocialUrls = new Set<string>();

  for (const result of results) {
    const pagemap = (result.pagemap || {}) as Record<string, Array<Record<string, string>>>;
    const link = result.link || "";

    const metatags = pagemap.metatags?.[0];
    if (metatags) {
      const ogImage = metatags["og:image"] || "";
      if (ogImage && !seenImages.has(ogImage) && !ogImage.endsWith(".svg")) {
        seenImages.add(ogImage);
        profile.profileImages.push({
          url: ogImage,
          source: result.source,
          sourceUrl: link,
        });
      }

      const ogTitle = metatags["og:title"] || "";
      if (ogTitle) profile.knownTitles.push(ogTitle);
    }

    for (const person of pagemap.person || []) {
      if (person.jobtitle) profile.knownTitles.push(person.jobtitle);
      if (person.worksfor) profile.knownOrganizations.push(person.worksfor);
    }

    const socialMap: Array<[string, string]> = [
      ["linkedin.com", "LinkedIn"],
      ["twitter.com", "Twitter/X"],
      ["x.com", "Twitter/X"],
      ["facebook.com", "Facebook"],
      ["github.com", "GitHub"],
      ["instagram.com", "Instagram"],
      ["youtube.com", "YouTube"],
    ];

    for (const [domain, platform] of socialMap) {
      if (link.includes(domain) && !seenSocialUrls.has(link)) {
        seenSocialUrls.add(link);
        profile.socialProfiles.push({ platform, url: link });
      }
    }
  }

  profile.knownTitles = [...new Set(profile.knownTitles)].slice(0, 10);
  profile.knownOrganizations = [...new Set(profile.knownOrganizations)].slice(0, 10);
  profile.profileImages = profile.profileImages.slice(0, 5);

  return profile;
}

export function extractEventFromResult(result: SearchResult): Date | null {
  try {
    const pagemap = (result.pagemap || {}) as Record<string, Array<Record<string, string>>>;

    const metaKeys = [
      "article:published_time",
      "datePublished",
      "date",
      "og:updated_time",
      "article:modified_time",
      "pubdate",
      "lastmod",
    ];

    for (const meta of pagemap.metatags || []) {
      for (const key of metaKeys) {
        const val = meta[key];
        if (val) {
          const parsed = parseFlexibleDate(val);
          if (parsed) return parsed;
        }
      }
    }

    for (const article of pagemap.newsarticle || []) {
      for (const key of ["datepublished", "datecreated", "datemodified"]) {
        const val = article[key];
        if (val) {
          const parsed = parseFlexibleDate(val);
          if (parsed) return parsed;
        }
      }
    }

    const snippet = result.snippet || "";
    const patterns = [
      /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
      /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i,
      /(\d{4}-\d{2}-\d{2})/,
    ];

    for (const pattern of patterns) {
      const match = snippet.match(pattern);
      if (match?.[1]) {
        const parsed = parseFlexibleDate(match[1]);
        if (parsed) return parsed;
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function buildTimeline(results: SearchResult[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const dt = extractEventFromResult(result);
    if (!dt) continue;

    const key = `${dt.toISOString().slice(0, 10)}_${result.title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    events.push({
      date: dt.toISOString().slice(0, 10),
      title: result.title,
      source: result.source,
      link: result.link,
    });
  }

  return events.sort((a, b) => b.date.localeCompare(a.date));
}
