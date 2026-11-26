# Backups

Daily encrypted backups of the Supabase database to Cloudflare R2, and the scripts to restore them ([ADR 0082](../../docs/adr/0082-despliegue-automatico-y-respaldos-cifrados.md)). The owner's steps, in Spanish, are in [docs/despliegue-en-la-nube.md](../../docs/despliegue-en-la-nube.md), sections 10 to 13.

| File | Purpose |
| --- | --- |
| `Dockerfile` | Tools image: PostgreSQL 17 client tools plus `age`. Production and the test use the same one |
| `create-backup.sh` | `pg_dump` of the `public` schema, checked with `pg_restore --list`, then encrypted with `age` |
| `upload-backup.sh` | Uploads to `daily/` (and `monthly/` on the 1st) and checks the stored size |
| `restore-backup.sh` | Decrypts and restores into an empty database in one transaction |
| `test-round-trip.sh` | Migrate, seed, back up, restore, compare: rows, RLS policies, Flyway history, and RLS still enforced |
| `age-recipients.txt` | Public `age` keys. The private key never enters the repository or GitHub |

Retention is handled by the R2 lifecycle rules in [`infra/terraform/r2.tf`](../terraform/r2.tf): `daily/` 30 days, `monthly/` 365 days.

## Run the restore test locally
Needs only Docker:

```bash
bash infra/backup/test-round-trip.sh
```
