FROM rust:1.85-slim
WORKDIR /app
RUN cargo init --name typecheck .
RUN cat >> Cargo.toml <<'TOML'
diesel = { version = "2", features = ["postgres"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["serde"] }
bigdecimal = { version = "0.4", features = ["serde"] }
TOML
RUN rm src/main.rs
COPY . src/
RUN echo 'mod schema;' > src/lib.rs && echo 'mod models;' >> src/lib.rs
RUN cargo check
CMD ["echo", "ok"]
