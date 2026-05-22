# Assets

Sample data used by the system at runtime and during testing.

## Expected files (add these before running):

- `products.csv` — the brand's product catalog. Source of truth for SKU
  matching. Provided as part of the challenge package.
- `sample-quotation-*.xlsx` — example supplier quotations to seed manual
  testing. The evaluator will test the system with a **different** XLSX,
  so do not hardcode anything against the sample shapes.

## Catalog format (expected columns)

The parser/matcher tolerates a permissive shape, but the canonical form is:

```
sku,name,category,unit,base_price,...
```

Loaded into the `product_catalog` table at boot or via a seed script (TBD).
