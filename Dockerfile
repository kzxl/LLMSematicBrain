FROM node:20-alpine
WORKDIR /app

# Cài đặt dependencies
COPY package*.json ./
RUN npm install

# Copy mã nguồn
COPY . .

# Mở port cho SemanticBrain và Proxy
EXPOSE 3457 3458

# Chạy lệnh mặc định (có thể bị ghi đè bởi docker-compose)
CMD ["npm", "run", "start"]
