-- Add full-text search vector column and GIN index to contacts table
ALTER TABLE contacts
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(first_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(last_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(title, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'C')
) STORED;

CREATE INDEX idx_contacts_search_vector ON contacts USING GIN (search_vector);
