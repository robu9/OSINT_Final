"""
OSINT Investigator — Flask API Server
======================================
Provides endpoints for:
  POST /osint           — Start a background OSINT search
  GET  /progress/<id>   — Poll search progress
  POST /generate-report — Generate a downloadable JSON report
  GET  /health          — Health check
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import json
import logging
import time
import threading
from datetime import datetime

import osint_service

# ──────────────────────────────────────────────
# App Setup
# ──────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("server")

# Shared progress dictionary — stores state for each search_id
progress_store = {}
osint_service.progress_store = progress_store

# Auto-cleanup: remove completed searches after 10 minutes
CLEANUP_AFTER_SECONDS = 600


def cleanup_old_searches():
    """Periodically remove stale search entries to prevent memory leaks."""
    while True:
        time.sleep(60)
        now = time.time()
        stale_ids = [
            sid for sid, data in progress_store.items()
            if data.get("status") in ("completed", "error")
            and now - data.get("_finished_at", now) > CLEANUP_AFTER_SECONDS
        ]
        for sid in stale_ids:
            progress_store.pop(sid, None)
            log.info(f"Cleaned up stale search: {sid}")


cleanup_thread = threading.Thread(target=cleanup_old_searches, daemon=True)
cleanup_thread.start()


# ══════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════

@app.route("/")
def home():
    """Root endpoint — confirms the server is running."""
    return jsonify({
        "status": "online",
        "service": "OSINT Investigator API",
        "version": "2.0",
        "endpoints": {
            "POST /osint": "Start an OSINT search",
            "GET /progress/<search_id>": "Poll search progress",
            "POST /generate-report": "Generate a JSON report",
            "GET /health": "Health check",
        }
    })


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint for monitoring."""
    return jsonify({
        "status": "healthy",
        "nlp_loaded": osint_service.nlp is not None,
        "google_keys": len(osint_service.google_keys_pool),
        "gemini_keys": len(osint_service.gemini_keys),
        "active_searches": sum(
            1 for v in progress_store.values() if v.get("status") == "running"
        ),
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/osint", methods=["POST"])
def osint():
    """
    Start an OSINT search in a background thread.
    
    Request body (JSON):
        - name: str (required) — Full name of the person
        - city: str (optional) — City/region
        - extraTerms: str (optional) — Comma-separated additional keywords
    
    Returns:
        - searchId: str — Use this to poll /progress/<searchId>
    """
    data = request.json
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    name = (data.get("name") or "").strip()
    city = (data.get("city") or "").strip()
    extras_raw = (data.get("extraTerms") or "").strip()
    extras = [e.strip() for e in extras_raw.split(",") if e.strip()]

    # Validation
    if not name:
        return jsonify({"error": "Name is a required field."}), 400

    if len(name) > 200:
        return jsonify({"error": "Name is too long (max 200 characters)."}), 400

    # Prevent too many concurrent searches
    active = sum(1 for v in progress_store.values() if v.get("status") == "running")
    if active >= 5:
        return jsonify({"error": "Too many concurrent searches. Please wait and try again."}), 429

    # Create unique search ID
    safe_name = name.replace(" ", "_")[:30]
    search_id = f"{safe_name}_{int(time.time())}_{os.urandom(2).hex()}"

    progress_store[search_id] = {
        "percentage": 0,
        "stage": "Initializing...",
        "status": "running",
        "_started_at": time.time(),
    }

    def run_search():
        try:
            log.info(f"Search started: {search_id}")
            result = osint_service.run_osint_with_progress(name, city, extras, search_id)
            progress_store[search_id].update({
                "percentage": 100,
                "stage": "✅ Search complete!",
                "status": "completed",
                "result": result,
                "_finished_at": time.time(),
            })
            elapsed = time.time() - progress_store[search_id].get("_started_at", time.time())
            log.info(f"Search completed: {search_id} ({elapsed:.1f}s)")
        except Exception as e:
            error_msg = str(e)
            progress_store[search_id].update({
                "status": "error",
                "error": error_msg,
                "stage": "❌ Search failed",
                "percentage": progress_store[search_id].get("percentage", 0),
                "_finished_at": time.time(),
            })
            log.error(f"Search failed: {search_id} — {error_msg}")

    thread = threading.Thread(target=run_search, daemon=True)
    thread.start()

    return jsonify({
        "searchId": search_id,
        "message": f"Search initiated for '{name}'. Poll /progress/{search_id} for updates.",
    })


@app.route("/progress/<search_id>", methods=["GET"])
def get_progress(search_id):
    """Poll the progress of a running search."""
    progress = progress_store.get(search_id)
    if not progress:
        return jsonify({"error": "Search ID not found. It may have expired."}), 404

    # Build response — exclude internal fields
    response = {
        "percentage": progress.get("percentage", 0),
        "stage": progress.get("stage", ""),
        "status": progress.get("status", "unknown"),
    }

    if progress.get("status") == "completed" and "result" in progress:
        response["result"] = progress["result"]
    elif progress.get("status") == "error":
        response["error"] = progress.get("error", "Unknown error")

    return jsonify(response)


@app.route("/generate-report", methods=["POST"])
def generate_report():
    """
    Generate a formatted JSON report and return the file.
    
    Request body (JSON):
        - personData: dict — The full result object from a completed search
    """
    data = request.json
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    person_data = data.get("personData")
    if not person_data:
        return jsonify({"error": "Missing personData in request body."}), 400

    try:
        os.makedirs("reports", exist_ok=True)
        name_slug = (person_data.get("name", "person") or "person").replace(" ", "_")[:30]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{name_slug}_report_{timestamp}.json"
        filepath = os.path.join("reports", filename)

        # Build a clean report
        report = {
            "reportMeta": {
                "generatedAt": datetime.now().isoformat(),
                "toolVersion": "2.0",
                "subject": person_data.get("name", "Unknown"),
                "location": person_data.get("location", ""),
            },
            "executiveSummary": person_data.get("short_summary", ""),
            "detailedAnalysis": person_data.get("detailed_summary", ""),
            "riskAssessment": person_data.get("riskAnalysis", {}),
            "keyFindings": person_data.get("keyFindings", []),
            "associatedEntities": person_data.get("associatedEntities", []),
            "profileInformation": person_data.get("profileInfo", {}),
            "entityRelationships": person_data.get("entityAnalysis", {}),
            "sourceBreakdown": person_data.get("sourceAnalysis", []),
            "timeline": person_data.get("timelineEvents", []),
            "rawIntelligence": person_data.get("raw_data", []),
            "searchStatistics": person_data.get("searchMeta", {}),
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)

        log.info(f"Report generated: {filepath}")
        return jsonify({
            "reportPath": filepath,
            "filename": filename,
            "message": "Report generated successfully.",
        })

    except Exception as e:
        log.error(f"Report generation failed: {e}")
        return jsonify({"error": f"Failed to generate report: {e}"}), 500


@app.route("/download-report/<filename>", methods=["GET"])
def download_report(filename):
    """Download a previously generated report file."""
    filepath = os.path.join("reports", filename)
    if not os.path.exists(filepath):
        return jsonify({"error": "Report file not found."}), 404
    return send_file(filepath, as_attachment=True, download_name=filename)


# ══════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    log.info(f"🚀 OSINT Investigator API starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)