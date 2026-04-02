import jakarta.persistence.*;

@Entity
@Table(name = "legacy_inventory")
public class LegacyInventory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;

    private String itemName;

    private String oldSku;

    private Integer quantity;

}
