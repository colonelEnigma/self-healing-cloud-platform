FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir awscli

COPY package*.json ./
RUN npm install

COPY src ./src

CMD ["npm", "start"]
