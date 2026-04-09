namespace Generated;

public record AdoptionReport(

    string PetName,
    string OwnerName,
    DateTime AdoptedAt,
    decimal AdoptionFee,
    string CategoryName

);

public record Adoption(

    int Id,
    int PetId,
    int OwnerId,
    DateTime AdoptedAt,
    decimal AdoptionFee

);

public record AdoptionsAuditLog(

    long Id,
    string TableName,
    string Operation,
    string? OldData,
    string? NewData,
    DateTimeOffset ChangedAt

);

public record Category(

    int Id,
    string Name,
    string? Description

);

public record LegacyInventory(

    int Id,
    string? ItemName,
    string? OldSku,
    int? Quantity

);

public record Location(

    int Id,
    string Name,
    string Address,
    string City,
    string? Zip

);

public record MedicalRecord(

    int Id,
    int PetId,
    DateOnly VisitDate,
    string Diagnosis,
    string? Treatment,
    string? VetName

);

public record Owner(

    int Id,
    string Name,
    string Email,
    string? Phone,
    DateTime? CreatedAt

);

public record Pet(

    int Id,
    int? CategoryId,
    string Name,
    string Sku,
    decimal Price,
    string? InternalNotes,
    string Status,
    DateTime? CreatedAt

);

public record Review(

    int Id,
    int PetId,
    int OwnerId,
    int Rating,
    string? Body,
    int? LocationId,
    DateTime? CreatedAt

);

public record StaffAuditLog(

    long Id,
    string TableName,
    string Operation,
    string? OldData,
    string? NewData,
    DateTimeOffset ChangedAt

);

public delegate IEnumerable<AdoptionReport> GetAdoptionReport(int pOwnerId);
