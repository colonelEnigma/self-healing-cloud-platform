FROM node:20-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install deps (prod only)
RUN npm install --omit=dev

# Copy source
COPY . .

# Document port (must match your service)
EXPOSE 3000

# Start command
CMD ["npm", "start"]