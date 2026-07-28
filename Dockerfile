# Development environment only — production builds run in GitHub Actions.
# Keeps Node and node_modules off the host machine.
FROM node:22-alpine

# sharp needs these for image optimisation on Alpine
RUN apk add --no-cache libc6-compat vips-dev python3 make g++

WORKDIR /app

# Installed into the image so the host bind-mount never shadows node_modules
COPY package.json ./
RUN npm install

COPY . .

EXPOSE 4321
CMD ["npm", "run", "dev"]
