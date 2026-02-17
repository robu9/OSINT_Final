import os
import json
import re
import time
import logging
import requests
from datetime import datetime
from collections import Counter
from dotenv import load_dotenv
import google.generativeai as genai
from rapidfuzz import fuzz
from dateutil.parser import parse as parse_date

# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("osint")

# ──────────────────────────────────────────────
# Environment & Keys
# ──────────────────────────────────────────────
load_dotenv()

google_keys_pool = list(zip(
    [k.strip() for k in os.getenv("GOOGLE_API_KEYS", "").split(",") if k.strip()],
    [c.strip() for c in os.getenv("GOOGLE_CSE_IDS", "").split(",") if c.strip()],
))
gemini_keys = [k.strip() for k in os.getenv("GEMINI_API_KEYS", "").split(",") if k.strip()]

log.info(f"Loaded {len(google_keys_pool)} Google key pair(s), {len(gemini_keys)} Gemini key(s)")

# ──────────────────────────────────────────────
# Shared progress store (set by main.py)
# ──────────────────────────────────────────────
progress_store = {}

# ──────────────────────────────────────────────
# NLP Model (Optional)
# ──────────────────────────────────────────────
nlp = None
try:
    import spacy
    nlp = spacy.load("en_core_web_sm")
    log.info("spaCy NLP model loaded successfully.")
except Exception as e:
    log.warning(f"spaCy NLP unavailable (running in limited mode): {e}")


# ══════════════════════════════════════════════
#  UTILITY HELPERS
# ══════════════════════════════════════════════

def sanitize_input(text: str) -> str:
    """Strip dangerous characters from user input."""
    if not text:
        return ""
    # Remove anything that isn't alphanumeric, spaces, hyphens, periods, commas
    return re.sub(r"[^\w\s\-.,']", "", text.strip())[:200]


def fallback_ai_response():
    return {
        "short_summary": "An error occurred during AI analysis. The search results are still available below.",
        "detailed_summary": "The detailed AI analysis could not be generated. Please review the raw intelligence data for your own conclusions.",
        "riskAnalysis": {
            "riskScore": 0,
            "riskJustification": "AI analysis was unavailable — no risk assessment could be made.",
            "sentimentScore": 0,
            "sentimentJustification": "AI analysis was unavailable — no sentiment assessment could be made.",
        },
        "keyFindings": [],
        "associatedEntities": [],
    }


def parse_ai_response(json_str: str) -> dict:
    """Parse the Gemini JSON response into a clean structured result."""
    try:
        data = json.loads(json_str)
        return {
            "short_summary": data.get("short_summary", ""),
            "detailed_summary": data.get("detailed_summary", ""),
            "riskAnalysis": {
                "riskScore": int(data.get("riskScore", 0)),
                "riskJustification": data.get("riskJustification", ""),
                "sentimentScore": int(data.get("sentimentScore", 0)),
                "sentimentJustification": data.get("sentimentJustification", ""),
            },
            "keyFindings": data.get("keyFindings", []),
            "associatedEntities": data.get("associatedEntities", []),
        }
    except Exception as e:
        log.warning(f"Failed to parse AI JSON: {e}")
        return fallback_ai_response()


# ══════════════════════════════════════════════
#  GOOGLE CUSTOM SEARCH
# ══════════════════════════════════════════════

def google_api_search(query: str, max_results: int = 10, tag: str = "") -> list:
    """
    Execute a Google Custom Search query. Tries every key pair in the pool
    with retry + backoff before giving up.
    """
    for idx, (api_key, cse_id) in enumerate(google_keys_pool):
        for attempt in range(2):  # 2 attempts per key
            try:
                resp = requests.get(
                    "https://www.googleapis.com/customsearch/v1",
                    params={
                        "q": query,
                        "key": api_key,
                        "cx": cse_id,
                        "num": min(max_results, 10),
                        "gl": "in",
                        "hl": "en",
                    },
                    timeout=8,
                )
                resp.raise_for_status()
                items = resp.json().get("items", [])
                results = []
                for it in items:
                    result = {
                        "source": tag,
                        "title": it.get("title", ""),
                        "link": it.get("link", ""),
                        "snippet": it.get("snippet", ""),
                        "pagemap": it.get("pagemap", {}),
                        "displayLink": it.get("displayLink", ""),
                    }
                    results.append(result)
                log.info(f"[{tag}] Got {len(results)} results (key #{idx+1}, attempt #{attempt+1})")
                return results
            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response else "?"
                log.warning(f"[{tag}] HTTP {status} with key #{idx+1}, attempt #{attempt+1}: {e}")
                if status == 429:
                    time.sleep(2 ** attempt)  # backoff on rate limit
                    continue
                break  # other HTTP errors — skip to next key
            except requests.exceptions.Timeout:
                log.warning(f"[{tag}] Timeout with key #{idx+1}, attempt #{attempt+1}")
                time.sleep(1)
            except Exception as e:
                log.error(f"[{tag}] Unexpected error with key #{idx+1}: {e}")
                break
    log.error(f"[{tag}] All Google keys exhausted for query: {query[:80]}...")
    return []


# ══════════════════════════════════════════════
#  GEMINI AI ANALYSIS
# ══════════════════════════════════════════════

def gemini_summarize_and_analyze(name: str, city: str, all_snippets: list) -> dict:
    """
    Send ALL collected snippets to Gemini for comprehensive analysis.
    Uses a rich prompt that asks for key findings, entities, and scores.
    """
    if not gemini_keys or not all_snippets:
        return fallback_ai_response()

    # Cap at 30 snippets to avoid token overflow
    snippets_to_send = all_snippets[:30]
    joined = "\n---\n".join(snippets_to_send)

    prompt = f"""You are an expert OSINT (Open Source Intelligence) analyst. You have been given search results collected from multiple public sources about a person named '{name}' located in or around '{city}'.

Your task is to carefully analyze ALL the snippets below and produce a comprehensive intelligence report.

IMPORTANT RULES:
- Base your analysis ONLY on the provided evidence. Do not fabricate information.
- If the snippets are ambiguous or could refer to multiple people, note this uncertainty.
- Be objective and factual in your assessments.

Return a JSON object with this EXACT structure:
{{
    "short_summary": "A concise 2-3 sentence executive summary of who this person appears to be, their occupation, and notable associations.",
    "detailed_summary": "A thorough 3-5 paragraph analysis covering: professional background, online presence, notable activities, potential concerns, and overall digital footprint assessment. Be specific and reference the sources.",
    "riskScore": <integer 1-10, where 1=minimal risk and 10=severe risk. Base this on criminal records, legal issues, controversies, fraud indicators, etc.>,
    "riskJustification": "A clear explanation of WHY you assigned this risk score, citing specific evidence.",
    "sentimentScore": <integer -5 to 5, where -5=extremely negative public perception and 5=extremely positive>,
    "sentimentJustification": "Explain the overall public sentiment around this person based on the evidence.",
    "keyFindings": ["Finding 1: ...", "Finding 2: ...", "Finding 3: ..."],
    "associatedEntities": [
        {{"name": "Entity name", "type": "person/organization/location", "relationship": "How they relate to the target"}}
    ]
}}

Here are {len(snippets_to_send)} collected intelligence snippets:
---
{joined}
---

Respond ONLY with valid JSON. No markdown, no code fences, no explanation outside the JSON."""

    for key_idx, key in enumerate(gemini_keys):
        for attempt in range(2):
            try:
                genai.configure(api_key=key)
                model = genai.GenerativeModel("gemini-1.5-flash")
                resp = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"},
                )
                txt = resp.text.strip()
                log.info(f"Gemini responded ({len(txt)} chars) with key #{key_idx+1}")

                # Clean potential markdown fences
                if txt.startswith("```json"):
                    txt = txt[7:]
                if txt.startswith("```"):
                    txt = txt[3:]
                if txt.endswith("```"):
                    txt = txt[:-3]
                txt = txt.strip()

                # Try direct parse
                parsed = parse_ai_response(txt)
                if parsed.get("short_summary"):
                    return parsed

                # Fallback: extract json object
                json_start = txt.find("{")
                json_end = txt.rfind("}") + 1
                if json_start != -1 and json_end > json_start:
                    return parse_ai_response(txt[json_start:json_end])

                log.warning("No valid JSON found in Gemini response")
                continue

            except Exception as e:
                log.error(f"Gemini key #{key_idx+1}, attempt #{attempt+1} failed: {e}")
                time.sleep(1)

    log.error("All Gemini keys exhausted — returning fallback")
    return fallback_ai_response()


# ══════════════════════════════════════════════
#  NLP & FILTERING
# ══════════════════════════════════════════════

def enrich_with_nlp(results: list) -> list:
    """Run spaCy NER on every result's title + snippet."""
    if not nlp:
        for r in results:
            r["entities"] = []
        return results
    for r in results:
        text = f"{r.get('title', '')}. {r.get('snippet', '')}"
        doc = nlp(text)
        r["entities"] = [{"text": ent.text, "label": ent.label_} for ent in doc.ents]
    return results


def is_name_match(target_name: str, entities: list) -> bool:
    """Check if the target name matches any PERSON entity extracted by spaCy."""
    target_parts = [p.lower() for p in target_name.split() if p.strip()]
    if not target_parts:
        return False

    for ent in entities:
        if ent.get("label") != "PERSON":
            continue
        person = ent["text"].lower()
        if len(target_parts) >= 2:
            if all(part in person for part in target_parts):
                return True
        else:
            if target_parts[0] in person or person in target_parts[0]:
                return True
    return False


def merge_and_dedupe(list_of_lists: list) -> list:
    """Merge result lists and remove duplicate URLs."""
    seen, out = set(), []
    for sub in list_of_lists:
        for r in sub:
            link = r.get("link", "")
            if link and link not in seen:
                seen.add(link)
                out.append(r)
    return out


def filter_results(combined: list, name: str) -> list:
    """
    Multi-layered relevance filter:
      1. spaCy PERSON entity match
      2. Exact regex phrase match
      3. Fuzzy full-name match (≥ 88)
      4. Fuzzy token-by-token match (every token ≥ 83)
    """
    name_tokens = [t for t in name.split() if t.strip()]
    name_lower = " ".join(name_tokens).lower()

    if name_tokens:
        if len(name_tokens) >= 2:
            full_name_regex = re.compile(
                r"\b" + r"\s+" .join(map(re.escape, name_tokens)) + r"\b", re.I
            )
        else:
            full_name_regex = re.compile(r"\b" + re.escape(name_tokens[0]) + r"\b", re.I)
    else:
        full_name_regex = None

    filtered = []
    for result in combined:
        title = result.get("title", "")
        snippet = result.get("snippet", "")
        raw = f"{title} {snippet}"
        raw_low = raw.lower()

        # 1) spaCy entity match
        if is_name_match(name, result.get("entities", [])):
            result["matchMethod"] = "NLP Entity"
            filtered.append(result)
            continue

        # 2) Exact regex phrase
        if full_name_regex and (full_name_regex.search(title) or full_name_regex.search(snippet)):
            result["matchMethod"] = "Exact Phrase"
            filtered.append(result)
            continue

        # 3) Fuzzy full-name
        if fuzz.partial_ratio(name_lower, raw_low) >= 88:
            result["matchMethod"] = "Fuzzy Match"
            filtered.append(result)
            continue

        # 4) Fuzzy per-token
        token_hits = [fuzz.partial_ratio(tok.lower(), raw_low) >= 83 for tok in name_tokens if tok]
        if token_hits and all(token_hits):
            result["matchMethod"] = "Token Match"
            filtered.append(result)
        else:
            log.debug(f"Skipped: {title[:60]}...")

    log.info(f"Filtering: {len(combined)} → {len(filtered)} results")
    return filtered


# ══════════════════════════════════════════════
#  PROFILE / METADATA EXTRACTION
# ══════════════════════════════════════════════

def extract_profile_info(results: list) -> dict:
    """
    Extract social profile metadata (images, descriptions, job titles)
    from Google pagemap data.
    """
    profile = {
        "profileImages": [],
        "socialProfiles": [],
        "knownTitles": [],
        "knownOrganizations": [],
    }
    seen_images = set()

    for r in results:
        pagemap = r.get("pagemap", {})
        link = r.get("link", "")

        # Extract profile images from metatags
        metatags = pagemap.get("metatags", [{}])
        if metatags:
            meta = metatags[0]
            og_image = meta.get("og:image", "")
            if og_image and og_image not in seen_images and not og_image.endswith(".svg"):
                seen_images.add(og_image)
                profile["profileImages"].append({
                    "url": og_image,
                    "source": r.get("source", ""),
                    "sourceUrl": link,
                })

            og_title = meta.get("og:title", "")
            og_desc = meta.get("og:description", "")
            if og_title:
                profile["knownTitles"].append(og_title)

        # Extract person schema data
        persons = pagemap.get("person", [])
        for person in persons:
            if person.get("jobtitle"):
                profile["knownTitles"].append(person["jobtitle"])
            if person.get("worksfor"):
                profile["knownOrganizations"].append(person["worksfor"])

        # Extract social profile links
        if "linkedin.com" in link:
            profile["socialProfiles"].append({"platform": "LinkedIn", "url": link})
        elif "twitter.com" in link or "x.com" in link:
            profile["socialProfiles"].append({"platform": "Twitter/X", "url": link})
        elif "facebook.com" in link:
            profile["socialProfiles"].append({"platform": "Facebook", "url": link})
        elif "github.com" in link:
            profile["socialProfiles"].append({"platform": "GitHub", "url": link})
        elif "instagram.com" in link:
            profile["socialProfiles"].append({"platform": "Instagram", "url": link})

    # Deduplicate
    profile["knownTitles"] = list(dict.fromkeys(profile["knownTitles"]))[:10]
    profile["knownOrganizations"] = list(dict.fromkeys(profile["knownOrganizations"]))[:10]
    profile["profileImages"] = profile["profileImages"][:5]

    # Deduplicate social profiles by URL
    seen_urls = set()
    unique_socials = []
    for sp in profile["socialProfiles"]:
        if sp["url"] not in seen_urls:
            seen_urls.add(sp["url"])
            unique_socials.append(sp)
    profile["socialProfiles"] = unique_socials

    return profile


def extract_event_from_result(res: dict):
    """Try to extract a date from pagemap metadata for timeline events."""
    try:
        pagemap = res.get("pagemap", {})

        # Try metatags first
        metatags = pagemap.get("metatags", [{}])
        if metatags:
            meta = metatags[0]
            for key in [
                "article:published_time",
                "datePublished",
                "date",
                "og:updated_time",
                "article:modified_time",
                "pubdate",
                "lastmod",
                "sailthru.date",
            ]:
                val = meta.get(key, "")
                if val:
                    return parse_date(val, fuzzy=True)

        # Try newsarticle schema
        articles = pagemap.get("newsarticle", [])
        for art in articles:
            for key in ["datepublished", "datecreated", "datemodified"]:
                val = art.get(key, "")
                if val:
                    return parse_date(val, fuzzy=True)

        # Try webpage schema
        for wp in pagemap.get("webpage", []):
            val = wp.get("datepublished", "")
            if val:
                return parse_date(val, fuzzy=True)

        # Try snippet date extraction as last resort
        snippet = res.get("snippet", "")
        date_patterns = [
            r"(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})",
            r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})",
            r"(\d{4}-\d{2}-\d{2})",
        ]
        for pattern in date_patterns:
            match = re.search(pattern, snippet, re.I)
            if match:
                return parse_date(match.group(1), fuzzy=True)

    except Exception:
        pass
    return None


# ══════════════════════════════════════════════
#  ENTITY AGGREGATION
# ══════════════════════════════════════════════

def aggregate_entities(results: list, target_name: str) -> dict:
    """Aggregate all NLP entities across results for a frequency analysis."""
    persons = Counter()
    orgs = Counter()
    locations = Counter()

    target_lower = target_name.lower()

    for r in results:
        for ent in r.get("entities", []):
            text = ent["text"].strip()
            if len(text) < 2:
                continue
            label = ent["label"]
            # Skip the target themselves
            if text.lower() in target_lower or target_lower in text.lower():
                continue
            if label == "PERSON":
                persons[text] += 1
            elif label == "ORG":
                orgs[text] += 1
            elif label in ("GPE", "LOC"):
                locations[text] += 1

    return {
        "relatedPersons": [{"name": k, "mentions": v} for k, v in persons.most_common(10)],
        "relatedOrganizations": [{"name": k, "mentions": v} for k, v in orgs.most_common(10)],
        "relatedLocations": [{"name": k, "mentions": v} for k, v in locations.most_common(10)],
    }


# ══════════════════════════════════════════════
#  MAIN OSINT PIPELINE
# ══════════════════════════════════════════════

def run_osint_with_progress(name: str, city: str, extras: list, search_id: str) -> dict:
    """
    Full OSINT pipeline:
    1. Multi-source Google searches
    2. Merge & deduplicate
    3. NLP enrichment
    4. Relevance filtering
    5. Profile extraction
    6. Entity aggregation
    7. AI summarization (ALL snippets)
    8. Timeline construction
    """
    if not nlp:
        log.warning("NLP engine not loaded — proceeding with limited filtering.")

    # Sanitize inputs
    name = sanitize_input(name)
    city = sanitize_input(city)
    extras = [sanitize_input(e) for e in extras if sanitize_input(e)]

    if not name:
        raise ValueError("Name is required for OSINT search.")

    extras_str = " ".join(extras)
    log.info(f"Starting OSINT for: name='{name}', city='{city}', extras='{extras_str}'")

    def update(pct, stage):
        entry = progress_store.get(search_id)
        if entry:
            entry.update({"percentage": pct, "stage": stage})
        time.sleep(0.05)

    # ── Phase 1: Multi-source search ──────────────────
    update(5, "🔍 Searching LinkedIn profiles...")
    linkedin_results = google_api_search(
        f"site:linkedin.com/in {name} {city} {extras_str}",
        max_results=5, tag="LinkedIn"
    )

    update(15, "📰 Searching news & legal sources...")
    news_query = (
        f"{name} {city} crime OR FIR OR arrested OR chargesheet OR court OR case "
        f"site:ndtv.com OR site:thehindu.com OR site:indiatoday.in OR "
        f"site:barandbench.com OR site:livelaw.in {extras_str}"
    )
    case_results = google_api_search(news_query, max_results=5, tag="Case/News")

    update(25, "🌐 Running general web search...")
    general_results = google_api_search(
        f"{name} {city} {extras_str}", max_results=7, tag="General"
    )

    update(35, "💬 Searching Reddit...")
    reddit_results = google_api_search(
        f'site:reddit.com "{name}" "{city}"', max_results=3, tag="Reddit"
    )

    update(42, "📚 Searching Wikipedia...")
    wikipedia_results = google_api_search(
        f"site:en.wikipedia.org {name} {city} {extras_str}",
        max_results=2, tag="Wikipedia"
    )

    update(50, "🏢 Searching business records...")
    business_results = google_api_search(
        f'"{name}" site:crunchbase.com OR site:zaubacorp.com OR site:tofler.in',
        max_results=3, tag="Business"
    )

    update(58, "🎓 Searching academic sources...")
    academic_results = google_api_search(
        f'"{name}" site:scholar.google.com OR site:researchgate.net',
        max_results=3, tag="Academic"
    )

    update(63, "🐦 Searching social media...")
    social_results = google_api_search(
        f'"{name}" {city} site:twitter.com OR site:x.com OR site:instagram.com OR site:facebook.com',
        max_results=3, tag="Social"
    )

    # ── Phase 2: Merge & Deduplicate ──────────────────
    update(68, "🔄 Merging and deduplicating results...")
    combined = merge_and_dedupe([
        wikipedia_results,
        linkedin_results,
        case_results,
        general_results,
        reddit_results,
        business_results,
        academic_results,
        social_results,
    ])
    log.info(f"Total unique results after merge: {len(combined)}")

    if not combined:
        return {
            "name": name,
            "location": city,
            "short_summary": "No results were found for this search query.",
            "detailed_summary": "The search across all sources returned zero results. This person may not have a significant public online presence, or the search terms may need to be refined.",
            "riskAnalysis": {
                "riskScore": 0,
                "riskJustification": "No data available to assess risk.",
                "sentimentScore": 0,
                "sentimentJustification": "No data available to assess sentiment.",
            },
            "keyFindings": [],
            "associatedEntities": [],
            "sourceAnalysis": [],
            "timelineEvents": [],
            "raw_data": [],
            "profileInfo": {"profileImages": [], "socialProfiles": [], "knownTitles": [], "knownOrganizations": []},
            "entityAnalysis": {"relatedPersons": [], "relatedOrganizations": [], "relatedLocations": []},
            "searchMeta": {"totalResultsScanned": 0, "totalResultsFiltered": 0, "searchTimestamp": datetime.now().isoformat()},
        }

    # ── Phase 3: NLP Enrichment ───────────────────────
    update(72, "🧠 Running NLP entity recognition...")
    combined = enrich_with_nlp(combined)

    # ── Phase 4: Relevance Filtering ──────────────────
    update(76, "🎯 Filtering for relevance...")
    filtered = filter_results(combined, name)

    if not filtered:
        log.warning("No results matched the target person after filtering.")
        return {
            "name": name,
            "location": city,
            "short_summary": "No data found matching this person.",
            "detailed_summary": "The search returned results, but none could be confidently linked to the target person. They may not have a significant public profile, or more specific search terms may be needed.",
            "riskAnalysis": {
                "riskScore": 0,
                "riskJustification": "No relevant data found to assess.",
                "sentimentScore": 0,
                "sentimentJustification": "No relevant data found to assess.",
            },
            "keyFindings": ["No results could be confidently attributed to the target individual."],
            "associatedEntities": [],
            "sourceAnalysis": [],
            "timelineEvents": [],
            "raw_data": [],
            "profileInfo": {"profileImages": [], "socialProfiles": [], "knownTitles": [], "knownOrganizations": []},
            "entityAnalysis": {"relatedPersons": [], "relatedOrganizations": [], "relatedLocations": []},
            "searchMeta": {"totalResultsScanned": len(combined), "totalResultsFiltered": 0, "searchTimestamp": datetime.now().isoformat()},
        }

    # ── Phase 5: Profile extraction ───────────────────
    update(80, "👤 Extracting profile metadata...")
    profile_info = extract_profile_info(filtered)

    # ── Phase 6: Entity aggregation ───────────────────
    update(82, "🔗 Analyzing entity relationships...")
    entity_analysis = aggregate_entities(filtered, name)

    # ── Phase 7: AI Summarization (ALL snippets) ──────
    update(85, "🤖 Running AI intelligence analysis...")
    # Build rich snippets for AI — include source, title, snippet, and link domain
    ai_snippets = []
    for r in filtered:
        source = r.get("source", "Unknown")
        title = r.get("title", "")
        snippet = r.get("snippet", "")
        domain = r.get("displayLink", "")
        ai_snippets.append(f"[{source}] ({domain}) {title}\n{snippet}")

    ai_result = gemini_summarize_and_analyze(name, city, ai_snippets)

    # ── Phase 8: Timeline ─────────────────────────────
    update(93, "📅 Building evidence timeline...")
    events = []
    for r in filtered:
        dt = extract_event_from_result(r)
        if dt:
            events.append({
                "date": dt.strftime("%Y-%m-%d"),
                "title": r["title"],
                "source": r["source"],
                "link": r.get("link", ""),
            })
    events.sort(key=lambda x: x["date"], reverse=True)
    # Deduplicate events by date+title
    seen_events = set()
    unique_events = []
    for evt in events:
        key = f"{evt['date']}_{evt['title']}"
        if key not in seen_events:
            seen_events.add(key)
            unique_events.append(evt)
    events = unique_events

    # ── Phase 9: Source analysis ──────────────────────
    source_tags = ["LinkedIn", "Case/News", "Reddit", "Wikipedia", "Business", "Academic", "Social", "General"]
    source_analysis = []
    for s in source_tags:
        count = sum(1 for r in filtered if r.get("source") == s)
        source_analysis.append({"name": s, "count": count})

    # ── Build final response ──────────────────────────
    update(97, "📦 Packaging results...")

    raw_data = []
    for r in filtered:
        raw_data.append({
            "title": r.get("title", ""),
            "snippet": r.get("snippet", ""),
            "link": r.get("link", ""),
            "source": r.get("source", ""),
            "matchMethod": r.get("matchMethod", ""),
            "displayLink": r.get("displayLink", ""),
        })

    final = {
        "name": name,
        "location": city,
        "short_summary": ai_result.get("short_summary", ""),
        "detailed_summary": ai_result.get("detailed_summary", ""),
        "riskAnalysis": ai_result.get("riskAnalysis", {}),
        "keyFindings": ai_result.get("keyFindings", []),
        "associatedEntities": ai_result.get("associatedEntities", []),
        "sourceAnalysis": source_analysis,
        "timelineEvents": events,
        "raw_data": raw_data,
        "profileInfo": profile_info,
        "entityAnalysis": entity_analysis,
        "searchMeta": {
            "totalResultsScanned": len(combined),
            "totalResultsFiltered": len(filtered),
            "searchTimestamp": datetime.now().isoformat(),
            "sourcesQueried": len(source_tags),
        },
    }

    log.info(f"OSINT complete for '{name}': {len(filtered)} results, {len(events)} timeline events")
    return final