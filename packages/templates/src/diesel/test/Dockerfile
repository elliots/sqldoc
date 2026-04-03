FROM rust:1.85-slim
RUN apt-get update && apt-get install -y pkg-config libssl-dev libpq-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN cargo init --name typecheck .
RUN cat >> Cargo.toml <<'TOML'
diesel = { version = "2", features = ["postgres", "chrono", "numeric", "serde_json", "uuid"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["serde", "v4"] }
bigdecimal = { version = "0.4", features = ["serde"] }
TOML
RUN rm src/main.rs
COPY schema.rs src/schema.rs
COPY models.rs src/models.rs
COPY test.rs src/main.rs
RUN sed -i '1s/^/mod schema;\nmod models;\n/' src/main.rs
RUN cargo build --release
CMD ["./target/release/typecheck"]
