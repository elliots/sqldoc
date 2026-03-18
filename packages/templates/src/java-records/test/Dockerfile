FROM eclipse-temurin:21-jdk-alpine
WORKDIR /app
RUN apk add --no-cache curl
# Download PostgreSQL JDBC driver
RUN mkdir -p /deps && \
    curl -sL -o /deps/postgresql-42.7.4.jar https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar
COPY . .
# Step 1: compile the generated records + test
RUN javac -cp "/deps/*:." *.java Test.java
# Step 2: run integration test against real DB
CMD ["java", "-cp", "/deps/*:.", "Test"]
