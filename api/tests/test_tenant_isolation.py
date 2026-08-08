import os
from pathlib import Path

import psycopg
import pytest
from psycopg import errors


pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL_TEST"), reason="DATABASE_URL_TEST must point at a disposable Postgres database"
)


def _set_user(conn: psycopg.Connection, user_id: str) -> None:
    conn.execute("select set_config('app.user_id', %s, true)", (user_id,))


def test_outsider_cannot_read_or_upload_group_resources():
    dsn = os.environ["DATABASE_URL_TEST"]
    schema_path = Path(__file__).resolve().parents[1] / "db" / "001_init.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(schema_sql)
        conn.execute("truncate table resources, group_members, groups, users restart identity cascade")

        owner = conn.execute(
            "insert into users (email, password_hash) values (%s, %s) returning id",
            ("owner@example.com", "hash"),
        ).fetchone()[0]
        outsider = conn.execute(
            "insert into users (email, password_hash) values (%s, %s) returning id",
            ("outsider@example.com", "hash"),
        ).fetchone()[0]

        _set_user(conn, str(owner))
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

        _set_user(conn, str(outsider))
        visible_rows = conn.execute("select id from resources where group_id = %s", (group_id,)).fetchall()
        assert visible_rows == []

        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(
                """
                insert into resources (group_id, uploaded_by, url_or_file_ref, title, note, status)
                values (%s, %s, %s, %s, %s, 'processed')
                """,
                (group_id, outsider, "https://example.com/other", "Blocked", None),
            )import os
from pathlib import Path

import psycopg
import pytest
from psycopg import errors


pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL_TEST"), reason="DATABASE_URL_TEST must point at a disposable Postgres database"
)


def _set_user(conn: psycopg.Connection, user_id: str) -> None:
    conn.execute("select set_config('app.user_id', %s, true)", (user_id,))


def test_outsider_cannot_read_or_upload_group_resources():
    dsn = os.environ["DATABASE_URL_TEST"]
    schema_path = Path(__file__).resolve().parents[1] / "db" / "001_init.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(schema_sql)
        conn.execute("truncate table resources, group_members, groups, users restart identity cascade")

        owner = conn.execute(
            "insert into users (email, password_hash) values (%s, %s) returning id",
            ("owner@example.com", "hash"),
        ).fetchone()[0]
        outsider = conn.execute(
            "insert into users (email, password_hash) values (%s, %s) returning id",
            ("outsider@example.com", "hash"),
        ).fetchone()[0]

        _set_user(conn, str(owner))
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

        _set_user(conn, str(outsider))
        visible_rows = conn.execute("select id from resources where group_id = %s", (group_id,)).fetchall()
        assert visible_rows == []

        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(
                """
                insert into resources (group_id, uploaded_by, url_or_file_ref, title, note, status)
                values (%s, %s, %s, %s, %s, 'processed')
                """,
                (group_id, outsider, "https://example.com/other", "Blocked", None),
            )