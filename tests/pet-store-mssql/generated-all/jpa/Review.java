import jakarta.persistence.*;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDateTime;

@Entity
@Table(name = "reviews")
public class Review {

    @Id
    public Integer id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "pet_id", nullable = false)
    public Pet pet;

    @ManyToOne(optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    public Owner owner;

    @Column(nullable = false)
    public int rating;

    @Min(1)
    @Max(5)
    public String body;

    @ManyToOne
    @JoinColumn(name = "location_id")
    public Location location;

    @Column(name = "created_at")
    public LocalDateTime createdAt;

}
