"""
import_to_azure.py
-------------------
Copies your saved benchmark runs from your LOCAL SQLite database
(benchmark.db) up into the LIVE Azure MySQL database, so the History
page on the deployed site shows them.

HOW TO RUN:

  1. Install the MySQL driver:
         pip install mysql-connector-python

  2. Set the 5 connection values as environment variables. In Windows
     PowerShell (replace the <...> bits with your real Azure values):

         $env:DB_HOST     = "promptarena-db.mysql.database.azure.com"
         $env:DB_USER     = "<your mysql admin username>"
         $env:DB_PASSWORD = "<your mysql password>"
         $env:DB_NAME     = "<your database name>"     # e.g. benchmark
         $env:DB_PORT     = "3306"

  3. Run it:
         python import_to_azure.py

It is SAFE to read: it only ADDS your runs to the cloud. It never deletes
anything. Run it ONCE  running it twice would create duplicate rows.
It prints how many runs it found locally and how many it added, so you
can confirm before and after.
"""

import os
import sqlite3
import sys

try:
    import mysql.connector
except ImportError:
    sys.exit("mysql.connector not installed. Run:  pip install mysql-connector-python")

# ---- columns that exist in the app's 'benchmarks' table ----
COLS = [
    "timestamp", "prompt", "category", "project_id",
    "openai_response", "openai_time", "openai_tokens", "openai_score",
    "claude_response", "claude_time", "claude_tokens", "claude_score",
    "gemini_response", "gemini_time", "gemini_tokens", "gemini_score",
]

def main():
    # ---- read local SQLite ----
    if not os.path.exists("benchmark.db"):
        sys.exit("Could not find benchmark.db in this folder. "
                 "Run this script from your PromptArena project folder.")

    local = sqlite3.connect("benchmark.db")
    local.row_factory = sqlite3.Row
    rows = local.execute("SELECT * FROM benchmarks ORDER BY id").fetchall()
    print(f"Found {len(rows)} runs in your local benchmark.db")
    if not rows:
        sys.exit("No runs found locally  nothing to import.")

    # ---- read Azure connection details from environment ----
    try:
        cfg = {
            "host":     os.environ["DB_HOST"],
            "user":     os.environ["DB_USER"],
            "password": os.environ["DB_PASSWORD"],
            "database": os.environ["DB_NAME"],
            "port":     int(os.environ.get("DB_PORT", "3306")),
            "charset":  "utf8mb4",          # full Unicode / emoji support
        }
    except KeyError as e:
        sys.exit(f"Missing environment variable: {e}. See the instructions at the top of this file.")

    # Azure MySQL requires an encrypted connection; this enables SSL.
    cfg["ssl_disabled"] = False

    print(f"Connecting to Azure MySQL at {cfg['host']} ...")
    cloud = mysql.connector.connect(**cfg)
    cur = cloud.cursor()

    cur.execute("SELECT COUNT(*) FROM benchmarks")
    before = cur.fetchone()[0]
    print(f"Cloud database currently has {before} runs.")

    # Make sure the cloud table can store emojis / 4-byte characters
    # (older Azure MySQL tables default to a charset that cannot).
    print("Upgrading the database to full Unicode (utf8mb4) so emojis import cleanly ...")
    try:
        cur.execute("ALTER TABLE benchmarks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cloud.commit()
        print("  ...done.")
    except mysql.connector.Error as e:
        print(f"  (skipped: {e})")

    if before > 0:
        ans = input(f"The cloud already has {before} run(s). Add your {len(rows)} local runs on top? (yes/no): ").strip().lower()
        if ans != "yes":
            print("Cancelled  nothing was changed.")
            return

    placeholders = ",".join(["%s"] * len(COLS))
    sql = f"INSERT INTO benchmarks ({','.join(COLS)}) VALUES ({placeholders})"

    inserted = 0
    for r in rows:
        keys = r.keys()
        vals = [(r[c] if c in keys else None) for c in COLS]
        vals[COLS.index("project_id")] = None  # show all imported runs under "All benchmark runs"
        cur.execute(sql, vals)
        inserted += 1

    cloud.commit()

    cur.execute("SELECT COUNT(*) FROM benchmarks")
    after = cur.fetchone()[0]
    print(f"Done. Imported {inserted} runs. Cloud database now has {after} runs total.")

    cur.close()
    cloud.close()
    local.close()

if __name__ == "__main__":
    main()
