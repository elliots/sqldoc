ALTER TABLE "products"
  ADD CONSTRAINT "products_name_not_empty" CHECK (length(trim("name")) > 0);

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_range" CHECK ("price" >= 0 AND "price" <= 99999);

ALTER TABLE "products"
  ADD CONSTRAINT "products_sku_pattern" CHECK ("sku" ~ '^[A-Z]{3}-[0-9]{4}$');

ALTER TABLE "products"
  ADD CONSTRAINT "products_description_length" CHECK (length("description") >= 10 AND length("description") <= 500);
