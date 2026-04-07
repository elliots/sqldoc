FROM ruby:3.3-slim
RUN apt-get update && apt-get install -y libpq-dev build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN gem install pg --no-document
# Step 1: syntax check all generated .rb files
RUN for f in *.rb; do ruby -c "$f"; done
# Step 2: run integration test against real DB
CMD ["ruby", "test.rb"]
