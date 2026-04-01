SECURITY LABEL FOR anon ON COLUMN "patients"."email"
  IS 'MASKED WITH FUNCTION anon.partial(email, 2, $$***$$, 2)';

SECURITY LABEL FOR anon ON COLUMN "patients"."last_name"
  IS 'MASKED WITH FUNCTION anon.fake_last_name()';
