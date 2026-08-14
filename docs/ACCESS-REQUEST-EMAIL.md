# Draft — access request

One recipient: the Senior Director of Technology, who is also the reporting
manager. The ask is about the automation programme as a whole, not any single
check, so it does not need re-writing each time a new test is added.

Three registers: email, Slack, and an IT ticket for whoever implements it.
Fill `[Name]`; `[X]` marks a number I do not have.

---

## 1. Email

**To:** [Name], Senior Director of Technology
**Subject:** Request: network access for the QA automation environment

Hi [Name],

I need a small access change to make the QA automation useful, and it needs
your approval or a pointer to whoever owns it.

**The situation.** The environment our test automation runs in has no access
to our own website. Everything we have built so far has been validated against
a local copy of the site. That confirms the tooling works; it tells us nothing
about the real store.

**Why it matters.** The point of this programme is to replace repetitive
manual QA passes with checks that run automatically before every release.
Until the automation can actually reach the site, none of that manual work can
be retired, and every check we write remains unproven against reality. We are
still signing off releases on manual spot-checks, which is what we set out to
change ([X] hours per cycle).

It also means that when something is asked of us at short notice — is this
page right, does this product behave like that one, is this market translated
— the answer still takes a person a day rather than a command a few seconds.

**The ask.** Allow our QA automation environment to reach our storefront:

```
www.mykitsch.com
mykitsch.com
cdn.shopify.com
```

Read-only, the same access any visitor with a browser has. It is an allowlist
change on our infrastructure, not a change to the store, and it involves no
passwords or logins.

**Boundaries, to be clear about scope.** This gives no ability to change the
store, its products or its prices; no payment details and no test that ever
completes a purchase; no customer or order data; no Shopify admin access; and
no general internet access beyond those addresses.

**One thing worth pairing with it.** For the automation to read our pages
reliably, the storefront team would need to add a few invisible labels to the
theme templates — a small, one-off change that keeps the tests stable when the
site is restyled. Without it the tests work but need re-fixing after every
design change. Could I get 30 minutes with someone from that team in the same
window?

**Once both are in place,** checks that currently take a person hours become a
command that runs in seconds, on a schedule, before every release — and the
results are specific enough to hand straight to whoever needs to act on them.

Happy to demo what is built in five minutes, or to run it with you watching
once access is on.

Thanks,
Kuruva
QA Analyst — Automation

---

## 2. Slack

> Hi [Name] — our QA automation environment can't reach mykitsch.com. It has
> no outside access at all, so everything we've built has only ever run
> against a local copy of the site. Means we can't retire any of the manual QA
> passes yet.
>
> Can we allow it to reach `www.mykitsch.com`, `mykitsch.com` and
> `cdn.shopify.com`? Read-only, no logins, can't change anything on the store.
>
> Is that yours to approve, or should I raise it somewhere?

Shorter, if the context is already understood:

> Hi [Name] — can we give the QA automation environment access to
> `www.mykitsch.com`, `mykitsch.com` and `cdn.shopify.com`? Read-only, no
> logins. Right now it can't reach the site at all, so the tests only run
> against a local copy. Yours to approve, or should I raise a ticket?

---

## 3. IT ticket

**Title:** Egress allowlist — QA automation environment to Kitsch storefront

| Field | Value |
|---|---|
| **Requested by** | Kuruva Dinesh, QA Analyst — Automation |
| **Source** | QA automation environment / CI runner for `KitschAutomation` |
| **Destinations** | `www.mykitsch.com`, `mykitsch.com`, `cdn.shopify.com` |
| **Protocol / port** | HTTPS, TCP 443, outbound only |
| **Direction** | Egress only; no inbound access required |
| **Authentication** | None — anonymous, unauthenticated browsing |
| **Data written** | None; read-only, never completes a transaction |
| **Data read** | Public storefront pages only, as any visitor sees them |
| **Duration** | Ongoing — this becomes a scheduled pre-release check |
| **Current behaviour** | Connections refused by the egress gateway before reaching the destination; identical for all external hosts, so it reads as default-deny rather than a rule about this domain |
| **Justification** | Automated pre-release verification of live pages; replaces recurring manual QA |
| **Verify after change** | `KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight` |

`cdn.shopify.com` is included because the storefront serves its images,
stylesheets and scripts from there; without it pages load without layout and
visual checks cannot mean anything.

---

## 4. If asked what was already tried

Hold this back unless invited — it answers "did you just misconfigure it?",
which is not the opening question.

> The outbound gateway refuses the connection as it is opened, before anything
> reaches the site. The same happens for unrelated public websites, so it is a
> general default-deny policy rather than anything about our store.
>
> Before escalating I ruled out the usual causes: proxy settings with and
> without explicit configuration, a different browser mode, and a setup that
> disguises automated traffic in case the site was rejecting it. The failure is
> identical in every case and occurs at the network layer, so nothing
> configurable on our side changes it. Evidence in `docs/LIVE-RUN.md`.

---

## Notes

- **Keep it programme-level.** The ask is about the automation environment, not
  any one test. Framing it around a single feature invites a one-off exception
  instead of a standing fix, and the next request starts from zero.
- **Name the decision.** "Who owns that config?" is faster to answer than a
  general request for help.
- **Keep the boundaries list.** A bounded ask approves faster, and every
  exclusion in it is genuinely enforced in the code.
- **Do not overstate.** We are not claiming anything is broken. We are saying
  we cannot confirm anything is right — which is the honest claim, and the more
  uncomfortable one to leave standing.
