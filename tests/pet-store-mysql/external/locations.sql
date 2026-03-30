-- External table: pre-existing "locations" service schema
-- This table is NOT managed by sqldoc migrations — it already exists in the DB.

CREATE TABLE locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  zip VARCHAR(20)
);
