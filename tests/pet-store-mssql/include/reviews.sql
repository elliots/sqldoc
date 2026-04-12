-- Included table: part of the pet store project, managed by migrations.
-- Also references the same external locations table (tests deduplication).

-- @external '../external/locations.sql'

-- @import '@sqldoc/ns-validate'
-- @import '@sqldoc/ns-comment'

-- @comment('Customer reviews for pets')
CREATE TABLE reviews (
  id INT IDENTITY(1,1) PRIMARY KEY,
  pet_id INT NOT NULL,
  owner_id INT NOT NULL,
  -- @validate.range(min: 1, max: 5)
  rating INT NOT NULL,
  body NVARCHAR(MAX),
  location_id INT,
  created_at DATETIME2 DEFAULT GETDATE(),
  FOREIGN KEY (pet_id) REFERENCES pets(id),
  FOREIGN KEY (owner_id) REFERENCES owners(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);
