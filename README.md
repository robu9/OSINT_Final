
# OSINT Investigator

A TypeScript-powered OSINT (Open Source Intelligence) platform to search for people on the web, aggregate multi-source results, score relevance with NLP + fuzzy matching, and generate AI-powered intelligence reports using **Gemma 4 31B**.

---

## Features

- Multi-source Google Custom Search across 12 targeted query types (LinkedIn, legal/news, social, business, academic, government, etc.)
- Parallel search execution with pagination for broader coverage
- Advanced relevance scoring (exact match, fuzzy match, NLP entities, domain trust, city/extra-term context)
- AI re-ranking and analysis with **Gemma 4 31B** (`gemma-4-31b-it`)
- Profile metadata extraction, entity relationship mapping, and evidence timelines
- React frontend with rich intelligence dashboard and downloadable JSON reports

---

## Tech Stack

- **Runtime:** Node.js, Express, TypeScript
- **Frontend:** React, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **AI:** Google Gemini API with Gemma 4 31B
- **Search:** Google Custom Search API
- **NLP:** compromise (lightweight entity extraction)
- **Matching:** fuzzball (fuzzy string matching)

---

## How It Works

1. Enter **Name**, **City/Region**, and optional **Extra terms**
2. Server runs 12+ advanced search queries in parallel
3. Results are deduplicated, NLP-enriched, and scored for relevance
4. Gemma 4 31B re-ranks candidates and generates the intelligence report
5. UI displays risk assessment, findings, entities, timeline, and raw data

---

## Installation

```bash
git clone https://github.com/yourusername/osint-investigator.git
cd osint-investigator

npm install
```

---

## Setup

1. Get **Google API key** + **CSE ID** → [Google Custom Search](https://programmablesearchengine.google.com/)
2. Get **Gemini API key** → [Google AI Studio](https://aistudio.google.com/apikey)

Create `.env` in the project root:

```env
GOOGLE_API_KEYS=your-google-api-key
GOOGLE_CSE_IDS=your-cse-id
GEMINI_API_KEYS=your-gemini-api-key
PORT=8080
GEMMA_MODEL=gemma-4-31b-it
```

---

## Run

```bash
# One command — single server serves both API and frontend
npm run dev
```

Open http://localhost:8080 — the app and API share the same origin (`/api/...`).

For production locally:

```bash
npm run build
npm start
```

---

## Deploy to Vercel

1. Push the repo to GitHub
2. Import the project in [Vercel](https://vercel.com)
3. Add environment variables in the Vercel dashboard:
   - `GOOGLE_API_KEYS`
   - `GOOGLE_CSE_IDS`
   - `GEMINI_API_KEYS`
   - `GEMMA_MODEL` (optional, defaults to `gemma-4-31b-it`)
4. Deploy — `vercel.json` is already configured

> **Note:** OSINT searches can take 30–90 seconds. Vercel Pro allows up to 300s function duration (configured in `vercel.json`). The in-memory progress store works for a single instance; for heavy production use, consider Redis or a job queue later.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/osint` | Start a background OSINT search |
| GET | `/api/progress/:searchId` | Poll search progress |
| POST | `/api/generate-report` | Generate a JSON report |
| GET | `/api/health` | Health check |

---

## Project Structure

```
├── server/          # Express API + OSINT logic
├── src/             # React frontend
├── api/             # Vercel serverless entry
├── public/          # Static assets
├── index.html       # Vite entry
└── package.json     # Single dependency tree
```

---

## Notes

- Use responsibly — ensure ethical and legal compliance while performing OSINT.
- Be mindful of API quotas (Google CSE + Gemini/Gemma).
- Gemma 4 31B requires a valid Gemini API key with access to the model.
