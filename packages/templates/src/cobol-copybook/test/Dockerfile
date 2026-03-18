FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gnucobol4 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN printf '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. TEST-CPY.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n       COPY "schema.cpy".\n       PROCEDURE DIVISION.\n           STOP RUN.\n' > test.cob
RUN cobc -fsyntax-only test.cob
CMD ["echo", "ok"]
