-- Sakila schema (MSSQL dialect)
-- Classic DVD rental database for round-trip testing

-- @import '@sqldoc/ns-comment'
-- @import '@sqldoc/ns-docs'
-- @import '@sqldoc/ns-validate'
-- @import '@sqldoc/ns-codegen'

-- ============================================================
-- 1. Independent tables (no foreign key dependencies)
-- ============================================================

-- @comment('Actors who appear in films')
-- @docs.description('People who perform in films carried by the store')
CREATE TABLE actor (
  actor_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  first_name NVARCHAR(45) NOT NULL,
  -- @validate.notEmpty
  last_name NVARCHAR(45) NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE()
);

CREATE NONCLUSTERED INDEX IX_actor_last_name ON actor (last_name);

-- @comment('Languages available for films')
-- @docs.description('Lookup table of languages that films can be presented in')
CREATE TABLE language (
  language_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  name NVARCHAR(20) NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- @comment('Film genre categories')
-- @docs.description('Classification categories for organizing the film collection')
CREATE TABLE category (
  category_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  name NVARCHAR(25) NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- @comment('Countries where cities are located')
CREATE TABLE country (
  country_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  country NVARCHAR(50) NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- ============================================================
-- 2. city (depends on country)
-- ============================================================

-- @comment('Cities within countries')
CREATE TABLE city (
  city_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  city NVARCHAR(50) NOT NULL,
  country_id INT NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_city_country FOREIGN KEY (country_id) REFERENCES country (country_id)
);

CREATE NONCLUSTERED INDEX IX_city_country_id ON city (country_id);

-- ============================================================
-- 3. address (depends on city)
-- ============================================================

-- @comment('Street addresses for staff, customers, and stores')
-- @docs.description('Physical mailing addresses linked to cities')
CREATE TABLE address (
  address_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  address NVARCHAR(50) NOT NULL,
  address2 NVARCHAR(50),
  district NVARCHAR(20) NOT NULL,
  city_id INT NOT NULL,
  postal_code NVARCHAR(10),
  phone NVARCHAR(20) NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_address_city FOREIGN KEY (city_id) REFERENCES city (city_id)
);

CREATE NONCLUSTERED INDEX IX_address_city_id ON address (city_id);

-- ============================================================
-- 4. store and staff (circular dependency handled via ALTER TABLE)
-- ============================================================

-- @comment('Retail store locations')
-- @docs.description('Physical store locations that hold inventory and employ staff')
CREATE TABLE store (
  store_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  manager_staff_id INT NOT NULL,
  address_id INT NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_store_address FOREIGN KEY (address_id) REFERENCES address (address_id)
);

CREATE NONCLUSTERED INDEX IX_store_address_id ON store (address_id);

-- @comment('Employees who work at stores')
-- @docs.description('Staff members who handle rentals and payments at store locations')
CREATE TABLE staff (
  staff_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  first_name NVARCHAR(45) NOT NULL,
  -- @validate.notEmpty
  last_name NVARCHAR(45) NOT NULL,
  address_id INT NOT NULL,
  email NVARCHAR(50),
  store_id INT NOT NULL,
  active BIT NOT NULL DEFAULT 1,
  username NVARCHAR(16) NOT NULL,
  password NVARCHAR(40),
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_staff_address FOREIGN KEY (address_id) REFERENCES address (address_id),
  CONSTRAINT FK_staff_store FOREIGN KEY (store_id) REFERENCES store (store_id)
);

CREATE NONCLUSTERED INDEX IX_staff_address_id ON staff (address_id);
CREATE NONCLUSTERED INDEX IX_staff_store_id ON staff (store_id);

-- Add the manager FK now that staff exists
ALTER TABLE store
  ADD CONSTRAINT FK_store_manager_staff FOREIGN KEY (manager_staff_id) REFERENCES staff (staff_id);

CREATE NONCLUSTERED INDEX IX_store_manager_staff_id ON store (manager_staff_id);

-- ============================================================
-- 5. customer (depends on store, address)
-- ============================================================

-- @comment('Registered customers of the rental stores')
-- @docs.description('Individuals who rent films from store locations')
CREATE TABLE customer (
  customer_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  store_id INT NOT NULL,
  -- @validate.notEmpty
  first_name NVARCHAR(45) NOT NULL,
  -- @validate.notEmpty
  last_name NVARCHAR(45) NOT NULL,
  email NVARCHAR(50),
  address_id INT NOT NULL,
  active BIT NOT NULL DEFAULT 1,
  create_date DATETIME2 NOT NULL DEFAULT GETDATE(),
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_customer_store FOREIGN KEY (store_id) REFERENCES store (store_id),
  CONSTRAINT FK_customer_address FOREIGN KEY (address_id) REFERENCES address (address_id)
);

CREATE NONCLUSTERED INDEX IX_customer_store_id ON customer (store_id);
CREATE NONCLUSTERED INDEX IX_customer_address_id ON customer (address_id);
CREATE NONCLUSTERED INDEX IX_customer_last_name ON customer (last_name);

-- ============================================================
-- 6. film (depends on language)
-- ============================================================

-- @comment('Films available for rental')
-- @docs.description('Complete catalog of films carried across all store locations')
CREATE TABLE film (
  film_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  -- @validate.notEmpty
  title NVARCHAR(255) NOT NULL,
  description NVARCHAR(MAX),
  release_year SMALLINT,
  language_id INT NOT NULL,
  original_language_id INT,
  rental_duration TINYINT NOT NULL DEFAULT 3,
  -- @validate.range(min: 0, max: 99999)
  rental_rate DECIMAL(5,2) NOT NULL DEFAULT 4.99,
  length SMALLINT,
  -- @validate.range(min: 0, max: 99999)
  replacement_cost DECIMAL(5,2) NOT NULL DEFAULT 19.99,
  rating NVARCHAR(5) DEFAULT 'G',
  special_features NVARCHAR(255),
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_film_language FOREIGN KEY (language_id) REFERENCES language (language_id),
  CONSTRAINT FK_film_original_language FOREIGN KEY (original_language_id) REFERENCES language (language_id),
  CONSTRAINT CK_film_rating CHECK (rating IN ('G','PG','PG-13','R','NC-17'))
);

CREATE NONCLUSTERED INDEX IX_film_language_id ON film (language_id);
CREATE NONCLUSTERED INDEX IX_film_original_language_id ON film (original_language_id);
CREATE NONCLUSTERED INDEX IX_film_title ON film (title);

-- ============================================================
-- 7. film_actor (depends on film, actor)
-- ============================================================

-- @comment('Junction table linking films to their cast members')
CREATE TABLE film_actor (
  actor_id INT NOT NULL,
  film_id INT NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT PK_film_actor PRIMARY KEY (actor_id, film_id),
  CONSTRAINT FK_film_actor_actor FOREIGN KEY (actor_id) REFERENCES actor (actor_id),
  CONSTRAINT FK_film_actor_film FOREIGN KEY (film_id) REFERENCES film (film_id)
);

CREATE NONCLUSTERED INDEX IX_film_actor_film_id ON film_actor (film_id);

-- ============================================================
-- 8. film_category (depends on film, category)
-- ============================================================

-- @comment('Junction table linking films to their genre categories')
CREATE TABLE film_category (
  film_id INT NOT NULL,
  category_id INT NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT PK_film_category PRIMARY KEY (film_id, category_id),
  CONSTRAINT FK_film_category_film FOREIGN KEY (film_id) REFERENCES film (film_id),
  CONSTRAINT FK_film_category_category FOREIGN KEY (category_id) REFERENCES category (category_id)
);

CREATE NONCLUSTERED INDEX IX_film_category_category_id ON film_category (category_id);

-- ============================================================
-- 9. inventory (depends on film, store)
-- ============================================================

-- @comment('Physical film copies held in store inventory')
-- @docs.description('Tracks individual copies of films available at each store')
CREATE TABLE inventory (
  inventory_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  film_id INT NOT NULL,
  store_id INT NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_inventory_film FOREIGN KEY (film_id) REFERENCES film (film_id),
  CONSTRAINT FK_inventory_store FOREIGN KEY (store_id) REFERENCES store (store_id)
);

CREATE NONCLUSTERED INDEX IX_inventory_film_id ON inventory (film_id);
CREATE NONCLUSTERED INDEX IX_inventory_store_id ON inventory (store_id);

-- ============================================================
-- 10. rental (depends on inventory, customer, staff)
-- ============================================================

-- @comment('Individual film rental transactions')
-- @docs.description('Records each rental event with checkout and return timestamps')
CREATE TABLE rental (
  rental_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  rental_date DATETIME2 NOT NULL DEFAULT GETDATE(),
  inventory_id INT NOT NULL,
  customer_id INT NOT NULL,
  return_date DATETIME2,
  staff_id INT NOT NULL,
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_rental_inventory FOREIGN KEY (inventory_id) REFERENCES inventory (inventory_id),
  CONSTRAINT FK_rental_customer FOREIGN KEY (customer_id) REFERENCES customer (customer_id),
  CONSTRAINT FK_rental_staff FOREIGN KEY (staff_id) REFERENCES staff (staff_id)
);

CREATE NONCLUSTERED INDEX IX_rental_inventory_id ON rental (inventory_id);
CREATE NONCLUSTERED INDEX IX_rental_customer_id ON rental (customer_id);
CREATE NONCLUSTERED INDEX IX_rental_staff_id ON rental (staff_id);
CREATE NONCLUSTERED INDEX IX_rental_rental_date ON rental (rental_date);

-- ============================================================
-- 11. payment (depends on customer, staff, rental)
-- ============================================================

-- @comment('Payments received for film rentals')
-- @docs.description('Financial transactions recording amounts paid by customers for rentals')
CREATE TABLE payment (
  payment_id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  customer_id INT NOT NULL,
  staff_id INT NOT NULL,
  rental_id INT,
  -- @validate.range(min: 0, max: 99999)
  amount DECIMAL(5,2) NOT NULL,
  payment_date DATETIME2 NOT NULL DEFAULT GETDATE(),
  last_update DATETIME2 NOT NULL DEFAULT GETDATE(),
  CONSTRAINT FK_payment_customer FOREIGN KEY (customer_id) REFERENCES customer (customer_id),
  CONSTRAINT FK_payment_staff FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
  CONSTRAINT FK_payment_rental FOREIGN KEY (rental_id) REFERENCES rental (rental_id)
);

CREATE NONCLUSTERED INDEX IX_payment_customer_id ON payment (customer_id);
CREATE NONCLUSTERED INDEX IX_payment_staff_id ON payment (staff_id);
CREATE NONCLUSTERED INDEX IX_payment_rental_id ON payment (rental_id);

-- ============================================================
-- Views
-- ============================================================

-- @comment('Summary list of customers with their addresses')
CREATE VIEW customer_list AS
SELECT
  cu.customer_id AS id,
  CONCAT(cu.first_name, ' ', cu.last_name) AS name,
  a.address,
  a.postal_code AS [zip code],
  a.phone,
  ci.city,
  co.country,
  CASE WHEN cu.active = 1 THEN 'active' ELSE 'inactive' END AS notes,
  cu.store_id AS sid
FROM customer cu
JOIN address a ON cu.address_id = a.address_id
JOIN city ci ON a.city_id = ci.city_id
JOIN country co ON ci.country_id = co.country_id;

-- @comment('Films listed with their categories and actors')
CREATE VIEW film_list AS
SELECT
  f.film_id AS fid,
  f.title,
  f.description,
  c.name AS category,
  f.rental_rate AS price,
  f.length,
  f.rating,
  STRING_AGG(CONCAT(a.first_name, ' ', a.last_name), ', ') AS actors
FROM film f
LEFT JOIN film_category fc ON f.film_id = fc.film_id
LEFT JOIN category c ON fc.category_id = c.category_id
LEFT JOIN film_actor fa ON f.film_id = fa.film_id
LEFT JOIN actor a ON fa.actor_id = a.actor_id
GROUP BY f.film_id, f.title, f.description, c.name, f.rental_rate, f.length, f.rating;

-- @comment('Total sales aggregated by store location')
CREATE VIEW sales_by_store AS
SELECT
  CONCAT(ci.city, ', ', co.country) AS store,
  CONCAT(st.first_name, ' ', st.last_name) AS manager,
  SUM(p.amount) AS total_sales
FROM payment p
JOIN rental r ON p.rental_id = r.rental_id
JOIN inventory i ON r.inventory_id = i.inventory_id
JOIN store s ON i.store_id = s.store_id
JOIN address a ON s.address_id = a.address_id
JOIN city ci ON a.city_id = ci.city_id
JOIN country co ON ci.country_id = co.country_id
JOIN staff st ON s.manager_staff_id = st.staff_id
GROUP BY ci.city, co.country, st.first_name, st.last_name;
