# Health-check re-verification — 2026-08-28

- environments checked: fixture (http://127.0.0.1:4210)

confirmed 2 · not reproduced 0 · could not check 0

"Not reproduced" means the defect is absent today. It does not distinguish
"fixed" from "never valid" — that needs the deploy log, not the DOM.

| issue | from | verdict | environments |
|---|---|---|---|
| HC-2026-04-28-1 — Quick-view close button missing translation key | 2026-04-28 | confirmed | fixture: confirmed |
| HC-2026-04-28-2 — Quick-view sr-only div — product title not substituted | 2026-04-28 | confirmed | fixture: confirmed |

## 2 ticket(s) drafted

### [P2] Quick-view close button missing translation key

```
Re-confirmed from Kitsch Top 20 PDP Health Check (reported 2026-04-28).

Still present on:
  - fixture — 4 page(s) checked

Evidence:
  - fixture: / — aria-label on button.quick-view__close: button.quick-view__close[aria-label] = "Translation missing: en.products.product.quick_view.close"
  - fixture: /collections/best-sellers — aria-label on button.quick-view__close: button.quick-view__close[aria-label] = "Translation missing: en.products.product.quick_view.close"
  - fixture: /products/coastal-cottage-hair-perfume-duo — aria-label on button.quick-view__close: button.quick-view__close[aria-label] = "Translation missing: en.products.product.quick_view.close"
  - fixture: /cart — aria-label on button.quick-view__close: button.quick-view__close[aria-label] = "Translation missing: en.products.product.quick_view.close"

Raised automatically by the daily health-check re-verification. The check
reproduced this issue; it does not propose a fix.
```

### [P2] Quick-view sr-only div — product title not substituted

```
Re-confirmed from Kitsch Top 20 PDP Health Check (reported 2026-04-28).

Still present on:
  - fixture — 4 page(s) checked

Evidence:
  - fixture: / — visible copy: Bestsellers × Quick view of {{ product_title }}
  - fixture: /collections/best-sellers — visible copy: r Perfume Duo × Quick view of {{ product_title }}
  - fixture: /products/coastal-cottage-hair-perfume-duo — visible copy: Add to cart × Quick view of {{ product_title }}
  - fixture: /cart — visible copy: cart $0.00 × Quick view of {{ product_title }}

Raised automatically by the daily health-check re-verification. The check
reproduced this issue; it does not propose a fix.
```
