# Archived SQLite schema

These files describe the pre-hardening database and are retained for export/import and rollback rehearsal only. Do not apply them to Postgres, generate the active client from this schema, or reset a source database. The active committed migration history is under prisma/migrations. A SQLite file must be converted into an empty Postgres target through the approved import process, not pointed at the Postgres client.
