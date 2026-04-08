import java.time.LocalDate;

public record MedicalRecord(
    int id,
    int petId,
    LocalDate visitDate,
    String diagnosis,
    String treatment,
    String vetName
) {}
