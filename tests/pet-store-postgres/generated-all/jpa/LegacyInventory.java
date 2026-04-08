import jakarta.persistence.*;

@Entity
@Table(name = "legacy_inventory")
public class LegacyInventory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Integer id;

    @Column(name = "item_name")
    public String itemName;

    @Column(name = "old_sku")
    public String oldSku;

    public Integer quantity;

}
