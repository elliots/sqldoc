FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm install ajv@8 ajv-formats@3 --save-dev
# Step 1: validate that each schema definition is valid JSON Schema
RUN node -e " \
  const Ajv = require('ajv/dist/2020'); \
  const addFormats = require('ajv-formats'); \
  const schema = require('./schema.json'); \
  const ajv = new Ajv({ allErrors: true }); \
  addFormats(ajv); \
  for (const [name, def] of Object.entries(schema.\$defs || {})) { \
    const valid = ajv.validateSchema(def); \
    if (!valid) { console.error('INVALID:', name, ajv.errors); process.exit(1); } \
    console.log('OK:', name); \
  } \
  console.log('All schemas valid'); \
"
# Step 2: validate sample data against schemas and test rejection
RUN node test.js
CMD ["echo", "ok"]
