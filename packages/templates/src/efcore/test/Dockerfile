FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine
WORKDIR /app
RUN dotnet new console -n TestApp --force && rm TestApp/Program.cs
RUN dotnet add TestApp/ package Microsoft.EntityFrameworkCore --version 9.0.0
RUN dotnet add TestApp/ package Npgsql.EntityFrameworkCore.PostgreSQL --version 9.0.0
RUN dotnet add TestApp/ package EFCore.NamingConventions --version 9.0.0
COPY *.cs TestApp/
RUN dotnet build TestApp/
CMD ["dotnet", "run", "--project", "TestApp", "--no-build"]
