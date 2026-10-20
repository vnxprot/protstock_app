"""Reclaim rewrite space after a one-off vendor refresh, without deleting rows."""
import os
from urllib.parse import quote

import psycopg
from psycopg import sql


password = quote(os.environ["SUPABASE_DB_PASSWORD"], safe="")
url = f"postgresql://postgres.upmqxwktvvguegqeqibn:{password}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
with psycopg.connect(url, autocommit=True, connect_timeout=30) as connection:
    connection.execute("set lock_timeout = '5s'")
    connection.execute("set statement_timeout = '180s'")
    for table in ("daily_prices", "market_index_prices", "derived_bars", "technical_snapshots"):
        connection.execute(sql.SQL("VACUUM (FULL, ANALYZE) public.{}").format(sql.Identifier(table)))
        print(f"Reclaimed rewrite space: {table}", flush=True)
