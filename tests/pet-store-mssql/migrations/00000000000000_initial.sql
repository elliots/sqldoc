CREATE TABLE [owners] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(150) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [email] nvarchar(255) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [phone] nvarchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [created_at] datetime2(7) NULL DEFAULT getdate(),
  CONSTRAINT [PK__owners__3213E83F9613B356] PRIMARY KEY ([id]),
  CONSTRAINT [owners_name_not_empty] CHECK (len(ltrim(rtrim([name])))>(0)),
  CONSTRAINT [owners_phone_length] CHECK (len([phone])>=(7) AND len([phone])<=(20))
);

CREATE UNIQUE NONCLUSTERED INDEX [UQ__owners__AB6E61648E2D077C] ON [owners] ([email]);

CREATE PROCEDURE get_adoption_report
  @p_owner_id INT = NULL
AS
BEGIN
  SET NOCOUNT ON
  SELECT
    p.name AS pet_name,
    o.name AS owner_name,
    a.adopted_at,
    a.adoption_fee,
    c.name AS category_name
  FROM adoptions a
  JOIN pets p ON p.id = a.pet_id
  JOIN owners o ON o.id = a.owner_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE @p_owner_id IS NULL OR o.id = @p_owner_id
END;;

CREATE TABLE [categories] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [description] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  CONSTRAINT [PK__categori__3213E83F491F204B] PRIMARY KEY ([id]),
  CONSTRAINT [categories_name_not_empty] CHECK (len(ltrim(rtrim([name])))>(0))
);

CREATE TABLE [pets] (
  [id] int IDENTITY(1,1) NOT NULL,
  [category_id] int NULL,
  [name] nvarchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [sku] nvarchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [price] decimal(10,2) NOT NULL DEFAULT 0,
  [internal_notes] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [status] nvarchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL DEFAULT 'available',
  [created_at] datetime2(7) NULL DEFAULT getdate(),
  CONSTRAINT [PK__pets__3213E83F57469919] PRIMARY KEY ([id]),
  CONSTRAINT [FK__pets__category_i__6403B6FE] FOREIGN KEY ([category_id]) REFERENCES [dbo] .[categories] ([id]),
  CONSTRAINT [pets_name_not_empty] CHECK (len(ltrim(rtrim([name])))>(0)),
  CONSTRAINT [pets_price_range] CHECK ([price]>=(0) AND [price]<=(99999))
);

CREATE UNIQUE NONCLUSTERED INDEX [UQ__pets__DDDF4BE7EBFB2F32] ON [pets] ([sku]);

CREATE TABLE [adoptions] (
  [id] int IDENTITY(1,1) NOT NULL,
  [pet_id] int NOT NULL,
  [owner_id] int NOT NULL,
  [adopted_at] datetime2(7) NOT NULL DEFAULT getdate(),
  [adoption_fee] decimal(10,2) NOT NULL DEFAULT 0,
  [updated_by] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  CONSTRAINT [PK__adoption__3213E83F367B8E2D] PRIMARY KEY ([id]),
  CONSTRAINT [FK__adoptions__owner__6D8D2138] FOREIGN KEY ([owner_id]) REFERENCES [dbo] .[owners] ([id]),
  CONSTRAINT [FK__adoptions__pet_i__6C98FCFF] FOREIGN KEY ([pet_id]) REFERENCES [dbo] .[pets] ([id])
);

CREATE TABLE [adoptions_audit_log] (
  [id] bigint IDENTITY(1,1) NOT NULL,
  [table_name] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [operation] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [old_data] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [new_data] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [changed_at] datetime2(7) NOT NULL DEFAULT getdate(),
  CONSTRAINT [PK__adoption__3213E83F08CAAF20] PRIMARY KEY ([id])
);

CREATE TABLE [legacy_inventory] (
  [id] int IDENTITY(1,1) NOT NULL,
  [item_name] nvarchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [old_sku] nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [quantity] int NULL DEFAULT 0,
  CONSTRAINT [PK__legacy_i__3213E83F8001E3C2] PRIMARY KEY ([id])
);

CREATE TABLE [medical_records] (
  [id] int IDENTITY(1,1) NOT NULL,
  [pet_id] int NOT NULL,
  [visit_date] date NOT NULL DEFAULT CONVERT([date],getdate()),
  [diagnosis] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [treatment] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [vet_name] nvarchar(150) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  CONSTRAINT [PK__medical___3213E83FC9D716C3] PRIMARY KEY ([id]),
  CONSTRAINT [FK__medical_r__pet_i__715DB21C] FOREIGN KEY ([pet_id]) REFERENCES [dbo] .[pets] ([id])
);

CREATE TABLE [reviews] (
  [id] int IDENTITY(1,1) NOT NULL,
  [pet_id] int NOT NULL,
  [owner_id] int NOT NULL,
  [rating] int NOT NULL,
  [body] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [location_id] int NULL,
  [created_at] datetime2(7) NULL DEFAULT getdate(),
  CONSTRAINT [PK__reviews__3213E83F4B8E9187] PRIMARY KEY ([id]),
  CONSTRAINT [FK__reviews__locatio__7EB7AD3A] FOREIGN KEY ([location_id]) REFERENCES [dbo] .[locations] ([id]),
  CONSTRAINT [FK__reviews__owner_i__7DC38901] FOREIGN KEY ([owner_id]) REFERENCES [dbo] .[owners] ([id]),
  CONSTRAINT [FK__reviews__pet_id__7CCF64C8] FOREIGN KEY ([pet_id]) REFERENCES [dbo] .[pets] ([id])
);

CREATE TABLE [staff] (
  [id] int IDENTITY(1,1) NOT NULL,
  [name] nvarchar(150) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [role] nvarchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL DEFAULT 'associate',
  [hired_at] date NOT NULL DEFAULT CONVERT([date],getdate()),
  CONSTRAINT [PK__staff__3213E83F90A1B382] PRIMARY KEY ([id])
);

CREATE TABLE [staff_audit_log] (
  [id] bigint IDENTITY(1,1) NOT NULL,
  [table_name] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [operation] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  [old_data] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [new_data] nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
  [changed_at] datetime2(7) NOT NULL DEFAULT getdate(),
  CONSTRAINT [PK__staff_au__3213E83F812CE5DE] PRIMARY KEY ([id])
);

CREATE TRIGGER [adoptions_audit_after_delete]
ON [adoptions]
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [adoptions_audit_log] (table_name, operation, old_data, new_data, changed_at)
  VALUES ('adoptions', 'DELETE', (SELECT * FROM deleted FOR JSON PATH), NULL, SYSUTCDATETIME());
END;;

CREATE TRIGGER [adoptions_audit_after_insert]
ON [adoptions]
AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [adoptions_audit_log] (table_name, operation, old_data, new_data, changed_at)
  VALUES ('adoptions', 'INSERT', NULL, (SELECT * FROM inserted FOR JSON PATH), SYSUTCDATETIME());
END;;

CREATE TRIGGER [adoptions_audit_after_update]
ON [adoptions]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [adoptions_audit_log] (table_name, operation, old_data, new_data, changed_at)
  VALUES ('adoptions', 'UPDATE', (SELECT * FROM deleted FOR JSON PATH), (SELECT * FROM inserted FOR JSON PATH), SYSUTCDATETIME());
END;;

ALTER TABLE [reviews] ADD CONSTRAINT [reviews_rating_range] CHECK ([rating]>=(1) AND [rating]<=(5));

CREATE TRIGGER [staff_audit_after_delete]
ON [staff]
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [staff_audit_log] (table_name, operation, old_data, new_data, changed_at)
  VALUES ('staff', 'DELETE', (SELECT * FROM deleted FOR JSON PATH), NULL, SYSUTCDATETIME());
END;;

CREATE TRIGGER [staff_audit_after_insert]
ON [staff]
AFTER INSERT
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [staff_audit_log] (table_name, operation, old_data, new_data, changed_at)
  VALUES ('staff', 'INSERT', NULL, (SELECT * FROM inserted FOR JSON PATH), SYSUTCDATETIME());
END;;

CREATE TRIGGER [staff_audit_after_update]
ON [staff]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [staff_audit_log] (table_name, operation, old_data, new_data, changed_at)
  VALUES ('staff', 'UPDATE', (SELECT * FROM deleted FOR JSON PATH), (SELECT * FROM inserted FOR JSON PATH), SYSUTCDATETIME());
END;;
