import jakarta.persistence.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "pets")
public class Pet {

    @Id
    public Integer id;

    @ManyToOne
    @JoinColumn(name = "category_id")
    public Category category;

    @Column(nullable = false, length = 100)
    @NotEmpty
    public String name;

    @Column(nullable = false, length = 20)
    public String sku;

    @Column(nullable = false)
    @Min(0)
    @Max(99999)
    public BigDecimal price;

    @Column(name = "internal_notes")
    public String internalNotes;

    @Column(nullable = false, length = 20)
    public String status;

    @Column(name = "created_at")
    public LocalDateTime createdAt;

}
