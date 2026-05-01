# Prices API

Bidirectional component pricing endpoint for authorized partners.

**Base URL:** `https://uas-forge.com/.netlify/functions/prices-api`

---

## GET — Read pricing

Returns component pricing data merged with community submissions.

### Query parameters

| Parameter | Description |
|---|---|
| `component` | Filter by PID or name substring (e.g. `TCAM-0001` or `flir boson`) |
| `category` | Filter by category (e.g. `thermal_cameras`, `flight_controllers`) |
| `all=1` | Return all components (no filter) |

### Response

```json
{
  "components": [
    {
      "pid": "TCAM-0001",
      "name": "Teledyne FLIR Boson 640",
      "category": "thermal_cameras",
      "manufacturer": "Teledyne FLIR",
      "price_usd": 4500,
      "approx_price": "$3,000–$6,000",
      "availability": "limited",
      "lead_time_weeks": 14,
      "community_price": 4500,
      "community_source": "https://distributor.example.com/quote/123",
      "last_community_update": "2026-05-01T18:00:00.000Z",
      "confidence": 0.82,
      "source": "community_validated",
      "link": "https://oem.flir.com/products/boson",
      "ndaa_compliant": true
    }
  ],
  "meta": {
    "total": 1,
    "community_submissions": 47,
    "generated": "2026-05-01T18:30:00.000Z"
  }
}
```

### Confidence levels

| Value | Source | Meaning |
|---|---|---|
| `0.55` | `static` | Build-time scraped price, no community validation |
| `0.65–0.70` | `community` | 1–2 community submissions |
| `0.82` | `community_validated` | 3+ submissions converging |

### Available categories

Query `?all=1` and inspect `components[].category`, or call with no params to get the category list.

---

## POST — Submit pricing

Submit a current spot price or availability update. Requires API key.

### Authentication

```
Authorization: Bearer <your-api-key>
```

### Request body

```json
{
  "pid": "TCAM-0001",
  "name": "Teledyne FLIR Boson 640",
  "category": "thermal_cameras",
  "manufacturer": "Teledyne FLIR",
  "price_usd": 4500,
  "availability": "limited",
  "lead_time_weeks": 14,
  "source_url": "https://distributor.example.com/quote/123",
  "note": "Lead time extended from 12→14 weeks as of May 2026"
}
```

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Component name |
| `price_usd` | ✅ | Current price in USD (number) |
| `pid` | No | Match to existing Forge component by PID |
| `category` | No | Component category |
| `manufacturer` | No | Manufacturer name |
| `availability` | No | `in_stock`, `limited`, `unavailable`, `lead_time_weeks` |
| `lead_time_weeks` | No | Current lead time if availability is `lead_time_weeks` |
| `source_url` | No | Distributor page or quote URL |
| `note` | No | Free-text context |

**Unknown components** (no matching `pid` in Forge DB) are accepted and queued — the PIE pipeline will attempt to match or create a new component entry on the next run.

### Response

```json
{
  "ok": true,
  "submission_id": "cs-1746122400000-x7k9m2",
  "message": "Price submission for \"Teledyne FLIR Boson 640\" received. Will be folded into PIE pipeline on next run."
}
```

---

## Pipeline integration

Submissions accumulate in `community_prices` (Netlify Blobs). The PIE pipeline reads this on each run to:

1. Update `price_usd` on matched components
2. Feed community availability data into supply constraint flags
3. Weight confidence scores for prediction models
4. Flag new components not yet in the Forge DB

New components submitted via POST that don't match an existing PID are surfaced in the next PIE brief under supply chain signals.
