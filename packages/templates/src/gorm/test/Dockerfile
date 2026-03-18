FROM golang:1.24-alpine
WORKDIR /app
# Set up Go module with models as a sub-package
RUN go mod init sqldoc-test
RUN mkdir -p models cmd/test
COPY models.go models/
COPY test.go cmd/test/main.go
ENV GOTOOLCHAIN=auto
RUN go get github.com/jackc/pgx/v5 gorm.io/gorm gorm.io/driver/postgres && go mod tidy
# Step 1: typecheck/compile all packages
RUN go build -o /usr/local/bin/test-runner ./cmd/test
# Step 2: run integration test against real DB
CMD ["test-runner"]
