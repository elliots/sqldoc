FROM alpine:3.20
RUN apk add --no-cache protobuf protobuf-dev
WORKDIR /app
COPY . .
RUN protoc --proto_path=/usr/include --proto_path=. --descriptor_set_out=/dev/null schema.proto
CMD ["echo", "ok"]
