# Private local SQLite to Postgres rehearsal

Requirements: Node 22.13+ with node:sqlite, Docker for a task-owned Postgres 16 fixture (or an explicitly supplied loopback elo_test service), Python 3 for consistent SQLite backup, and installed npm dependencies. With an externally supplied test service, a compatible pg_dump/pg_restore must also be installed or ELO_TEST_POSTGRES_CONTAINER must identify that test service's container.

Create a backup outside the repository. Replace the example paths with approved local paths; never copy a live production database without an approved export process.

```sh
python3 scripts/migration/export-sqlite.py --source /private/path/source.db --output /private/path/backup.db
node scripts/migration/import-sqlite.mjs /private/path/backup.db --dry-run
LEGACY_SQLITE_COPY=/private/path/backup.db npm run test:legacy-import
```

The last command creates isolated Postgres, applies committed migrations, imports into empty tables, compares all preserved field hashes, dumps it, restores into a separately created empty database and compares again. It removes only task-owned test databases and temporary dumps. It does not modify SQLite or any hosted database. Without LEGACY_SQLITE_COPY the same command uses a synthetic legacy schema fixture, including duplicate legacy display names, for CI.

Direct import is intentionally loopback-only. It requires an empty application database. It refuses legacy ranked rooms requiring snapshot mapping. The rollback asset is the preserved, private source export and a verified Postgres backup; do not run destructive down-migrations. At live cutover, writes must be frozen, a current consistent export imported and verified, application versions and secrets coordinated, then traffic switched. Any writes after cutover must be reconciled before routing back to the old source.

No production cutover is authorized or performed by these scripts. Keep backups private and outside Git. Do not upload a real history database as CI artifacts.
