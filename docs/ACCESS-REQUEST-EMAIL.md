# Draft — access request to leadership

Two versions of the same ask: an email for the record, and a short Slack
message for speed. Fill the bracketed names before sending.

The supporting detail lives in [`ACCESS-REQUEST.md`](ACCESS-REQUEST.md) and
[`LIVE-RUN.md`](LIVE-RUN.md) — link them rather than pasting them in.

---

## Version 1 — Email

**To:** [Senior Director of Technology]
**Cc:** [Manager], Sufian
**Subject:** 15 minutes of admin time to unblock Welcome Kit + translation QA verification

Hi [Name],

**The ask:** please allow outbound HTTPS from our QA automation environment to
three hosts — `www.mykitsch.com`, `mykitsch.com`, `cdn.shopify.com`. Read-only
browsing, no credentials involved. It is a configuration change on the
automation environment, not a change to the store.

**Why it matters now.** The summer and spring Welcome Kits are live. We have
been asked to confirm they handle free items exactly like the Winter Welcome
Kit Combos — whether the free kit auto-adds at $0, stays out of the subtotal,
survives to the order summary, and is removed when the qualifying product is
removed. The automation that answers this is written, tested and ready. It
cannot reach the storefront, so **we currently have no automated confirmation
either way.** Every run so far has been against a local mock, which proves the
tool works and proves nothing about the store.

The same block also stops the translation suite from checking the seven live
locales, which was the original Phase 2 commitment.

**What I have already tried,** so this is not a first resort: the session
proxy with and without explicit configuration, a different browser mode, and a
stealth/user-agent setup in case the store was rejecting automated traffic. It
is none of those. Our egress gateway answers `403 Forbidden` to the connection
request itself, before anything reaches Shopify — and it does the same for
unrelated public sites, so it is a general policy rather than anything about
mykitsch.com. Full evidence in the linked doc.

**What I am not asking for:** no write access to any store, no payment
credentials, no customer or order data, no production Shopify admin, and no
general internet access. Three named hosts is enough. The suite browses
product pages, adds to cart and reads the order summary; it never completes a
purchase.

**One dependency alongside it.** Once we can reach the site, the checks need
to recognise the theme's markup. The durable fix is a small set of
`data-testid` attributes on the Welcome Kit and cart templates — a one-line
theme change that buys permanent stability, and the standing request in the
framework proposal. If that is not quick, 30 minutes with someone from the
storefront team to map the existing classes will do for now.

**After that,** verification is a ten-second command, and the output is either
"all three seasonal kits match winter" or a per-dimension list of exactly what
differs — in a form I can send straight to marketing.

Happy to walk through it live, or to run it with someone watching once access
is in place.

Thanks,
Kuruva
QA Analyst — Automation

---

## Version 2 — Slack

> Hi [Name] — small ask that unblocks something with a deadline attached.
>
> Our QA automation environment can't reach mykitsch.com. Our egress gateway
> refuses the connection (403) before it ever gets to Shopify — it does the
> same for any external site, so it's a general policy, not anything about our
> store. I've ruled out the usual suspects (proxy config, browser mode, bot
> detection).
>
> **Ask:** allow outbound HTTPS to `www.mykitsch.com`, `mykitsch.com` and
> `cdn.shopify.com` from the automation environment. Read-only, no
> credentials, no writes.
>
> **Why now:** the summer and spring Welcome Kits are live and we have no
> automated confirmation that their free-item handling matches the winter kit.
> The check is built and tested — it just can't see the site. Same block stops
> the 7-locale translation checks.
>
> Detail here: `docs/ACCESS-REQUEST.md`. Who owns that config?

---

## Notes for sending

- **Lead with the ask, not the diagnosis.** The technical detail is
  interesting to us and not to them; it belongs in the linked doc.
- **Name the decision.** "Who owns that config?" gets a faster answer than a
  general request for help, because it converts the ask into a routing
  question.
- **Keep the "not asking for" list.** A bounded request approves faster than
  an open one, and every exclusion in it is genuinely enforced in the code.
- **Do not overstate.** We do not know that the kits are broken. We know we
  cannot confirm they are correct. Those are different claims and the second
  one is the honest one.
- **Mention the `data-testid` ask in the same thread.** It needs a different
  team, and raising it later reads as a second interruption.
