FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine
WORKDIR /app
RUN dotnet new classlib -n TypeCheck --force && rm TypeCheck/Class1.cs
COPY *.cs TypeCheck/
RUN dotnet build TypeCheck/
CMD ["echo", "ok"]
