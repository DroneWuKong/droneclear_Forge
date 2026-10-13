"""Apply the partner account schema once, preserving the existing catalog and audit."""
import json
import re
import sqlite3

from provision_forge_policy import ROOT, ProvisioningError, normalize_sql, run_wrangler

DATABASE = 'ECOSYSTEM_DB'
DATABASE_ID = 'c54a26b7-bb94-418f-8220-5d8c04819f47'
MIGRATION = 'ecosystem-migrations/0003_partner_accounts.sql'


def query_schema():
    output = run_wrangler([
        'd1', 'execute', DATABASE, '--remote', '--yes', '--json',
        '--config', 'wrangler.jsonc', '--command',
        "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL",
    ])
    try:
        results = json.loads(output)
        if not results or any(item.get('success') is not True for item in results):
            raise ValueError
        return [row for item in results for row in item['results']]
    except (ValueError, KeyError, TypeError):
        raise ProvisioningError('Partner schema inspection did not return successful JSON') from None


def schema_state(rows):
    actual = {(row['type'], row['name']): normalize_sql(row['sql']) for row in rows if row.get('sql')}
    with sqlite3.connect(':memory:') as database:
        for file in ('0001_ecosystem.sql', '0002_partner_portal_v2.sql'):
            database.executescript((ROOT / 'ecosystem-migrations' / file).read_text())

        def schema():
            return {(kind, name): normalize_sql(sql) for kind, name, sql in database.execute(
                "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL")}

        before = schema()
        database.executescript((ROOT / MIGRATION).read_text())
        after = schema()
    new_keys = after.keys() - before.keys()
    if new_keys & actual.keys():
        if after.keys() <= actual.keys() and all(actual[key] == sql for key, sql in after.items()):
            return 'ready'
        raise ProvisioningError('Partner schema is incomplete or conflicts; no migration was applied')
    if not before.keys() <= actual.keys() or any(actual[key] != sql for key, sql in before.items()):
        raise ProvisioningError('Existing ecosystem schema is incomplete or conflicts; no migration was applied')
    return 'needs-migration'


def provision():
    config = (ROOT / 'wrangler.jsonc').read_text()
    if not re.search(r'"binding"\s*:\s*"ECOSYSTEM_DB".*?"database_id"\s*:\s*"' + DATABASE_ID + '"', config, re.S):
        raise ProvisioningError('Production ecosystem database identity differs')
    if schema_state(query_schema()) == 'needs-migration':
        run_wrangler(['d1', 'execute', DATABASE, '--remote', '--yes', '--config', 'wrangler.jsonc', '--file', MIGRATION])
    if schema_state(query_schema()) != 'ready':
        raise ProvisioningError('Partner account schema readback failed')
    print(json.dumps({'partner_schema_verified': True, 'catalog_records_preserved': True}))


if __name__ == '__main__':
    try:
        provision()
    except ProvisioningError as error:
        raise SystemExit(str(error)) from None
