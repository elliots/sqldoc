use bigdecimal::BigDecimal;
use chrono::NaiveDate;
use chrono::NaiveDateTime;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct Adoption {

    pub id: i32,
    pub pet_id: i32,
    pub owner_id: i32,
    pub adopted_at: NaiveDateTime,
    pub adoption_fee: bigdecimal::BigDecimal,
    pub updated_by: Option<String>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct AdoptionsAuditLog {

    pub id: i64,
    pub table_name: String,
    pub operation: String,
    pub old_data: Option<String>,
    pub new_data: Option<String>,
    pub changed_at: NaiveDateTime,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct Category {

    pub id: i32,
    pub name: String,
    pub description: Option<String>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct LegacyInventory {

    pub id: i32,
    pub item_name: Option<String>,
    pub old_sku: Option<String>,
    pub quantity: Option<i32>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct Location {

    pub id: i32,
    pub name: String,
    pub address: String,
    pub city: String,
    pub zip: Option<String>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct MedicalRecord {

    pub id: i32,
    pub pet_id: i32,
    pub visit_date: NaiveDate,
    pub diagnosis: String,
    pub treatment: Option<String>,
    pub vet_name: Option<String>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct Owner {

    pub id: i32,
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub created_at: Option<NaiveDateTime>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct Pet {

    pub id: i32,
    pub category_id: Option<i32>,
    pub name: String,
    pub sku: String,
    pub price: bigdecimal::BigDecimal,
    pub internal_notes: Option<String>,
    pub status: String,
    pub created_at: Option<NaiveDateTime>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct Review {

    pub id: i32,
    pub pet_id: i32,
    pub owner_id: i32,
    pub rating: i32,
    pub body: Option<String>,
    pub location_id: Option<i32>,
    pub created_at: Option<NaiveDateTime>,

}

#[derive(Debug, Clone, Serialize, Deserialize)]

pub struct StaffAuditLog {

    pub id: i64,
    pub table_name: String,
    pub operation: String,
    pub old_data: Option<String>,
    pub new_data: Option<String>,
    pub changed_at: NaiveDateTime,

}

pub type GetAdoptionReport = fn(i32) -> ();
