FROM node:22-alpine AS build

WORKDIR /app

COPY backend/package.json ./
RUN npm install

COPY backend ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

EXPOSE 8787
CMD ["npm", "run", "start"]
