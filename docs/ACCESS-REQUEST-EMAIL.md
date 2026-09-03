# Problem statement — what needs to be resolved

For the Senior Director of Technology, who asked: *what needs to be resolved
for it to reach the live site?*

**The short answer has changed since the last draft.** Nothing about the
network needs resolving. The earlier version of this document asked for a
firewall allowlist; that ask is withdrawn and should not be actioned. See
"What changed" below — the correction is worth stating out loud, because the
first answer was wrong in a way that would have cost someone a ticket.

Fill `[Name]`; `[X]` marks a number I do not have.

---

## 1. The statement

**It already can reach it.**

The automation runs on my own machine, on a normal internet connection — no
VPN, no corporate proxy in the path. `mykitsch.com` is a public storefront.
Playwright opens it the same way a browser does. There is no gateway between
the two, so there is nothing to open.

**What is actually unresolved is that the automation cannot yet *read* the
pages it reaches.**

The suite finds things on a page by their element identifiers — this is the
price, this is a cart line, this is the free-gift selector. It was built
against a local mock of our site, and the mock uses identifiers I invented.
Our live Shopify theme uses its own. Pointed at the real store today, the
checks connect fine and then report "I could not find the price" instead of
"the summer kit prices the free item differently from winter".

That is the whole gap. It is a mapping exercise, not an access problem.

**To resolve it:** 30 minutes with someone from the storefront team, walking
the welcome-kit and cart templates so I can write down what each element is
actually called. The mapping lives in a config file, so it is an edit, not a
code change. Better and more durable, if they will take it: a handful of
invisible `data-testid` labels added to those templates, which survive
restyling — theme class names regenerate on every deploy, so anything I map
today breaks on the next design change.

**Two things behind it, not blocking:**

- A **read-only** Shopify Admin API token (`read_translations`,
  `read_products`, `read_online_store_pages`). Only needed for the exhaustive
  translation check — comparing every translatable string across all seven
  locales, including on pages nobody thinks to open. The browser checks do
  not need it.
- A decision on **where this runs long-term**, covered in §3. Related to the
  token, and the reason I am not just asking for the token.

---

## 2. What changed, and why I am correcting myself

I previously reported that the automation was blocked from reaching our site
and drafted a request to allowlist three hosts. That diagnosis was real but
misattributed: the block belonged to the sandboxed environment I was
*authoring* in, which denies general web access by policy. It is not our
network, and it is not the environment the suite runs in.

The measurement was sound — connections refused at the gateway, identical for
every external host, unaffected by browser configuration. The inference from
it was not. I am flagging it rather than quietly deleting the draft, because
an allowlist request would have consumed someone's time to change nothing.

The consequence for how you read the current results is unchanged, and this
is the part that still matters: **every number this suite reports today came
from the local mock.** The tooling is proven; the store is unexamined.

---

## 3. The question I would rather you answer than the token request

The automation currently lives on my personal machine. That was right for
building it. It is not right for a pre-release gate:

- It runs when I remember to run it, and stops existing when I am away.
- Results from an unmanaged machine are testimony, not evidence — nobody else
  can reproduce them.
- Any credential the checks need would have to sit in a file on that machine,
  outside device management, rotation or revocation.

The repository already has CI running the offline layers. Pointing it at the
storefront is configuration, not development, and the API token would then
live as a repository secret and never touch a laptop.

So: **should this move to CI now, or stay local until the selector mapping is
done?** If CI, the token question resolves itself and I will stop asking for
one locally.

---

## 4. Email

**To:** [Name], Senior Director of Technology
**Subject:** Live-site automation — what's actually blocking it

Hi [Name],

Correcting something I told you, and then the real answer.

**The correction.** I said the automation could not reach our site and asked
for a firewall change. That was wrong — the block I measured was in the
sandboxed environment I build in, not on our network. The automation runs on
my own machine on a normal connection, and mykitsch.com is a public website,
so it reaches it fine. Please drop that request if it went anywhere.

**What is actually blocking it.** The automation can open our pages but
cannot yet read them. It finds things — a price, a cart line, the free-gift
selector — by element identifiers, and it was built against a local copy of
the site using identifiers I made up. The real theme uses its own. So today it
connects and then reports "couldn't find the price" instead of "the summer kit
handles the free item differently from winter".

**What resolves it.** 30 minutes with someone from the storefront team to walk
the welcome-kit and cart templates so I can map what each element is really
called. It is a config edit afterwards, not development. If they are willing,
adding a few invisible labels to those templates is the version that does not
break every time the site is restyled.

**Behind that,** and not blocking: a read-only Shopify API token for the
exhaustive translation check, and a decision on whether this should move to CI
rather than living on my laptop. I would rather ask the second question first —
if it moves to CI, the token lives as a repository secret instead of in a file
on a personal machine, which I think is the right answer anyway.

**Where that leaves us today.** Everything built so far is verified against a
local copy of the site. That proves the tooling works and says nothing about
the real store — so we are still signing off releases on manual spot-checks
([X] hours per cycle), and the welcome-kit question is genuinely unanswered
rather than answered green.

Happy to demo it in five minutes, or to run it with you watching once the
selectors are mapped.

Thanks,
Kuruva
QA Analyst — Automation

---

## 5. Slack

> Hi [Name] — correction on what I told you about the automation. It can
> reach mykitsch.com fine; the block I hit was in my build environment, not
> our network. Ignore the firewall ask.
>
> The real blocker: it opens our pages but can't read them yet. It finds
> prices and cart lines by element names, and it was built against a mock
> using names I invented — the live theme uses its own. So it connects, then
> says "couldn't find the price" instead of answering the kit question.
>
> Fix is 30 mins with someone from the storefront team to map the real
> element names on the welcome-kit and cart templates. Config edit after
> that, no dev work. Can you point me at the right person?

Shorter:

> Hi [Name] — the automation can reach the site fine (my earlier firewall ask
> was wrong, please ignore it). What it can't do is read the pages: it looks
> for elements by names from our local mock, and the real theme uses
> different ones. Need 30 mins with someone on the storefront team to map
> them. Who owns the theme templates?

---

## 6. If asked "are you sure it's not the network?"

> Yes. The failure I originally reported came from the sandboxed environment
> I author in, which blocks all outbound web access by policy — the same error
> appeared for unrelated public sites, which is what gave it away. On a normal
> machine there is no gateway in the path at all; mykitsch.com is a public
> storefront reached the same way any browser reaches it.
>
> `npm run preflight` distinguishes the cases explicitly: it prints whether
> the site was unreachable, whether a product handle failed to resolve, or
> whether a selector matched nothing. From a normal machine it reports
> reachable, then lists the selectors needing mapping. Evidence in
> `docs/LIVE-RUN.md`.

---

## Notes

- **Lead with the correction.** It is short, and burying it means the
  allowlist ticket stays open.
- **Do not overstate.** We are not claiming anything is broken on the store.
  We are saying we cannot confirm anything is right — the honest claim, and
  the more uncomfortable one to leave standing.
- **Ask the CI question before the token question.** A credential on an
  unmanaged personal machine is a decision someone should make deliberately,
  and the better answer removes the need for it.
- **Keep the exclusions list.** Every boundary claimed is enforced in code:
  no writes, no purchases, no admin console, no customer data.
