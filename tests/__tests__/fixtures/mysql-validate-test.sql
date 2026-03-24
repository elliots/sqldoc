-- @import '@sqldoc/ns-validate'

CREATE TABLE items (
  -- @validate.notEmpty
  title VARCHAR(255) NOT NULL,
  -- @validate.range(min: 0, max: 10000)
  quantity INT NOT NULL,
  -- @validate.length(min: 3, max: 100)
  description TEXT,
  -- @validate.pattern('[A-Z]{3}-[0-9]+')
  sku VARCHAR(50)
);
