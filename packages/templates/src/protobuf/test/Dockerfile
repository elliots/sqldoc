FROM alpine:3.20
RUN apk add --no-cache protobuf protobuf-dev python3 py3-protobuf
WORKDIR /app
COPY . .
# Step 1: validate protobuf syntax
RUN protoc --proto_path=/usr/include --proto_path=. --descriptor_set_out=/dev/null schema.proto
# Step 2: generate Python bindings
RUN protoc --proto_path=/usr/include --proto_path=. --python_out=. schema.proto
# Step 3: serialize and deserialize messages
RUN python3 test.py
CMD ["echo", "ok"]
