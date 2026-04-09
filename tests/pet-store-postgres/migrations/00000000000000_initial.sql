CREATE TABLE "public"."staff" ("id" serial NOT NULL, "name" character varying(150) NOT NULL, "role" character varying(50) NOT NULL DEFAULT 'associate', "hired_at" date NOT NULL DEFAULT CURRENT_DATE, PRIMARY KEY ("id"));
COMMENT ON TABLE "public"."staff" IS 'Internal staff members
@omit';
CREATE TABLE "public"."owners" ("id" serial NOT NULL, "name" character varying(150) NOT NULL, "email" character varying(255) NOT NULL, "phone" character varying(20) NULL, "created_at" timestamp NULL DEFAULT now(), PRIMARY KEY ("id"), CONSTRAINT "owners_email_key" UNIQUE ("email"));
COMMENT ON TABLE "public"."owners" IS 'Pet owners and customers
@name Customer';
CREATE TABLE "public"."categories" ("id" serial NOT NULL, "name" character varying(100) NOT NULL, "description" text NULL, PRIMARY KEY ("id"));
COMMENT ON TABLE "public"."categories" IS 'Pet categories lookup table
@simpleCollections only';
COMMENT ON COLUMN "public"."categories"."name" IS 'Category display name';
CREATE TABLE "public"."pets" ("id" serial NOT NULL, "category_id" integer NULL, "name" character varying(100) NOT NULL, "sku" character varying(20) NOT NULL, "price" numeric(10,2) NOT NULL DEFAULT 0, "internal_notes" text NULL, "status" character varying(20) NOT NULL DEFAULT 'available', "created_at" timestamp NULL DEFAULT now(), PRIMARY KEY ("id"), CONSTRAINT "pets_sku_key" UNIQUE ("sku"), CONSTRAINT "pets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION);
COMMENT ON TABLE "public"."pets" IS 'Core pet inventory table';
CREATE POLICY "pets_public_select" ON "public"."pets" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE TABLE "public"."staff_audit_log" ("id" bigserial NOT NULL, "table_name" text NOT NULL, "operation" text NOT NULL, "old_data" jsonb NULL, "new_data" jsonb NULL, "changed_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("id"));
CREATE OR REPLACE FUNCTION public.staff_audit_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO "staff_audit_log" (table_name, operation, old_data, new_data, changed_at)
  VALUES (TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END, now());
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$
;
CREATE TABLE "public"."adoptions_audit_log" ("id" bigserial NOT NULL, "table_name" text NOT NULL, "operation" text NOT NULL, "old_data" jsonb NULL, "new_data" jsonb NULL, "changed_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("id"));
CREATE OR REPLACE FUNCTION public.adoptions_audit_fn()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO "adoptions_audit_log" (table_name, operation, old_data, new_data, changed_at)
  VALUES (TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE row_to_json(OLD) END, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW) END, now());
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$
;
CREATE TABLE "public"."adoptions" ("id" serial NOT NULL, "pet_id" integer NOT NULL, "owner_id" integer NOT NULL, "adopted_at" timestamp NOT NULL DEFAULT now(), "adoption_fee" numeric(10,2) NOT NULL DEFAULT 0, PRIMARY KEY ("id"), CONSTRAINT "adoptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."owners" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION, CONSTRAINT "adoptions_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "public"."pets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION);
COMMENT ON TABLE "public"."adoptions" IS 'Adoption records linking pets to owners';
COMMENT ON COLUMN "public"."adoptions"."adopted_at" IS 'Timestamp when the adoption was finalized';
CREATE TRIGGER adoptions_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.adoptions FOR EACH ROW EXECUTE FUNCTION adoptions_audit_fn();
CREATE TABLE "public"."legacy_inventory" ("id" serial NOT NULL, "item_name" character varying(200) NULL, "old_sku" character varying(50) NULL, "quantity" integer NULL DEFAULT 0, PRIMARY KEY ("id"));
COMMENT ON TABLE "public"."legacy_inventory" IS 'DEPRECATED: use pets instead';
COMMENT ON COLUMN "public"."legacy_inventory"."old_sku" IS 'DEPRECATED: scheduled for removal after 2025-12-01';
CREATE POLICY "owners_public_all" ON "public"."owners" AS PERMISSIVE FOR ALL TO public USING (true);
CREATE TRIGGER staff_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION staff_audit_fn();
CREATE TABLE "public"."medical_records" ("id" serial NOT NULL, "pet_id" integer NOT NULL, "visit_date" date NOT NULL DEFAULT CURRENT_DATE, "diagnosis" text NOT NULL, "treatment" text NULL, "vet_name" character varying(150) NULL, PRIMARY KEY ("id"), CONSTRAINT "medical_records_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "public"."pets" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION);
COMMENT ON TABLE "public"."medical_records" IS 'Veterinary medical records for pets';
CREATE POLICY "medical_records_public_select" ON "public"."medical_records" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE TABLE "public"."reviews" ("id" serial NOT NULL, "pet_id" integer NOT NULL, "owner_id" integer NOT NULL, "rating" integer NOT NULL, "body" text NULL, "location_id" integer NULL, "created_at" timestamp NULL DEFAULT now(), PRIMARY KEY ("id"), CONSTRAINT "reviews_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION);
COMMENT ON TABLE "public"."reviews" IS 'Customer reviews for pets';
CREATE TYPE "adoption_report" AS ( "pet_name" character varying(100), "owner_name" character varying(150), "adopted_at" timestamp, "adoption_fee" numeric(10,2), "category_name" character varying(100) );

CREATE OR REPLACE FUNCTION public.get_adoption_report(p_owner_id integer DEFAULT NULL::integer)
 RETURNS SETOF public.adoption_report
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p.name, o.name, a.adopted_at, a.adoption_fee, c.name
  FROM adoptions a
  JOIN pets p ON p.id = a.pet_id
  JOIN owners o ON o.id = a.owner_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p_owner_id IS NULL OR o.id = p_owner_id;
$function$
;
