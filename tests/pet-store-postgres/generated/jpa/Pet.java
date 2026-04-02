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
    private int id;

    @ManyToOne
    @JoinColumn(name = "category_id")
    private Integer categoryId;

    @Column(nullable = false)
    @NotEmpty
    private String name;

    @Column(nullable = false)
    @Pattern(regexp = "^[A-Z]{3}-[0-9]{4}$")
    private String sku;

    @Column(nullable = false)
    @Min(0)
    @Max(99999)
    private BigDecimal price;

    private String internalNotes;

    @Column(nullable = false)
    private String status;

    private LocalDateTime createdAt;

}
