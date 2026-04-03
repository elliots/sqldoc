FROM maven:3.9-eclipse-temurin-21-alpine AS deps
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:copy-dependencies -DoutputDirectory=/deps -q

FROM eclipse-temurin:21-jdk-alpine
WORKDIR /app
COPY --from=deps /deps /deps
COPY . .
RUN javac -cp "/deps/*:." *.java Test.java
CMD ["java", "-cp", "/deps/*:.", "Test"]
