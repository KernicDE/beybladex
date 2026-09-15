-- Issue #189: backfill status='ERASED' on rows already anonymized by earlier erasures (the
-- `geloescht_*` username prefix is the established tombstone convention, see
-- lib/accountErasure.ts) — from here on, new erasures set the status column directly.
UPDATE "User" SET status = 'ERASED' WHERE username LIKE 'geloescht\_%';
