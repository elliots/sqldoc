FROM alpine:3.20
RUN apk add --no-cache libxml2-utils
WORKDIR /app
COPY . .
RUN xmllint --noout schema.xsd
CMD ["echo", "ok"]
