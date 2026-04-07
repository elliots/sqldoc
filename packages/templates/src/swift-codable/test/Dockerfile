FROM swift:6.0-jammy
WORKDIR /app
COPY Package.swift .
RUN mkdir Sources
COPY Models.swift Sources/
COPY test.swift Sources/main.swift
# Step 1: compile (typechecks models + test)
RUN swift build 2>&1
# Step 2: run JSON round-trip test (no DB — typecheck + JSON validation)
CMD ["swift", "run"]
