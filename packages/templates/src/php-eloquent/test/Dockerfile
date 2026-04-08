FROM php:8.3-cli
RUN apt-get update && apt-get install -y libpq-dev && docker-php-ext-install pdo pdo_pgsql && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Step 1: syntax check all generated PHP files
RUN for f in *.php; do php -l "$f"; done
# Step 2: run integration test against real DB
CMD ["php", "test.php"]
