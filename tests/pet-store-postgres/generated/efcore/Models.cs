using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

namespace Generated;

public class Adoption

{

    [Key]
    public int Id { get; set; }

    [ForeignKey("PetId")]
    public int PetId { get; set; }

    [ForeignKey("OwnerId")]
    public int OwnerId { get; set; }

    public DateTime AdoptedAt { get; set; }

    public decimal AdoptionFee { get; set; }


}

public class AdoptionsAuditLog

{

    [Key]
    public long Id { get; set; }

    [Required]
    public string TableName { get; set; }

    [Required]
    public string Operation { get; set; }

    public string? OldData { get; set; }

    public string? NewData { get; set; }

    public DateTimeOffset ChangedAt { get; set; }


}

public class Category

{

    [Key]
    public int Id { get; set; }

    [Required]
    public string Name { get; set; }

    public string? Description { get; set; }


}

public class LegacyInventory

{

    [Key]
    public int Id { get; set; }

    public string? ItemName { get; set; }

    public string? OldSku { get; set; }

    public int? Quantity { get; set; }


}

public class Location

{

    [Key]
    public int Id { get; set; }

    [Required]
    public string Name { get; set; }

    [Required]
    public string Address { get; set; }

    [Required]
    public string City { get; set; }

    public string? Zip { get; set; }


}

public class MedicalRecord

{

    [Key]
    public int Id { get; set; }

    [ForeignKey("PetId")]
    public int PetId { get; set; }

    public DateOnly VisitDate { get; set; }

    [Required]
    public string Diagnosis { get; set; }

    public string? Treatment { get; set; }

    public string? VetName { get; set; }


}

public class Owner

{

    [Key]
    public int Id { get; set; }

    [Required]
    public string Name { get; set; }

    [Required]
    [RegularExpression(@"^[^@]+@[^@]+\.[^@]+$")]
    public string Email { get; set; }

    [MaxLength(20)]
    public string? Phone { get; set; }

    public DateTime? CreatedAt { get; set; }


}

public class Pet

{

    [Key]
    public int Id { get; set; }

    [ForeignKey("CategoryId")]
    public int? CategoryId { get; set; }

    [Required]
    public string Name { get; set; }

    [Required]
    [RegularExpression(@"^[A-Z]{3}-[0-9]{4}$")]
    public string Sku { get; set; }

    [Range(0, 99999)]
    public decimal Price { get; set; }

    public string? InternalNotes { get; set; }

    [Required]
    public string Status { get; set; }

    public DateTime? CreatedAt { get; set; }


}

public class Review

{

    [Key]
    public int Id { get; set; }

    public int PetId { get; set; }

    public int OwnerId { get; set; }

    [Range(1, 5)]
    public int Rating { get; set; }

    public string? Body { get; set; }

    [ForeignKey("LocationId")]
    public int? LocationId { get; set; }

    public DateTime? CreatedAt { get; set; }


}

public class StaffAuditLog

{

    [Key]
    public long Id { get; set; }

    [Required]
    public string TableName { get; set; }

    [Required]
    public string Operation { get; set; }

    public string? OldData { get; set; }

    public string? NewData { get; set; }

    public DateTimeOffset ChangedAt { get; set; }


}
