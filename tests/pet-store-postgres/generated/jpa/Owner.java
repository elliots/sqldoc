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
    private int id;

    @Column(nullable = false)
    @NotEmpty
    private String name;

    @Column(nullable = false)
    @Pattern(regexp = "^[^@]+@[^@]+\\.[^@]+$")
    private String email;

    @Size(min = 7, max = 20)
    private String phone;

    private LocalDateTime createdAt;

}
