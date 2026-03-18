FROM rust:1.85-slim
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN cargo init --name typecheck .
RUN cat >> Cargo.toml <<'TOML'
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["serde"] }
bigdecimal = { version = "0.4", features = ["serde"] }
tokio = { version = "1", features = ["full"] }
tokio-postgres = "0.7"
TOML
RUN rm src/main.rs
COPY models.rs src/models.rs
COPY test.rs src/main.rs
# Prepend mod declaration to main.rs
RUN sed -i '1s/^/mod models;\n/' src/main.rs
# Step 1: compile (typechecks models + test)
RUN cargo build --release
# Step 2: run integration test against real DB
CMD ["./target/release/typecheck"]
