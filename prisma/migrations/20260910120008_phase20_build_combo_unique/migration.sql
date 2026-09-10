-- Phase 20 — Canonical Build Naming & Duplicate-Combo Prevention. Additive: unique index on
-- (bladeId, ratchetId, bitId) so the same three parts can never back two Build rows. Every
-- creation path (POST /api/builds, POST /api/admin/builds, CatalogProposal BUILD approval)
-- pre-checks the combo and returns the existing Build's id gracefully instead of ever relying
-- on this index's raw violation. Existing seed/dev data has no duplicate combos, so the index
-- builds cleanly.

-- CreateIndex
CREATE UNIQUE INDEX "Build_bladeId_ratchetId_bitId_key" ON "Build"("bladeId", "ratchetId", "bitId");
