# Draft — access request to leadership

Four registers of the same ask. Send the one that matches the audience.

1. **Email to leadership** — business framing, no jargon. Start here.
2. **Slack** — same ask, five lines.
3. **IT / DevOps ticket** — the actual rule, for whoever implements it.
4. **If they ask "what did you already try?"** — the technical answer, held back
   until it is wanted.

Fill the bracketed items before sending. `[X]` marks a number I do not have.

---

## 1. Email to leadership

**To:** [Senior Director of Technology]
**Cc:** [Manager], Sufian
**Subject:** Request: network access for QA automation — blocking verification of the live Welcome Kits

Hi [Name],

I need a small access change to finish something that is currently sitting
half-done, and it needs your sign-off or a pointer to whoever owns it.

**The situation.** We built automation to check that our seasonal Welcome Kits
behave the same way as the Winter kit — specifically that the free items in
them are given away correctly rather than accidentally charged for, dropped,
or left in a customer's basket when they should not be. It is finished and
working.

The problem is that the environment it runs in has no access to our own
website. It has been tested against a copy of the site, which tells us the
tool works but tells us nothing about the real store.

**The impact.** The Summer and Spring kits are live and selling now. We cannot
confirm, automatically, that their free-gift handling matches the Winter kit.
That leaves two risks on the table:

- **A free item that quietly charges.** A customer is promised something free
  and is billed for it. That is a refund, a support ticket, and a review.
- **A free item given away when it should not be.** Straight margin loss,
  invisible until someone reconciles it.

Neither is hypothetical — they are the exact failure modes the check was
written to catch. Right now the only way to rule them out is by hand, which is
the manual work this automation was meant to retire ([X] hours per launch).

The same access gap also stops us checking our seven international storefronts
for missing or broken translations, which was the main commitment for this
phase.

**The ask.** Allow our QA automation environment to reach three web addresses:

```
www.mykitsch.com
mykitsch.com
cdn.shopify.com
```

This is read-only — the same access a person with a browser has. It is a
firewall/allowlist change on our side, not a change to the store, and it needs
no passwords or logins.

**What it is not.** To be clear about the boundaries, this does not involve:

- any ability to change the store, its products, or its prices
- any payment details, and no test that ever completes a purchase
- any customer or order data
- admin access to Shopify
- general internet access — three addresses is enough

**One thing to pair with it.** For the checks to read our product pages
reliably, the storefront team needs to add a few invisible labels to the
Welcome Kit and cart templates — a small, one-off theme change that makes the
automation stable against future design updates. Without it the checks work
but break every time the site is restyled. Could I get 30 minutes with someone
from that team in the same window?

**What happens once both are in place.** Verification becomes a one-command,
ten-second job that we can run before every launch. It returns either "all
three seasonal kits match Winter" or an exact list of what differs and why it
matters — which I can hand straight to marketing.

Happy to demo it in five minutes, or run it live with you watching once access
is on.

Thanks,
Kuruva
QA Analyst — Automation

---

## 2. Slack

> Hi [Name] — quick one, needs a decision or a pointer.
>
> Our QA automation environment can't reach mykitsch.com — it has no outside
> access at all. So the checks we built for the Summer and Spring Welcome Kits
> have only ever run against a copy of the site. The kits are live and selling,
> and we can't currently confirm their free items are handled the same way as
> the Winter kit — i.e. that nothing free is being charged for, or given away
> when it shouldn't be.
>
> **Ask:** allow our QA environment to reach `www.mykitsch.com`,
> `mykitsch.com` and `cdn.shopify.com`. Read-only, no logins, no ability to
> change anything, no payments.
>
> Who owns that config? Happy to raise a ticket if you point me at the queue.

---

## 3. IT / DevOps ticket

**Title:** Egress allowlist — QA automation environment to Kitsch storefront

| Field | Value |
|---|---|
| **Requested by** | Kuruva Dinesh, QA Analyst — Automation |
| **Source** | QA automation environment / CI runner for `KitschAutomation` |
| **Destinations** | `www.mykitsch.com`, `mykitsch.com`, `cdn.shopify.com` |
| **Protocol / port** | HTTPS, TCP 443, outbound only |
| **Direction** | Egress only. No inbound access required |
| **Authentication** | None. Anonymous, unauthenticated browsing |
| **Data written** | None. Read-only; the suite never submits a form that completes a transaction |
| **Data read** | Public storefront pages only — the same content any visitor sees |
| **Duration** | Ongoing (this becomes a scheduled pre-launch check) |
| **Current behaviour** | Connection refused by the egress gateway before reaching the destination; same result for all external hosts, so this reads as default-deny rather than a rule about this domain |
| **Business justification** | Automated pre-launch verification of live product pages; replaces a recurring manual QA pass |
| **Verification after change** | `KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight` — reports success or the precise failure |

`cdn.shopify.com` is included because the storefront serves its images,
stylesheets and scripts from there. Without it the pages load without layout,
and the visual checks cannot mean anything.

---

## 4. If they ask what was already tried

Keep this back unless invited — it is the answer to "did you just not
configure it right?", not an opener.

> The environment's outbound gateway refuses the connection at the point of
> opening it, before anything reaches Shopify. The same happens for unrelated
> public websites, so it is a general default-deny policy rather than anything
> about our store or about Shopify blocking us.
>
> I ruled out the likely alternatives before escalating: the proxy settings
> with and without explicit configuration, a different browser mode, and a
> setup that disguises automated traffic in case the store was rejecting it.
> The failure is identical in every case and happens at the network layer, so
> nothing configurable on our side changes it.
>
> Evidence is in `docs/LIVE-RUN.md` if useful.

---

## Notes for sending

- **Lead with the business risk, not the diagnosis.** "A free item that quietly
  charges" lands; "403 on CONNECT" does not.
- **Name the decision.** Asking "who owns that config?" converts the request
  into a routing question, which is faster to answer than a favour.
- **Keep the "what it is not" list.** A bounded request approves faster, and
  every exclusion is genuinely enforced in the code.
- **Do not overstate.** We do not know the kits are wrong. We know we cannot
  confirm they are right. The drafts say the second thing — which is the honest
  claim and, if anything, the more urgent one.
- **Pair the theme-labels ask with it.** It needs a different team; raising it
  a week later reads as a second interruption.
