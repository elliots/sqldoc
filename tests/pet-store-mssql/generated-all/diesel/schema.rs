diesel::table! {

    adoptions (id) {

        id -> Integer,
        pet_id -> Integer,
        owner_id -> Integer,
        adopted_at -> Text,
        adoption_fee -> Text,
        updated_by -> Nullable<Text>,

    }

}

diesel::table! {

    adoptions_audit_log (id) {

        id -> BigInt,
        table_name -> Text,
        operation -> Text,
        old_data -> Nullable<Text>,
        new_data -> Nullable<Text>,
        changed_at -> Text,

    }

}

diesel::table! {

    categories (id) {

        id -> Integer,
        name -> Text,
        description -> Nullable<Text>,

    }

}

diesel::table! {

    legacy_inventory (id) {

        id -> Integer,
        item_name -> Nullable<Text>,
        old_sku -> Nullable<Text>,
        quantity -> Nullable<Integer>,

    }

}

diesel::table! {

    locations (id) {

        id -> Integer,
        name -> Text,
        address -> Text,
        city -> Text,
        zip -> Nullable<Text>,

    }

}

diesel::table! {

    medical_records (id) {

        id -> Integer,
        pet_id -> Integer,
        visit_date -> Date,
        diagnosis -> Text,
        treatment -> Nullable<Text>,
        vet_name -> Nullable<Text>,

    }

}

diesel::table! {

    owners (id) {

        id -> Integer,
        name -> Text,
        email -> Text,
        phone -> Nullable<Text>,
        created_at -> Nullable<Text>,

    }

}

diesel::table! {

    pets (id) {

        id -> Integer,
        category_id -> Nullable<Integer>,
        name -> Text,
        sku -> Text,
        price -> Text,
        internal_notes -> Nullable<Text>,
        status -> Text,
        created_at -> Nullable<Text>,

    }

}

diesel::table! {

    reviews (id) {

        id -> Integer,
        pet_id -> Integer,
        owner_id -> Integer,
        rating -> Integer,
        body -> Nullable<Text>,
        location_id -> Nullable<Integer>,
        created_at -> Nullable<Text>,

    }

}

diesel::table! {

    staff_audit_log (id) {

        id -> BigInt,
        table_name -> Text,
        operation -> Text,
        old_data -> Nullable<Text>,
        new_data -> Nullable<Text>,
        changed_at -> Text,

    }

}
