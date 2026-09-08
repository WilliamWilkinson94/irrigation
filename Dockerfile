# 1. Base image with Node.js LTS (Alpine-based Linux for lightweight build)
FROM node:20-alpine

# 2. Install system dependencies required for arduino-cli, git, and python
RUN apk add --no-libc-base-utils --no-cache \
    curl \
    bash \
    python3 \
    make \
    g++ \
    git

# 3. Download and install arduino-cli
RUN curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh -s 0.35.0 \
    && mv bin/arduino-cli /usr/local/bin/

# 4. Initialize arduino-cli configuration and install ESP32 board core
RUN arduino-cli config init \
    && arduino-cli config set board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json \
    && arduino-cli core update-index \
    && arduino-cli core install esp32:esp32

# 5. Set working directory inside container
WORKDIR /app

# 6. Copy package dependency files
COPY package*.json ./
COPY prisma ./prisma/

# 7. Install Node.js dependencies
RUN npm install

# 8. Generate Prisma client binaries
RUN npx prisma generate

# 9. Copy remaining project application source code
COPY . .

# 10. Expose server port
EXPOSE 8080

# 11. Command to apply database migrations and start the Node.js server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
