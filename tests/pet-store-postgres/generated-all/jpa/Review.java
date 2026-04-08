import jakarta.persistence.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDateTime;

@Entity
@Table(name = "reviews")
public class Review {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Integer id;

    @Column(name = "pet_id", nullable = false)
    public int petId;

    @Column(name = "owner_id", nullable = false)
    public int ownerId;

    @Column(nullable = false)
    @Min(1)
    @Max(5)
    public int rating;

    public String body;

    @ManyToOne
    @JoinColumn(name = "location_id")
    public Location location;

    @Column(name = "created_at")
    public LocalDateTime createdAt;

}
