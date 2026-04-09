import java.math.BigDecimal
import java.time.LocalDateTime
import java.time.OffsetDateTime

data class AdoptionReport(

    val petName: String,
    val ownerName: String,
    val adoptedAt: LocalDateTime,
    val adoptionFee: BigDecimal,
    val categoryName: String

)

data class Adoption(

    val id: Int,
    val petId: Int,
    val ownerId: Int,
    val adoptedAt: LocalDateTime,
    val adoptionFee: BigDecimal

)

data class AdoptionsAuditLog(

    val id: Long,
    val tableName: String,
    val operation: String,
    val oldData: String? = null,
    val newData: String? = null,
    val changedAt: OffsetDateTime

)

data class Category(

    val id: Int,
    val name: String,
    val description: String? = null

)

data class LegacyInventory(

    val id: Int,
    val itemName: String? = null,
    val oldSku: String? = null,
    val quantity: Int? = null

)

data class Location(

    val id: Int,
    val name: String,
    val address: String,
    val city: String,
    val zip: String? = null

)

data class MedicalRecord(

    val id: Int,
    val petId: Int,
    val visitDate: LocalDate,
    val diagnosis: String,
    val treatment: String? = null,
    val vetName: String? = null

)

data class Owner(

    val id: Int,
    val name: String,
    val email: String,
    val phone: String? = null,
    val createdAt: LocalDateTime? = null

)

data class Pet(

    val id: Int,
    val categoryId: Int? = null,
    val name: String,
    val sku: String,
    val price: BigDecimal,
    val internalNotes: String? = null,
    val status: String,
    val createdAt: LocalDateTime? = null

)

data class Review(

    val id: Int,
    val petId: Int,
    val ownerId: Int,
    val rating: Int,
    val body: String? = null,
    val locationId: Int? = null,
    val createdAt: LocalDateTime? = null

)

data class StaffAuditLog(

    val id: Long,
    val tableName: String,
    val operation: String,
    val oldData: String? = null,
    val newData: String? = null,
    val changedAt: OffsetDateTime

)

typealias GetAdoptionReport = (pOwnerId: Int) -> List<AdoptionReport>
