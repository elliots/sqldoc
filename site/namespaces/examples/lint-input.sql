-- @lint.ignore('audit.require-audit')
CREATE TABLE temp_imports (
  id SERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  imported_at TIMESTAMP DEFAULT now()
);
