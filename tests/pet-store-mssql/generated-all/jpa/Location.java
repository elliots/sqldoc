import jakarta.persistence.*;

@Entity
@Table(name = "locations")
public class Location {

    @Id
    public Integer id;

    @Column(nullable = false, length = 200)
    public String name;

    @Column(nullable = false)
    public String address;

    @Column(nullable = false, length = 100)
    public String city;

    @Column(length = 20)
    public String zip;

}
