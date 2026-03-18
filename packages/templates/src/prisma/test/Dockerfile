FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm install prisma@6 --save-dev
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN npx prisma validate --schema=schema.prisma
CMD ["echo", "ok"]
