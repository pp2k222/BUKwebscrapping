# Wybierz bazowy obraz Node.js
FROM node:18-slim

# Ustaw katalog roboczy
WORKDIR /usr/src/app

# Skopiuj pliki projektu (pierw kopiuj package*.json, potem resztę)
COPY package*.json ./

# Zainstaluj zależności
RUN npm install

# Zainstaluj dodatkowe zależności systemowe dla Puppeteera
RUN apt-get update && apt-get install -y \
    chromium \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Ustawienie zmiennej środowiskowej dla Puppeteera
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Skopiuj resztę aplikacji do kontenera
COPY . .

# Otwórz port 3000
EXPOSE 3000

# Uruchom aplikację
CMD ["npm", "start"]
