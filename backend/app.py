from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import os
import time
import sqlite3
import json
from datetime import datetime

load_dotenv()

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# ── Database Setup ────────────────────────────────────────
def init_db():
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            prompt TEXT,
            category TEXT,
            project_id INTEGER DEFAULT NULL,
            openai_response TEXT,
            openai_time INTEGER,
            openai_tokens INTEGER,
            openai_score INTEGER,
            claude_response TEXT,
            claude_time INTEGER,
            claude_tokens INTEGER,
            claude_score INTEGER,
            gemini_response TEXT,
            gemini_time INTEGER,
            gemini_tokens INTEGER,
            gemini_score INTEGER
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            created_at TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def save_result(prompt, category, results, scores, project_id=None):
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute('''
        INSERT INTO benchmarks (
            timestamp, prompt, category, project_id,
            openai_response, openai_time, openai_tokens, openai_score,
            claude_response, claude_time, claude_tokens, claude_score,
            gemini_response, gemini_time, gemini_tokens, gemini_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        prompt, category, project_id,
        results['openai'].get('response',''), results['openai'].get('time_ms',0),
        results['openai'].get('tokens',0), scores.get('openai',0),
        results['claude'].get('response',''), results['claude'].get('time_ms',0),
        results['claude'].get('tokens',0), scores.get('claude',0),
        results['gemini'].get('response',''), results['gemini'].get('time_ms',0),
        results['gemini'].get('tokens',0), scores.get('gemini',0),
    ))
    conn.commit()
    conn.close()

# ── Scoring Engine ────────────────────────────────────────
def auto_score(response, prompt):
    if not response:
        return 0
    text = response.lower()
    words = response.split()
    sentences = [s for s in response.split('.') if len(s.strip()) > 2]
    prompt_words = len(prompt.split())

    has_code = any(x in response for x in ["```", "def ", "function", "SELECT", "<html", "const "])
    error_keywords = ["syntax error", "undefined", "null pointer", "traceback", "exception", "is not defined"]
    has_errors = any(k in text for k in error_keywords)
    code_score = (40 if has_errors else 90) if has_code else (20 if has_errors else 70)

    expected = max(100, prompt_words * 15)
    completeness = min(100, round((len(words) / expected) * 100))

    avg_words = len(words) / len(sentences) if sentences else 0
    has_structure = any(x in response for x in ["\n", "•", "-", "1."])
    clarity = 60
    if 8 <= avg_words <= 25: clarity += 20
    if has_structure: clarity += 15
    if len(words) > 50: clarity += 5
    clarity = min(100, clarity)

    negative = ["i cannot", "i can't", "i don't know", "i'm unable", "not possible"]
    has_negative = any(k in text for k in negative)
    error_rate = 40 if has_negative else (30 if has_errors else 95)

    return round((code_score * 0.35) + (completeness * 0.25) + (clarity * 0.25) + (error_rate * 0.15))

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
            model="gpt-4o-mini",
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
            model="claude-haiku-4-5",
            max_tokens=1024,
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
            model="gemini-3-flash-preview",
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

# ── Routes ────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory('../frontend', 'index.html')

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

    results = {
        "openai": call_openai(prompt),
        "claude": call_claude(prompt),
        "gemini": call_gemini(prompt)
    }
    scores = {
        "openai": auto_score(results["openai"].get("response",""), prompt),
        "claude": auto_score(results["claude"].get("response",""), prompt),
        "gemini": auto_score(results["gemini"].get("response",""), prompt),
    }
    save_result(prompt, category, results, scores, project_id)
    return jsonify({"prompt": prompt, "category": category, **results})

@app.route("/history", methods=["GET"])
def history():
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute("SELECT * FROM benchmarks ORDER BY timestamp DESC LIMIT 50")
    rows = c.fetchall()
    conn.close()
    columns = ["id","timestamp","prompt","category","project_id",
               "openai_response","openai_time","openai_tokens","openai_score",
               "claude_response","claude_time","claude_tokens","claude_score",
               "gemini_response","gemini_time","gemini_tokens","gemini_score"]
    return jsonify([dict(zip(columns, row)) for row in rows])

@app.route("/history/<int:record_id>", methods=["DELETE"])
def delete_record(record_id):
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute("DELETE FROM benchmarks WHERE id = ?", (record_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deleted"})

@app.route("/projects", methods=["GET"])
def get_projects():
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute("SELECT * FROM projects ORDER BY created_at DESC")
    rows = c.fetchall()
    conn.close()
    return jsonify([{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows])

@app.route("/projects", methods=["POST"])
def create_project():
    data = request.get_json()
    name = data.get("name", "Untitled Project")
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute("INSERT INTO projects (name, created_at) VALUES (?, ?)",
              (name, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    project_id = c.lastrowid
    conn.commit()
    conn.close()
    return jsonify({"id": project_id, "name": name})

@app.route("/projects/<int:project_id>", methods=["DELETE"])
def delete_project(project_id):
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    c.execute("UPDATE benchmarks SET project_id = NULL WHERE project_id = ?", (project_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deleted"})

@app.route("/projects/<int:project_id>/benchmarks", methods=["GET"])
def get_project_benchmarks(project_id):
    conn = sqlite3.connect('benchmark.db')
    c = conn.cursor()
    c.execute("SELECT * FROM benchmarks WHERE project_id = ? ORDER BY timestamp DESC", (project_id,))
    rows = c.fetchall()
    conn.close()
    columns = ["id","timestamp","prompt","category","project_id",
               "openai_response","openai_time","openai_tokens","openai_score",
               "claude_response","claude_time","claude_tokens","claude_score",
               "gemini_response","gemini_time","gemini_tokens","gemini_score"]
    return jsonify([dict(zip(columns, row)) for row in rows])

if __name__ == "__main__":
    app.run(debug=True, port=5000)