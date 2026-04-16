CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `name` varchar(100) CHARSET utf8mb4 NULL COMMENT 'Category display name' COLLATE utf8mb4_0900_ai_ci ,
  `description` text CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  PRIMARY KEY (`id` ),
  CONSTRAINT `categories_name_not_empty` CHECK (length(trim(`name`)) > 0) 
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Pet categories lookup table';

CREATE TABLE `pets` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `category_id` int NULL ,
  `name` varchar(100) CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `sku` varchar(20) CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `price` decimal(10,2) NOT NULL DEFAULT 0.00 ,
  `internal_notes` text CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  `status` varchar(20) CHARSET utf8mb4 NOT NULL DEFAULT '"available"' COLLATE utf8mb4_0900_ai_ci ,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ,
  PRIMARY KEY (`id` ),
  INDEX `category_id` (`category_id` ),
  UNIQUE INDEX `sku` (`sku` ),
  CONSTRAINT `pets_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION ,
  CONSTRAINT `pets_name_not_empty` CHECK (length(trim(`name`)) > 0) ,
  CONSTRAINT `pets_price_range` CHECK ((`price` >= 0) and (`price` <= 99999)) ,
  CONSTRAINT `pets_sku_pattern` CHECK (regexp_like(`sku`,_utf8mb4'^[A-Z]{3}-[0-9]{4}$')) 
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Core pet inventory table';

CREATE TABLE `owners` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `name` varchar(150) CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `email` varchar(255) CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `phone` varchar(20) CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ,
  PRIMARY KEY (`id` ),
  UNIQUE INDEX `email` (`email` ),
  CONSTRAINT `owners_email_pattern` CHECK (regexp_like(`email`,_utf8mb4'^[^@]+@[^@]+\\.[^@]+$')) ,
  CONSTRAINT `owners_name_not_empty` CHECK (length(trim(`name`)) > 0) ,
  CONSTRAINT `owners_phone_length` CHECK ((length(`phone`) >= 7) and (length(`phone`) <= 20)) 
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Pet owners and customers';

CREATE TABLE `adoptions` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `pet_id` int NOT NULL ,
  `owner_id` int NOT NULL ,
  `adopted_at` timestamp NULL COMMENT 'Timestamp when the adoption was finalized' ,
  `adoption_fee` decimal(10,2) NOT NULL DEFAULT 0.00 ,
  `updated_by` text CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  PRIMARY KEY (`id` ),
  INDEX `owner_id` (`owner_id` ),
  INDEX `pet_id` (`pet_id` ),
  CONSTRAINT `adoptions_ibfk_1` FOREIGN KEY (`pet_id`) REFERENCES `pets` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION ,
  CONSTRAINT `adoptions_ibfk_2` FOREIGN KEY (`owner_id`) REFERENCES `owners` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION 
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Adoption records linking pets to owners';

CREATE TRIGGER `adoptions_audit_after_delete` AFTER DELETE ON `adoptions` FOR EACH ROW BEGIN
  INSERT INTO `adoptions_audit_log` (table_name, operation, old_data, new_data, changed_at)
  VALUES ('adoptions', 'DELETE', JSON_OBJECT('id', OLD.`id`, 'pet_id', OLD.`pet_id`, 'owner_id', OLD.`owner_id`, 'adopted_at', OLD.`adopted_at`, 'adoption_fee', OLD.`adoption_fee`), NULL, NOW());
END;

CREATE TRIGGER `adoptions_audit_after_insert` AFTER INSERT ON `adoptions` FOR EACH ROW BEGIN
  INSERT INTO `adoptions_audit_log` (table_name, operation, old_data, new_data, changed_at)
  VALUES ('adoptions', 'INSERT', NULL, JSON_OBJECT('id', NEW.`id`, 'pet_id', NEW.`pet_id`, 'owner_id', NEW.`owner_id`, 'adopted_at', NEW.`adopted_at`, 'adoption_fee', NEW.`adoption_fee`), NOW());
END;

CREATE TRIGGER `adoptions_audit_after_update` AFTER UPDATE ON `adoptions` FOR EACH ROW BEGIN
  INSERT INTO `adoptions_audit_log` (table_name, operation, old_data, new_data, changed_at)
  VALUES ('adoptions', 'UPDATE', JSON_OBJECT('id', OLD.`id`, 'pet_id', OLD.`pet_id`, 'owner_id', OLD.`owner_id`, 'adopted_at', OLD.`adopted_at`, 'adoption_fee', OLD.`adoption_fee`), JSON_OBJECT('id', NEW.`id`, 'pet_id', NEW.`pet_id`, 'owner_id', NEW.`owner_id`, 'adopted_at', NEW.`adopted_at`, 'adoption_fee', NEW.`adoption_fee`), NOW());
END;

CREATE TABLE `staff` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `name` varchar(150) CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `role` varchar(50) CHARSET utf8mb4 NOT NULL DEFAULT '"associate"' COLLATE utf8mb4_0900_ai_ci ,
  `hired_at` date NOT NULL DEFAULT (curdate()) ,
  PRIMARY KEY (`id` )
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Internal staff members';

CREATE TRIGGER `staff_audit_after_delete` AFTER DELETE ON `staff` FOR EACH ROW BEGIN
  INSERT INTO `staff_audit_log` (table_name, operation, old_data, new_data, changed_at)
  VALUES ('staff', 'DELETE', JSON_OBJECT('id', OLD.`id`, 'name', OLD.`name`, 'role', OLD.`role`, 'hired_at', OLD.`hired_at`), NULL, NOW());
END;

CREATE TRIGGER `staff_audit_after_insert` AFTER INSERT ON `staff` FOR EACH ROW BEGIN
  INSERT INTO `staff_audit_log` (table_name, operation, old_data, new_data, changed_at)
  VALUES ('staff', 'INSERT', NULL, JSON_OBJECT('id', NEW.`id`, 'name', NEW.`name`, 'role', NEW.`role`, 'hired_at', NEW.`hired_at`), NOW());
END;

CREATE TRIGGER `staff_audit_after_update` AFTER UPDATE ON `staff` FOR EACH ROW BEGIN
  INSERT INTO `staff_audit_log` (table_name, operation, old_data, new_data, changed_at)
  VALUES ('staff', 'UPDATE', JSON_OBJECT('id', OLD.`id`, 'name', OLD.`name`, 'role', OLD.`role`, 'hired_at', OLD.`hired_at`), JSON_OBJECT('id', NEW.`id`, 'name', NEW.`name`, 'role', NEW.`role`, 'hired_at', NEW.`hired_at`), NOW());
END;

CREATE TABLE `adoptions_audit_log` (
  `id` bigint NOT NULL AUTO_INCREMENT ,
  `table_name` text CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `operation` text CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `old_data` json NULL ,
  `new_data` json NULL ,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ,
  PRIMARY KEY (`id` )
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE `legacy_inventory` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `item_name` varchar(200) CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  `old_sku` varchar(50) CHARSET utf8mb4 NULL COMMENT 'DEPRECATED: scheduled for removal after 2025-12-01' COLLATE utf8mb4_0900_ai_ci ,
  `quantity` int NULL DEFAULT 0 ,
  PRIMARY KEY (`id` )
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'DEPRECATED: use pets instead';

CREATE TABLE `medical_records` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `pet_id` int NOT NULL ,
  `visit_date` date NOT NULL DEFAULT (curdate()) ,
  `diagnosis` text CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `treatment` text CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  `vet_name` varchar(150) CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  PRIMARY KEY (`id` ),
  INDEX `pet_id` (`pet_id` ),
  CONSTRAINT `medical_records_ibfk_1` FOREIGN KEY (`pet_id`) REFERENCES `pets` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION 
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Veterinary medical records for pets';

CREATE TABLE `reviews` (
  `id` int NOT NULL AUTO_INCREMENT ,
  `pet_id` int NOT NULL ,
  `owner_id` int NOT NULL ,
  `rating` int NOT NULL ,
  `body` text CHARSET utf8mb4 NULL COLLATE utf8mb4_0900_ai_ci ,
  `location_id` int NULL ,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ,
  PRIMARY KEY (`id` ),
  INDEX `location_id` (`location_id` ),
  INDEX `owner_id` (`owner_id` ),
  INDEX `pet_id` (`pet_id` ),
  CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`pet_id`) REFERENCES `pets` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION ,
  CONSTRAINT `reviews_ibfk_2` FOREIGN KEY (`owner_id`) REFERENCES `owners` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION ,
  CONSTRAINT `reviews_ibfk_3` FOREIGN KEY (`location_id`) REFERENCES `locations` (`id`) ON UPDATE NO ACTION ON DELETE NO ACTION ,
  CONSTRAINT `reviews_rating_range` CHECK ((`rating` >= 1) and (`rating` <= 5)) 
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci COMMENT 'Customer reviews for pets';

CREATE TABLE `staff_audit_log` (
  `id` bigint NOT NULL AUTO_INCREMENT ,
  `table_name` text CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `operation` text CHARSET utf8mb4 NOT NULL COLLATE utf8mb4_0900_ai_ci ,
  `old_data` json NULL ,
  `new_data` json NULL ,
  `changed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ,
  PRIMARY KEY (`id` )
) CHARSET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
