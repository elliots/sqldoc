FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm pkg set type=module && npm install typescript@5 knex@3 pg @types/pg @types/node --save-dev
# Note: knex module augmentation (knex/types/tables) doesn't typecheck under nodenext.
# Skip tsc and focus on the runtime integration test.
CMD ["node", "--experimental-strip-types", "test.ts"]
