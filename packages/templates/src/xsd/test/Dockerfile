FROM alpine:3.20
RUN apk add --no-cache libxml2-utils
WORKDIR /app
COPY . .
# Step 1: validate XSD syntax
RUN xmllint --noout schema.xsd
# Step 2: validate sample data against the schema
RUN xmllint --noout --schema test.xsd test.xml
# Step 3: verify invalid data is rejected
RUN ! xmllint --noout --schema test.xsd test-invalid.xml 2>/dev/null
CMD ["echo", "ok"]
