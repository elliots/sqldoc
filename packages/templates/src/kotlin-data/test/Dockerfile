FROM eclipse-temurin:21-jdk-alpine
RUN apk add --no-cache curl unzip zip bash
# Install Kotlin via SDKMAN
RUN curl -s https://get.sdkman.io | bash && \
    bash -c "source /root/.sdkman/bin/sdkman-init.sh && sdk install kotlin"
# Download PostgreSQL JDBC driver
RUN mkdir -p /deps && \
    curl -sL -o /deps/postgresql-42.7.4.jar https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar
WORKDIR /app
COPY . .
# Step 1: compile the generated data classes + test
RUN bash -c "source /root/.sdkman/bin/sdkman-init.sh && kotlinc -cp /deps/* *.kt Test.kt -include-runtime -d out.jar"
# Step 2: run integration test against real DB
CMD ["java", "-cp", "out.jar:/deps/*", "TestKt"]
