FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm pkg set type=module && npm install typescript@5 kysely@0.27 pg @types/pg @types/node --save-dev
# Step 1: typecheck the generated types
RUN npx tsc --noEmit --strict --esModuleInterop --module nodenext --moduleResolution nodenext database.ts
# Step 2: run integration test against real DB
CMD ["node", "--experimental-strip-types", "test.ts"]
