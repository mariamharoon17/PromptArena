import os
import sqlite3
import sys

try:
    import mysql.connector
except ImportError:
    sys.exit("mysql.connector not installed. Run:  python -m pip install mysql-connector-python")


def main():
    if not os.path.exists("benchmark.db"):
        sys.exit("Could not find benchmark.db here. Run this from your backend folder.")

    # ---- read local (master) ----
    local = sqlite3.connect("benchmark.db")
    local.row_factory = sqlite3.Row
    rows = local.execute("SELECT * FROM benchmarks ORDER BY id").fetchall()
    if not rows:
        sys.exit("No runs found in local benchmark.db  nothing to sync.")
    local_cols = list(rows[0].keys())
    print(f"Local benchmark.db: {len(rows)} runs, {len(local_cols)} columns.")

    # ---- connect to cloud ----
    try:
        cfg = {
            "host":     os.environ["DB_HOST"],
            "user":     os.environ["DB_USER"],
            "password": os.environ["DB_PASSWORD"],
            "database": os.environ["DB_NAME"],
            "port":     int(os.environ.get("DB_PORT", "3306")),
            "charset":  "utf8mb4",
        }
    except KeyError as e:
        sys.exit(f"Missing environment variable: {e}. See the notes at the top of this file.")
    cfg["ssl_disabled"] = False

    print(f"Connecting to Azure MySQL at {cfg['host']} ...")
    cloud = mysql.connector.connect(**cfg)
    cur = cloud.cursor()

    cur.execute("SHOW COLUMNS FROM benchmarks")
    cloud_cols = [r[0] for r in cur.fetchall()]

    # ---- work out which columns to copy ----
    shared      = [c for c in local_cols if c in cloud_cols and c != "id"]
    local_only  = [c for c in local_cols if c not in cloud_cols and c != "id"]

    print(f"\nColumns that will be copied ({len(shared)}):")
    print("  " + ", ".join(shared))

    if local_only:
        print(f"\n  WARNING: these columns exist on your laptop but NOT in the cloud database:")
        print("    " + ", ".join(local_only))
        print("  That usually means your latest app image is not deployed yet.")
        print("  If these include your judge columns, STOP, deploy the new image,")
        print("  then run this again so they come across too.\n")

    cur.execute("SELECT COUNT(*) FROM benchmarks")
    before = cur.fetchone()[0]
    print(f"Cloud database currently has {before} runs. This will REPLACE them with your {len(rows)} local runs.")

    ans = input("Proceed? (yes/no): ").strip().lower()
    if ans != "yes":
        print("Cancelled  nothing was changed.")
        return

    # ---- make sure emojis are storable ----
    try:
        cur.execute("ALTER TABLE benchmarks CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        cloud.commit()
    except mysql.connector.Error as e:
        print(f"(charset step skipped: {e})")

    # ---- replace cloud data with local data ----
    cur.execute("DELETE FROM benchmarks")
    placeholders = ",".join(["%s"] * len(shared))
    sql = f"INSERT INTO benchmarks ({','.join(shared)}) VALUES ({placeholders})"

    inserted = 0
    for r in rows:
        vals = [r[c] for c in shared]
        cur.execute(sql, vals)
        inserted += 1

    cloud.commit()
    cur.execute("SELECT COUNT(*) FROM benchmarks")
    after = cur.fetchone()[0]
    print(f"\nDone. Cloud database now has {after} runs, matching your laptop.")

    cur.close()
    cloud.close()
    local.close()


if __name__ == "__main__":
    main()
