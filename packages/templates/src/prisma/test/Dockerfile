FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm pkg set type=module && npm install prisma@6 @prisma/client@6 typescript@5 @types/node --save-dev
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN npx prisma validate --schema=schema.prisma
RUN npx prisma generate --schema=schema.prisma
CMD ["node", "--experimental-strip-types", "test.ts"]
