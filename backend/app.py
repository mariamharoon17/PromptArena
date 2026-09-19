from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import os
import time
import re
import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

load_dotenv()

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# ── LLM judge configuration ───────────────────────────────
# One fixed model acts as the judge for ALL three answers, applied uniformly.
# It is set here so it can be changed in one place and documented in the write-up.
# Note the known limitation: when the judge model is also one of the contestants
# (gpt-4o here), self-preference bias is possible. This is applied consistently
# to every model and acknowledged as a limitation. A leave-one-out design is
# discussed as future work.
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "gpt-4o")

# The four dimensions and their weights are UNCHANGED from the rule-based engine.
# The LLM only supplies the four sub-scores; this code still does the weighted sum,
# so the framework remains the project's own contribution.
W_SUBSTANCE, W_COMPLETENESS, W_CLARITY, W_RELIABILITY = 0.35, 0.20, 0.25, 0.20

JUDGE_SYSTEM_PROMPT = (
    "You are an impartial expert evaluator. You assess the quality of an AI "
    "assistant's response to a user prompt. Score the response on four dimensions, "
    "each an integer from 0 to 100:\n\n"
    "1. substance: the genuine, useful and correct content of the answer. Reward "
    "correct working code, accurate facts, concrete figures, tables and citations. "
    "Penalise incorrect, empty or broken content.\n"
    "2. completeness: whether the answer fully addresses the prompt at an appropriate "
    "length. Reward full coverage of what was asked. Do not reward padding, filler or "
    "repetition.\n"
    "3. clarity: how well structured and readable the answer is. Reward logical order, "
    "helpful headings, lists and tables, and clear sentences.\n"
    "4. reliability: how trustworthy and dependable the answer is. Penalise refusals, "
    "hallucinations and broken output. Treat honest, sensible uncertainty as "
    "acceptable, not as a fault.\n\n"
    "Judge only the response shown. Apply the same standard to every response, whatever "
    "assistant produced it. Do not reward length for its own sake.\n\n"
    "Return ONLY a JSON object with exactly these keys: \"substance\", \"completeness\", "
    "\"clarity\", \"reliability\" (each an integer 0-100), and \"justification\" (one or "
    "two short sentences explaining the scores). Return no other text."
)

# ── Database mode selection ───────────────────────────────
# If DB_HOST is set (as it will be on Azure), use MySQL.
# Otherwise fall back to local SQLite so nothing changes on your laptop.
USE_MYSQL = bool(os.environ.get("DB_HOST"))

if USE_MYSQL:
    import mysql.connector
    DB_CONFIG = {
        "host":     os.environ.get("DB_HOST"),
        "user":     os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
        "database": os.environ.get("DB_NAME"),
        "port":     int(os.environ.get("DB_PORT", "3306")),
    }
    PH = "%s"
    AUTO_ID = "INT AUTO_INCREMENT PRIMARY KEY"
    TEXT = "LONGTEXT"
else:
    import sqlite3
    PH = "?"
    AUTO_ID = "INTEGER PRIMARY KEY AUTOINCREMENT"
    TEXT = "TEXT"

def get_conn():
    if USE_MYSQL:
        return mysql.connector.connect(**DB_CONFIG)
    return sqlite3.connect("benchmark.db")

def q(sql):
    """Translate ? placeholders to the active database's placeholder style."""
    if PH == "?":
        return sql
    return sql.replace("?", "%s")

# ── Database Setup ────────────────────────────────────────
def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS benchmarks (
            id {AUTO_ID},
            timestamp {TEXT},
            prompt {TEXT},
            category {TEXT},
            project_id INTEGER DEFAULT NULL,
            openai_response {TEXT},
            openai_time INTEGER,
            openai_tokens INTEGER,
            openai_score INTEGER,
            claude_response {TEXT},
            claude_time INTEGER,
            claude_tokens INTEGER,
            claude_score INTEGER,
            gemini_response {TEXT},
            gemini_time INTEGER,
            gemini_tokens INTEGER,
            gemini_score INTEGER,
            openai_llm_score INTEGER,
            openai_llm_detail {TEXT},
            claude_llm_score INTEGER,
            claude_llm_detail {TEXT},
            gemini_llm_score INTEGER,
            gemini_llm_detail {TEXT}
        )
    ''')
    c.execute(f'''
        CREATE TABLE IF NOT EXISTS projects (
            id {AUTO_ID},
            name {TEXT},
            created_at {TEXT}
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# ── Migration: add LLM-judge columns to an EXISTING table ─
# init_db only creates the table if it does not exist; it will not add columns
# to a table that already holds your 73 runs. This safely adds the six new
# columns once, and does nothing on every startup after that. Your existing
# rows and rule-based scores are never touched.
def migrate_db():
    conn = get_conn()
    c = conn.cursor()
    if USE_MYSQL:
        c.execute(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'benchmarks'",
            (DB_CONFIG["database"],)
        )
        existing = {row[0] for row in c.fetchall()}
    else:
        c.execute("PRAGMA table_info(benchmarks)")
        existing = {row[1] for row in c.fetchall()}

    new_cols = [
        ("openai_llm_score", "INTEGER"),
        ("openai_llm_detail", TEXT),
        ("claude_llm_score", "INTEGER"),
        ("claude_llm_detail", TEXT),
        ("gemini_llm_score", "INTEGER"),
        ("gemini_llm_detail", TEXT),
    ]
    for name, coltype in new_cols:
        if name not in existing:
            c.execute(f"ALTER TABLE benchmarks ADD COLUMN {name} {coltype}")
    conn.commit()
    conn.close()

migrate_db()

def save_result(prompt, category, results, scores, project_id=None):
    def lj(key):
        # LLM score dict attached to each model's result (or empty if none)
        return (results.get(key, {}) or {}).get("llm") or {}
    conn = get_conn()
    c = conn.cursor()
    c.execute(q('''
        INSERT INTO benchmarks (
            timestamp, prompt, category, project_id,
            openai_response, openai_time, openai_tokens, openai_score,
            claude_response, claude_time, claude_tokens, claude_score,
            gemini_response, gemini_time, gemini_tokens, gemini_score,
            openai_llm_score, openai_llm_detail,
            claude_llm_score, claude_llm_detail,
            gemini_llm_score, gemini_llm_detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    '''), (
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        prompt, category, project_id,
        results['openai'].get('response',''), results['openai'].get('time_ms',0),
        results['openai'].get('tokens',0), scores.get('openai',0),
        results['claude'].get('response',''), results['claude'].get('time_ms',0),
        results['claude'].get('tokens',0), scores.get('claude',0),
        results['gemini'].get('response',''), results['gemini'].get('time_ms',0),
        results['gemini'].get('tokens',0), scores.get('gemini',0),
        lj('openai').get('overall'), json.dumps(lj('openai')),
        lj('claude').get('overall'), json.dumps(lj('claude')),
        lj('gemini').get('overall'), json.dumps(lj('gemini')),
    ))
    conn.commit()
    conn.close()

# ── Scoring Engine (rule-based, de-biased) ────────────────
# UNCHANGED. This remains the primary, transparent, reproducible scorer.
def auto_score(response, prompt):
    if not response or not isinstance(response, str):
        return 0
    if response.strip() == "" or "coming soon" in response.lower():
        return 0

    text = response.lower()
    words = [w for w in response.split() if w]
    wc = len(words)
    sentences = [s for s in re.split(r"[.!?]+", response) if len(s.strip()) > 2]
    prompt_words = max(1, len([w for w in (prompt or "").split() if w]))

    code_blocks = response.count("```") // 2
    has_code    = code_blocks > 0 or bool(re.search(r"\b(def |function |SELECT |class |import )", response))
    has_table   = response.count("|") >= 8
    has_links   = bool(re.search(r"https?://|www\.", response))
    has_figures = bool(re.search(r"[£$]\s?[\d,]+|\b\d+%|\b\d{4}\b", response))
    broken      = bool(re.search(r"\b(syntax error|traceback|is not defined|cannot read property)\b", text))

    substance = 55
    if has_code:    substance += 15
    if has_table:   substance += 10
    if has_links:   substance += 10
    if has_figures: substance += 10
    if broken:      substance -= 30
    substance = max(0, min(100, substance))

    expected = max(120, prompt_words * 12)
    ratio = wc / expected
    if ratio < 1:
        completeness = int(round(ratio * 100))
    elif ratio <= 2:
        completeness = 100
    else:
        completeness = max(55, int(round(100 - (ratio - 2) * 12)))

    headings = len(re.findall(r"(?m)^#{1,3}\s", response))
    bullets  = len(re.findall(r"(?m)^\s*[-*\u2022]\s", response))
    numbered = len(re.findall(r"(?m)^\s*\d+[.)]\s", response))
    avg_sent = (wc / len(sentences)) if sentences else 0

    clarity = 50
    if headings > 0:            clarity += 15
    if bullets + numbered >= 2: clarity += 15
    if has_table:               clarity += 10
    if 10 <= avg_sent <= 28:    clarity += 10
    clarity = max(0, min(100, clarity))

    refusal = bool(re.search(r"\b(i cannot|i can't|i am unable|i'm unable|as an ai|i do not have access)\b", text))
    hedged  = bool(re.search(r"\b(verify|may have changed|as of my|please confirm|check directly|not certain)\b", text))

    reliability = 90
    if refusal: reliability -= 45
    if broken:  reliability -= 30
    if hedged:  reliability += 10
    reliability = max(0, min(100, reliability))

    return int(round(substance * 0.35 + completeness * 0.20 + clarity * 0.25 + reliability * 0.20))

# ── Scoring Engine (LLM-as-judge) ─────────────────────────
# NEW. Runs ALONGSIDE the rule-based scorer. Returns the four dimension
# sub-scores from the judge model, then applies the SAME weights as above.
def llm_score(response, prompt, category="General"):
    empty = {"substance": 0, "completeness": 0, "clarity": 0,
             "reliability": 0, "overall": 0, "justification": "No response to score."}
    if not response or not isinstance(response, str):
        return empty
    if response.strip() == "" or "coming soon" in response.lower():
        return empty

    key = os.getenv("OPENAI_API_KEY")
    if not key or key == "not_set":
        return {**empty, "justification": "Judge unavailable (no OpenAI API key set)."}

    try:
        from openai import OpenAI
        client = OpenAI(api_key=key)
        user_msg = (
            f"CATEGORY: {category}\n\n"
            f"USER PROMPT:\n{prompt}\n\n"
            f"AI RESPONSE TO EVALUATE:\n{response}"
        )
        judge = client.chat.completions.create(
            model=JUDGE_MODEL,
            temperature=0,  # deterministic for reproducibility
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
        data = json.loads(judge.choices[0].message.content)

        def clamp(v):
            try:
                v = int(round(float(v)))
            except (TypeError, ValueError):
                v = 0
            return max(0, min(100, v))

        s   = clamp(data.get("substance", 0))
        co  = clamp(data.get("completeness", 0))
        cl  = clamp(data.get("clarity", 0))
        rel = clamp(data.get("reliability", 0))
        overall = int(round(
            s * W_SUBSTANCE + co * W_COMPLETENESS + cl * W_CLARITY + rel * W_RELIABILITY
        ))
        just = str(data.get("justification", ""))[:600]
        return {"substance": s, "completeness": co, "clarity": cl,
                "reliability": rel, "overall": overall, "justification": just}
    except Exception as e:
        return {**empty, "justification": f"Judge error: {e}"}

# ── AI Functions ──────────────────────────────────────────
def call_openai(prompt):
    key = os.getenv("OPENAI_API_KEY")
    if not key or key == "not_set":
        return {"response": "OpenAI coming soon!", "time_ms": 0, "tokens": 0, "error": None, "unavailable": True}
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key)
        start = time.time()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )
        elapsed = round((time.time() - start) * 1000)
        return {"response": response.choices[0].message.content, "time_ms": elapsed, "tokens": response.usage.total_tokens, "error": None, "unavailable": False}
    except Exception as e:
        return {"response": None, "time_ms": 0, "tokens": 0, "error": str(e), "unavailable": False}

def call_claude(prompt):
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key or key == "not_set":
        return {"response": "Claude coming soon!", "time_ms": 0, "tokens": 0, "error": None, "unavailable": True}
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=key)
        start = time.time()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}]
        )
        elapsed = round((time.time() - start) * 1000)
        return {"response": response.content[0].text, "time_ms": elapsed, "tokens": response.usage.input_tokens + response.usage.output_tokens, "error": None, "unavailable": False}
    except Exception as e:
        return {"response": None, "time_ms": 0, "tokens": 0, "error": str(e), "unavailable": False}

def call_gemini(prompt):
    key = os.getenv("GEMINI_API_KEY")
    if not key or key == "not_set":
        return {"response": "Gemini coming soon!", "time_ms": 0, "tokens": 0, "error": None, "unavailable": True}
    try:
        import google.genai as genai
        client = genai.Client(api_key=key)
        start = time.time()
        response = client.models.generate_content(
            model="gemini-2.5-pro",
            contents=prompt
        )
        elapsed = round((time.time() - start) * 1000)
        tokens = 0
        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            tokens = (response.usage_metadata.prompt_token_count or 0) + \
                     (response.usage_metadata.candidates_token_count or 0)
        return {"response": response.text, "time_ms": elapsed, "tokens": tokens, "error": None, "unavailable": False}
    except Exception as e:
        return {"response": None, "time_ms": 0, "tokens": 0, "error": str(e), "unavailable": False}

# ── Column list reused by history routes ──────────────────
# Order MUST match the table column order (SELECT *). The six LLM columns are
# appended last, matching both the CREATE TABLE above and the migration.
COLUMNS = ["id","timestamp","prompt","category","project_id",
           "openai_response","openai_time","openai_tokens","openai_score",
           "claude_response","claude_time","claude_tokens","claude_score",
           "gemini_response","gemini_time","gemini_tokens","gemini_score",
           "openai_llm_score","openai_llm_detail",
           "claude_llm_score","claude_llm_detail",
           "gemini_llm_score","gemini_llm_detail"]

# ── Routes ────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route("/build")
def build_page():
    return send_from_directory('../frontend', 'build.html')

@app.route("/assist")
def assist_page():
    return send_from_directory('../frontend', 'assist.html')

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    return response

@app.route("/benchmark", methods=["POST", "OPTIONS"])
def benchmark():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    data       = request.get_json()
    prompt     = data.get("prompt", "")
    category   = data.get("category", "General")
    project_id = data.get("project_id", None)

    # 1) Call the three models AT THE SAME TIME (previously sequential).
    #    Total generation time is now the slowest single model, not the sum
    #    of all three. Each call_* still catches its own errors, so one slow
    #    or failing model cannot break the others.
    with ThreadPoolExecutor(max_workers=3) as ex:
        gen_futures = {
            "openai": ex.submit(call_openai, prompt),
            "claude": ex.submit(call_claude, prompt),
            "gemini": ex.submit(call_gemini, prompt),
        }
        results = {key: f.result() for key, f in gen_futures.items()}

    # Rule-based scores (unchanged - local, no network, fast)
    scores = {
        "openai": auto_score(results["openai"].get("response","") or "", prompt),
        "claude": auto_score(results["claude"].get("response","") or "", prompt),
        "gemini": auto_score(results["gemini"].get("response","") or "", prompt),
    }

    # 2) Run the three LLM-judge calls AT THE SAME TIME too (previously
    #    sequential). This is the other half of the Build slowdown: the judge
    #    has to read each full answer. Running them together means the judging
    #    stage takes the time of the slowest single judge call, not the sum.
    with ThreadPoolExecutor(max_workers=3) as ex:
        judge_futures = {
            key: ex.submit(llm_score, results[key].get("response","") or "", prompt, category)
            for key in ("openai", "claude", "gemini")
        }
        for key, f in judge_futures.items():
            results[key]["llm"] = f.result()

    save_result(prompt, category, results, scores, project_id)
    return jsonify({"prompt": prompt, "category": category, **results})

@app.route("/history", methods=["GET"])
def history():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM benchmarks ORDER BY timestamp DESC")
    rows = c.fetchall()
    conn.close()
    return jsonify([dict(zip(COLUMNS, row)) for row in rows])

@app.route("/history/<int:record_id>", methods=["DELETE"])
def delete_record(record_id):
    conn = get_conn()
    c = conn.cursor()
    c.execute(q("DELETE FROM benchmarks WHERE id = ?"), (record_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deleted"})

@app.route("/rescore", methods=["POST", "OPTIONS"])
def rescore():
    """Recompute scores for saved runs. Reads only the stored responses, so
    response times and token counts are never changed.

    Optional JSON body:
      mode:         "rule" | "llm" | "both"   (default "both")
      only_missing: true/false                (default true - only rows with no LLM score yet)
      limit:        integer                   (default None - process all)

    Designed to be resumable: with only_missing=true and a small limit, call it
    repeatedly (the History page button does this) so no single request has to
    make hundreds of judge calls and time out. Returns how many were scored and
    how many still remain.
    """
    if request.method == "OPTIONS":
        return jsonify({}), 200

    body = request.get_json(silent=True) or {}
    mode         = body.get("mode", "both")
    only_missing = body.get("only_missing", True)
    limit        = body.get("limit", None)

    conn = get_conn()
    c = conn.cursor()

    where = "WHERE openai_llm_score IS NULL" if only_missing else ""
    c.execute(
        f"SELECT id, prompt, category, openai_response, claude_response, gemini_response "
        f"FROM benchmarks {where} ORDER BY id"
    )
    rows = c.fetchall()
    total_to_do = len(rows)
    if limit:
        rows = rows[:int(limit)]

    done = 0
    for row in rows:
        rid, prompt, category, o, cl, g = row[0], row[1], row[2], row[3], row[4], row[5]
        category = category or "General"

        if mode in ("rule", "both"):
            c.execute(
                q("UPDATE benchmarks SET openai_score=?, claude_score=?, gemini_score=? WHERE id=?"),
                (auto_score(o or "", prompt or ""),
                 auto_score(cl or "", prompt or ""),
                 auto_score(g or "", prompt or ""),
                 rid)
            )

        if mode in ("llm", "both"):
            lo = llm_score(o or "", prompt or "", category)
            lc = llm_score(cl or "", prompt or "", category)
            lg = llm_score(g or "", prompt or "", category)
            c.execute(
                q('''UPDATE benchmarks SET
                    openai_llm_score=?, openai_llm_detail=?,
                    claude_llm_score=?, claude_llm_detail=?,
                    gemini_llm_score=?, gemini_llm_detail=?
                    WHERE id=?'''),
                (lo["overall"], json.dumps(lo),
                 lc["overall"], json.dumps(lc),
                 lg["overall"], json.dumps(lg),
                 rid)
            )

        conn.commit()   # commit each row so progress survives a timeout
        done += 1

    conn.close()
    return jsonify({"status": "ok", "rescored": done, "remaining": total_to_do - done})

@app.route("/projects", methods=["GET"])
def get_projects():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM projects ORDER BY created_at DESC")
    rows = c.fetchall()
    conn.close()
    return jsonify([{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows])

@app.route("/projects", methods=["POST"])
def create_project():
    data = request.get_json()
    name = data.get("name", "Untitled Project")
    conn = get_conn()
    c = conn.cursor()
    c.execute(q("INSERT INTO projects (name, created_at) VALUES (?, ?)"),
              (name, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({"id": new_id, "name": name})

@app.route("/projects/<int:project_id>", methods=["DELETE"])
def delete_project(project_id):
    conn = get_conn()
    c = conn.cursor()
    c.execute(q("DELETE FROM projects WHERE id = ?"), (project_id,))
    c.execute(q("UPDATE benchmarks SET project_id = NULL WHERE project_id = ?"), (project_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deleted"})

@app.route("/projects/<int:project_id>/benchmarks", methods=["GET"])
def get_project_benchmarks(project_id):
    conn = get_conn()
    c = conn.cursor()
    c.execute(q("SELECT * FROM benchmarks WHERE project_id = ? ORDER BY timestamp DESC"), (project_id,))
    rows = c.fetchall()
    conn.close()
    return jsonify([dict(zip(COLUMNS, row)) for row in rows])

if __name__ == "__main__":
    app.run(debug=True, port=5000)
