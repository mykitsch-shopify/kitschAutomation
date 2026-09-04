# Top-10 daily check — 2026-09-04

- target: https://www.mykitsch.com
- listed: 10 products
- checked: 10 (the rest have no handle in config/top-products.yaml)
- checks: availability, add_to_cart, title, description, images, videos, pricing, specifications, variations, discount_stacking

| severity | count |
|---|---|
| critical | 10 |
| major | 0 |
| minor | 2 |
| harness (our own gaps, not store defects) | 11 |

## Products checked

| product | HTTP | price | images | variants |
|---|---|---|---|---|
| Rice Water Shampoo & Conditioner Combo for Hair Growth | 200 | $28.00 | 11 | — |
| Rice Water Shampoo Bar for Hair Growth | 200 | $16.00 | 9 | — |
| Self-Draining Soap Dish | 200 | $16.00 | 5 | — |
| Shea Butter Exfoliating Body Wash | 200 | $14.00 | 9 | — |
| Kojic Acid Hyperpigmentation Face and Body Bar | 200 | $18.00 | 9 | — |
| Bottle Free Beauty Travel Case | 200 | $12.00 | 5 | — |
| Rosemary Scalp & Hair Strengthening Oil With Biotin | 200 | $15.00 | 11 | — |
| Shampoo Bar Bag | 200 | $5.00 | 5 | — |
| Rice Water Conditioner Bar for Hair Growth | 200 | $16.00 | 9 | — |
| Rosemary & Biotin Volumizing Shampoo & Conditioner Combo | 200 | $28.00 | 15 | — |

## Cart

- subtotal: not readc
- discounts: 0c
- total: not readc
- codes applied: none

## critical — 10

- **Rice Water Shampoo & Conditioner Combo for Hair Growth** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Rice Water Shampoo Bar for Hair Growth** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Self-Draining Soap Dish** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Shea Butter Exfoliating Body Wash** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Kojic Acid Hyperpigmentation Face and Body Bar** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Bottle Free Beauty Travel Case** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Rosemary Scalp & Hair Strengthening Oil With Biotin** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Shampoo Bar Bag** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Rice Water Conditioner Bar for Hair Growth** (add_to_cart) — clicking add-to-cart did not put a line in the cart
- **Rosemary & Biotin Volumizing Shampoo & Conditioner Combo** (add_to_cart) — clicking add-to-cart did not put a line in the cart

## minor — 2

- **Self-Draining Soap Dish** (specifications) — specifications block holds 11 characters — a heading with nothing under it
- **Shampoo Bar Bag** (specifications) — specifications block holds 11 characters — a heading with nothing under it

## harness — 11

- **Rice Water Shampoo & Conditioner Combo for Hair Growth** (variations) — variant options were not observed
- **Rice Water Shampoo Bar for Hair Growth** (variations) — variant options were not observed
- **Self-Draining Soap Dish** (variations) — variant options were not observed
- **Shea Butter Exfoliating Body Wash** (variations) — variant options were not observed
- **Kojic Acid Hyperpigmentation Face and Body Bar** (variations) — variant options were not observed
- **Bottle Free Beauty Travel Case** (variations) — variant options were not observed
- **Rosemary Scalp & Hair Strengthening Oil With Biotin** (variations) — variant options were not observed
- **Shampoo Bar Bag** (variations) — variant options were not observed
- **Rice Water Conditioner Bar for Hair Growth** (variations) — variant options were not observed
- **Rosemary & Biotin Volumizing Shampoo & Conditioner Combo** (variations) — variant options were not observed
- **(cart)** (discount_stacking) — cart subtotal or total could not be read; cart maths not verified
