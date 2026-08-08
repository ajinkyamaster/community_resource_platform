import os
import psycopg

def test_rls():
    dsn = "postgresql://postgres:postgres@db:5432/community_resource_db"
    with psycopg.connect(dsn, autocommit=True) as conn:
        print("Connected")
        
        # Reset DB just like helpers.ts
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        with open("/workspace/api/db/001_init.sql") as f:
            conn.execute(f.read())
            
        owner = conn.execute(
            "insert into users (email, password_hash) values (%s, %s) returning id",
            ("owner@example.com", "hash"),
        ).fetchone()[0]
        outsider = conn.execute(
            "insert into users (email, password_hash) values (%s, %s) returning id",
            ("outsider@example.com", "hash"),
        ).fetchone()[0]

        conn.execute("select set_config('app.user_id', %s, true)", (str(owner),))
        group_id = conn.execute(
            "insert into groups (name, created_by) values (%s, %s) returning id",
            ("Study Group", owner),
        ).fetchone()[0]
        conn.execute("insert into group_members (group_id, user_id) values (%s, %s)", (group_id, owner))
        conn.execute(
            """
            insert into resources (group_id, uploaded_by, url_or_file_ref, title, note, status)
            values (%s, %s, %s, %s, %s, 'processed')
            """,
            (group_id, owner, "https://example.com/article", "Example", "Seed resource"),
        )

        conn.execute("select set_config('app.user_id', %s, true)", (str(outsider),))
        visible_rows = conn.execute("select id from resources where group_id = %s", (group_id,)).fetchall()
        print("Visible rows:", visible_rows)

        try:
            conn.execute(
                """
                insert into resources (group_id, uploaded_by, url_or_file_ref, title, note, status)
                values (%s, %s, %s, %s, %s, 'processed')
                """,
                (group_id, outsider, "https://example.com/other", "Blocked", None),
            )
            print("INSERT SUCCEEDED (Bypassed RLS)")
        except Exception as e:
            print("INSERT FAILED (RLS enforced):", type(e), e)

test_rls()
