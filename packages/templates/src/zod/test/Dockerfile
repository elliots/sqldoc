FROM node:23-slim
WORKDIR /app
COPY . .
RUN npm init -y && npm install typescript@5 zod@3 @types/node --save-dev
RUN npx tsc --noEmit --strict --esModuleInterop --module nodenext --moduleResolution nodenext *.ts
CMD ["echo", "ok"]
