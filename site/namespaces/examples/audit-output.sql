CREATE TABLE IF NOT EXISTS "orders_audit_log" (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION "orders_audit_fn"() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "orders_audit_log" (table_name, operation, old_data, new_data, changed_at)
  VALUES (TG_TABLE_NAME, TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END,
    now());
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_audit_trigger"
  AFTER INSERT OR UPDATE OR DELETE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION "orders_audit_fn"();
