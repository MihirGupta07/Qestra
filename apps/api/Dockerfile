FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./

EXPOSE 4000
CMD ["npm", "run", "start:api"]
