# بيئة تشغيل الاستوديو + بوابة الذكاء الاصطناعي المفتوح (بدون أي مفتاح API)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json ./
# لا يوجد package-lock ملتزم به؛ npx يثبّت بسرعة باستخدام تعريفات package.json
RUN npm install --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY server ./server
COPY src/core ./src/core
COPY src/packs ./src/packs
COPY src/maps ./src/maps
COPY src/storage ./src/storage

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
