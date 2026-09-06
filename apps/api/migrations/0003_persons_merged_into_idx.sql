-- 0003_persons_merged_into_idx.sql — an index on the merge pointer added by 0002.
--
-- Why it exists: `persons.merged_into` carries a foreign key back to `persons` and PostgreSQL does not
-- index the referencing side of a foreign key by itself, so every check of that constraint against a
-- referenced row and every "which persons were merged into this one" lookup (the identity audit;
-- reversing a merge by hand, design §1.2) scans the whole table. The index is partial: the pointer is
-- null for every person that was never merged — nearly all of them — so it stays a few pages however
-- large `persons` grows, and `merged_into = $2` implies the predicate, so the planner can use it.
--
-- What it must never do: be edited after it has been applied anywhere (the runner checksums it).

CREATE INDEX persons_merged_into_idx ON persons (project_id, merged_into) WHERE merged_into IS NOT NULL;
