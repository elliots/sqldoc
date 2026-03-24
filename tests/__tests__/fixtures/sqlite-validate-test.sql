-- @import '@sqldoc/ns-validate'

CREATE TABLE items (
  -- @validate.notEmpty
  title TEXT NOT NULL,
  -- @validate.range(min: 0, max: 10000)
  quantity INTEGER NOT NULL,
  -- @validate.length(min: 3, max: 100)
  description TEXT
);
