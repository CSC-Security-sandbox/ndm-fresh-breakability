-- Add a new column 'time_elapsed' with type TIMESTAMP that allows NULL values
ALTER TABLE jobrun ADD COLUMN IF NOT EXISTS time_elapsed TIMESTAMP NULL;