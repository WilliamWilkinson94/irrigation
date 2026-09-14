FROM node:18-alpine

# 1. Install OpenSSL for Prisma engine compatibility on Alpine Linux
RUN apk add --no-cache openssl

# 2. Set working directory
WORKDIR /app

# 3. Copy package manifests and install dependencies
COPY package*.json ./
RUN npm install

# 4. Copy application source code
COPY . .

# 5. Generate Prisma Client bindings
RUN npx prisma generate

# 6. Build the Vite React frontend into the dist/ directory
RUN npm run build

# 7. Expose application port
EXPOSE 8080

# 8. Push database schema and start the Express server
CMD ["sh", "-c", "npx prisma db push && npm start"]
