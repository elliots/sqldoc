FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine
WORKDIR /app
RUN dotnet new classlib -n TypeCheck --force && rm TypeCheck/Class1.cs
RUN dotnet add TypeCheck/ package Microsoft.EntityFrameworkCore --version 9.0.0
COPY *.cs TypeCheck/
RUN dotnet build TypeCheck/
CMD ["echo", "ok"]
