-- 0002_person_merges_moved_ids.sql — the merge audit row names the ids it moved; the merged person points at its survivor.
--
-- Why it exists: design §1.2 calls person_merges "auditable and reversible by hand", and a count is
-- neither — undoing a merge needs the list of distinct ids to repoint back. `persons.merged_into` makes
-- the surviving side visible from the persons table without reading the audit log; a person row is never
-- deleted (events resolve through person_distinct_ids, and the row anchors its own pointer).
--
-- What it must never do: lose information a row already carried (a recorded count keeps its
-- cardinality as placeholder entries), or be edited after it has been applied anywhere.

ALTER TABLE person_merges
  ALTER COLUMN distinct_ids_moved TYPE text[]
  USING array_fill('<id not recorded before 0002>'::text, ARRAY[distinct_ids_moved]);

ALTER TABLE persons ADD COLUMN merged_into uuid;
ALTER TABLE persons ADD CONSTRAINT persons_merged_into_fkey
  FOREIGN KEY (project_id, merged_into) REFERENCES persons (project_id, person_id);
