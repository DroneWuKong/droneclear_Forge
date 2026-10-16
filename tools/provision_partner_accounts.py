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


def pending_migrations(rows):
    actual = {(row['type'], row['name']): normalize_sql(row['sql']) for row in rows if row.get('sql')}
    versions = []
    with sqlite3.connect(':memory:') as database:
        for file in ('0001_ecosystem.sql', '0002_partner_portal_v2.sql', '0003_partner_accounts.sql', '0004_partner_completion_and_recovery.sql', '0005_partner_reviewers.sql', '0006_developer_hub_access.sql'):
            database.executescript((ROOT / 'ecosystem-migrations' / file).read_text())
            if file.startswith('0001'):
                continue
            expected = {(kind, name): normalize_sql(sql) for kind, name, sql in database.execute(
                "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL")}
            versions.append(expected)
    new_files = ['ecosystem-migrations/0003_partner_accounts.sql', 'ecosystem-migrations/0004_partner_completion_and_recovery.sql','ecosystem-migrations/0005_partner_reviewers.sql','ecosystem-migrations/0006_developer_hub_access.sql']
    for index in range(len(versions) - 1, -1, -1):
        expected = versions[index]
        if expected.keys() <= actual.keys() and all(actual[key] == sql for key, sql in expected.items()):
            added_keys = versions[-1].keys() - expected.keys()
            if added_keys & actual.keys():
                raise ProvisioningError('Partner schema is partial or conflicts; no migration was applied')
            return new_files[index:]
    raise ProvisioningError('Existing ecosystem schema is incomplete or conflicts; no migration was applied')


def schema_state(rows):
    return 'needs-migration' if pending_migrations(rows) else 'ready'


def provision():
    config = (ROOT / 'wrangler.jsonc').read_text()
    if not re.search(r'"binding"\s*:\s*"ECOSYSTEM_DB".*?"database_id"\s*:\s*"' + DATABASE_ID + '"', config, re.S):
        raise ProvisioningError('Production ecosystem database identity differs')
    for migration in pending_migrations(query_schema()):
        run_wrangler(['d1', 'execute', DATABASE, '--remote', '--yes', '--config', 'wrangler.jsonc', '--file', migration])
    if schema_state(query_schema()) != 'ready':
        raise ProvisioningError('Partner account schema readback failed')
    print(json.dumps({'partner_schema_verified': True, 'catalog_records_preserved': True}))


if __name__ == '__main__':
    try:
        provision()
    except ProvisioningError as error:
        raise SystemExit(str(error)) from None
