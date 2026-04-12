-- External table: pre-existing "locations" service schema
-- This table is NOT managed by sqldoc migrations — it already exists in the DB.

CREATE TABLE locations (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  address NVARCHAR(MAX) NOT NULL,
  city NVARCHAR(100) NOT NULL,
  zip NVARCHAR(20)
);
