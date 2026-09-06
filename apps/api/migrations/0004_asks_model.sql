-- 0004_asks_model.sql — the audit row names the model that answered.
--
-- Why it exists: `asks.adapter` says which adapter was configured (`none`, `ollama`, `anthropic`), not
-- which model the service actually ran — an operator can point either adapter at any model id, and the
-- adapter already reports the id it was answered by (`LlmCompletion.model`). A reviewer reading the audit
-- log asks "which model said this", so the row now records it. Nullable: no model is asked when the
-- catalog read fails first, and rows written before this migration have no value to give.
--
-- Grants are unchanged: `vantage_app` holds table-level INSERT and `vantage_reader` table-level SELECT
-- on `asks`, both of which cover a new column.
--
-- What it must never do: be edited after it has been applied anywhere (the runner checksums it).

ALTER TABLE asks ADD COLUMN model text;   -- the model id the adapter reported; null when no model was asked
