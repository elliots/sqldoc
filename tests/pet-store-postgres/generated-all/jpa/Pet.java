import jakarta.persistence.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "pets")
public class Pet {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public int id;

    @ManyToOne
    @JoinColumn(name = "category_id")
    public Category category;

    @Column(nullable = false)
    @NotEmpty
    public String name;

    @Column(nullable = false)
    @Pattern(regexp = "^[A-Z]{3}-[0-9]{4}$")
    public String sku;

    @Column(nullable = false)
    @Min(0)
    @Max(99999)
    public BigDecimal price;

    @Column(name = "internal_notes")
    public String internalNotes;

    @Column(nullable = false)
    public String status;

    @Column(name = "created_at")
    public LocalDateTime createdAt;

}
