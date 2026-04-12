import jakarta.persistence.*;
import jakarta.validation.constraints.NotEmpty;

@Entity
@Table(name = "categories")
public class Category {

    @Id
    public Integer id;

    @Column(nullable = false, length = 100)
    @NotEmpty
    public String name;

    public String description;

}
