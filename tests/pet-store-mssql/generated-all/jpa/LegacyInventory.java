import jakarta.persistence.*;

@Entity
@Table(name = "legacy_inventory")
public class LegacyInventory {

    @Id
    public Integer id;

    @Column(name = "item_name", length = 200)
    public String itemName;

    @Column(name = "old_sku", length = 50)
    public String oldSku;

    public Integer quantity;

}
