import jakarta.persistence.*;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

@Entity
@Table(name = "owners")
public class Owner {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Integer id;

    @Column(nullable = false)
    @NotEmpty
    public String name;

    @Column(nullable = false)
    @Pattern(regexp = "^[^@]+@[^@]+\\.[^@]+$")
    public String email;

    @Size(min = 7, max = 20)
    public String phone;

    @Column(name = "created_at")
    public LocalDateTime createdAt;

}
