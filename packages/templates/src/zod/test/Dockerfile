FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm pkg set type=module && npm install typescript@5 zod@3 @types/node --save-dev
RUN npx tsc --noEmit --strict --esModuleInterop --module nodenext --moduleResolution nodenext --allowImportingTsExtensions *.ts
CMD ["node", "--experimental-strip-types", "test.ts"]
