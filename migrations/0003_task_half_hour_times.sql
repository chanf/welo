-- Existing date-only task schedules become midnight boundaries after the
-- half-hour scheduling change. Both columns are converted together so the
-- start <= end check sees the same textual format during the update.
UPDATE tasks
SET start_date = CASE
      WHEN start_date IS NOT NULL AND length(start_date) = 10
        THEN start_date || 'T00:00'
      ELSE start_date
    END,
    end_date = CASE
      WHEN length(end_date) = 10 THEN end_date || 'T00:00'
      ELSE end_date
    END;
