---
name: kitsch-lp-qa
description: Daily QA of ad-traffic landing pages on mykitsch.com — Welcome Kits, BYOB builders, discount redirects (WELCOMEKIT, 6reasons, FREECADDY), non-stacking discount logic, auto-ship pricing, compare-at accuracy, and the thermal-roller out-of-stock redirect. Covers Asana 1218024537034778 and 1218024873228422. Use for "LP QA", "landing page QA", "discount QA", "daily ad QA", or the daily first-thing-each-morning storefront pass.
---

# Landing-page and discount QA

Covers Asana [1218024537034778](https://app.asana.com/0/0/1218024537034778) and
[1218024873228422](https://app.asana.com/0/0/1218024873228422). Both say "must
be QA'd first thing each day" because these pages are where paid traffic lands
— a broken one spends ad budget showing a customer something wrong.

**Do not paste the task description.** The scope below is that description,
already transcribed. Read the Asana task only when you need comments or
attachments the automation cannot see.

## Run

```bash
set "KITSCH_BASE_URL=https://www.mykitsch.com"
npm run audit:ad-landing
npm run audit:compare-at
```

Scope lives in `config/ad-landing.yaml`. Adding a kit or a code is an edit
there, never a code change.

## Scope

**Welcome Kits** — Spring (Rosemary, Castor Oil, Coconut Oil, Rice Water);
Summer (Rosemary, Rice Water, Rosemary Bar, Rice Water Bar, with Shampoo &
Conditioner, with S&C Bars); Winter Combos (Rosemary & Biotin, Castor Oil,
Coconut Oil, Rice Water); Shampoo & Conditioner Combo with Free Welcome Kit;
Shampoo & Conditioner Bundle with Free Welcome Kit.

**BYOBs** — Hair Routine Bundle; Hair Perfume Duo; FREE Bottle Free Beauty
Travel Case; FREE Self Draining Soap Dish Bundle; S&C with FREE Self-Draining
Shower Caddy; Hair Care Bundle + FREE Caddy; Haircare To-Go Bundle; Bar & Scent
Bundle; FREE Wet Dry Brush.

**High-traffic URLs** — Hair by Chrissy x Kitsch Ceramic Thermal Rollers 8pc
Set; Kitsch x Hair by Chrissy Bundle; Ceramic Thermal Roller Variety Pack;
Travel Case Bundle; Kojic Acid Face and Body Bar + FREE Eco-Friendly
Dermaplaner; the top-10 best sellers (see `kitsch-top-sellers`).

**Discount redirects** — `/discount/WELCOMEKIT?redirect=/products/shampoo-conditioner-bundle-with-free-welcome-kit`,
`/discount/6reasons?redirect=/products/free-soap-dish-bundle`,
`/discount/FREECADDY?redirect=/products/shampoo-conditioner-bundle-with-caddy`.

## What to check

| Check | Automated | Note |
|---|---|---|
| Discount redirect resolves to the right product | Yes | |
| Non-stacking on the three fixed-discount products | Yes | These must NOT stack with a site-wide offer |
| Auto-ship pricing matches what is live *now* | Yes | Never assert a fixed figure — derive from the live sitewide % |
| Compare-at / strikethrough accuracy | Yes | `npm run audit:compare-at` |
| BYOB builder loads and works | **No** | Needs a browser driving the builder |
| Thermal-roller OOS redirect | Partly | Only observable while actually out of stock |
| Promo-code application | **No** | Only real checkout entry is conclusive — see below |

## Rules that prevent false alarms

**Never assert a fixed price.** The sitewide discount changes every few days.
Read the live percentage first and derive every expectation from it.

**BYOB parent containers are deliberately unpurchasable.** A parent
add-to-cart returns 422. That is the guard working. Test via child products.

**Container products show 0% off.** Welcome Kit parents display their own
price; the real price comes from the child selection. $58/$58 is expected.

**Compare-at on a BYOB is a configuration ceiling, not a discount base.** Never
derive a percentage from `price ÷ compare_at` on a free-choice bundle. Validate
component prices in the cart instead.

**Resolve handles by testing the URL, never against a product list.**
`/collections/all` excludes UNLISTED products, so most Welcome Kit children
look dead when they aren't. This caused two false escalations.

**`.js` does not follow redirects.** A legacy handle can 404 on
`/products/x.js` while `/products/x` 301s and serves fine.

**Promo codes cannot be validated by URL.** `/discount/CODE` plus the AJAX cart
does not apply them — proven against six codes including a native Shopify one,
all returning `applicable: false`. Report as **not verified**, never as passing.

## Reference sheets

Auth-gated, so the automation cannot read them. Check by hand when a price
disagrees:

- BYOB / Welcome Kit pricing — `docs.google.com/spreadsheets/d/13fe5u5dthCXRIFhsAlpDvI-J8eomsQgwT0l4BQFeW9Q`
- Active codes — `docs.google.com/spreadsheets/d/1N4naVLYaadoNr8W6yfOfws26OH08qM6KUxJr2R3gxaQ`
- Builder sequence — three Loom recordings on Asana 1218024873228422

## Reporting

Follow `kitsch-qa-report`. A finding goes to the team only after the
could-not-check / is-broken split; anything the run could not reach goes under
**Not verified**, never omitted.
