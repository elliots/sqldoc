import jakarta.persistence.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDateTime;

@Entity
@Table(name = "reviews")
public class Review {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;

    @Column(nullable = false)
    private int petId;

    @Column(nullable = false)
    private int ownerId;

    @Column(nullable = false)
    @Min(1)
    @Max(5)
    private int rating;

    private String body;

    @ManyToOne
    @JoinColumn(name = "location_id")
    private Integer locationId;

    private LocalDateTime createdAt;

}
