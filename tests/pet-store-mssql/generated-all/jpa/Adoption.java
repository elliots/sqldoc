import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "adoptions")
public class Adoption {

    @Id
    public Integer id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "pet_id", nullable = false)
    public Pet pet;

    @ManyToOne(optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    public Owner owner;

    @Column(name = "adopted_at", nullable = false)
    public LocalDateTime adoptedAt;

    @Column(name = "adoption_fee", nullable = false)
    public BigDecimal adoptionFee;

    @Column(name = "updated_by")
    public String updatedBy;

}
