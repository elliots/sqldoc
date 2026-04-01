ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_authenticated_select" ON "documents"
  FOR SELECT
  TO authenticated
  USING (user_id = current_user_id());

CREATE POLICY "documents_admin_all" ON "documents"
  FOR ALL
  TO admin
  USING (true);
