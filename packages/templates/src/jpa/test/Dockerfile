FROM eclipse-temurin:21-jdk-alpine
WORKDIR /app
RUN apk add --no-cache curl
# Download Jakarta Persistence API JARs and PostgreSQL JDBC driver
RUN mkdir -p /deps && \
    curl -sL -o /deps/jakarta.persistence-api-3.2.0.jar https://repo1.maven.org/maven2/jakarta/persistence/jakarta.persistence-api/3.2.0/jakarta.persistence-api-3.2.0.jar && \
    curl -sL -o /deps/jakarta.validation-api-3.1.0.jar https://repo1.maven.org/maven2/jakarta/validation/jakarta.validation-api/3.1.0/jakarta.validation-api-3.1.0.jar && \
    curl -sL -o /deps/jakarta.annotation-api-3.0.0.jar https://repo1.maven.org/maven2/jakarta/annotation/jakarta.annotation-api/3.0.0/jakarta.annotation-api-3.0.0.jar && \
    curl -sL -o /deps/postgresql-42.7.4.jar https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar
COPY . .
# Step 1: compile the generated JPA entities + test
RUN javac -cp "/deps/*:." *.java Test.java
# Step 2: run integration test against real DB
CMD ["java", "-cp", "/deps/*:.", "Test"]
