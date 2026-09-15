-- Issue #189: new AccountStatus value for GDPR-erased/anonymized accounts.
-- Postgres cannot use a freshly ADDed enum value inside the same transaction it was added in —
-- the backfill UPDATE lives in its own, later migration (same split pattern as
-- 20260914180000_add_collectionitem_purchase_link / ...181000_backfill_...).
ALTER TYPE "AccountStatus" ADD VALUE 'ERASED';
