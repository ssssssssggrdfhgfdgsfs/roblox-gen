FROM ghcr.io/puppeteer/puppeteer:21.11.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /home/pptruser/app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
