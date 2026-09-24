# The shop under test

## Nothing here is assumed

The theme runs under several setups: the Flashlight image, the official PrestaShop image, a plain
web server. So the skill assumes no container name, no port, no admin folder and no database
access. Every one of those is asked for, or read from a file that declares it.

A guessed address answers 404, which reads exactly like a broken page. A false red costs more
than an admitted gap.

## Versions, read rather than asked

| What | Where it is written |
| --- | --- |
| the theme version, and the PrestaShop versions it supports | `version` and `compatibility` in `config/theme.yml` in the checkout |
| what the shop actually installed | `config/themes/hummingbird/shop1.json` at the shop root, one file per shop |
| the PrestaShop version being served | the shop itself, or the tag in the compose file if it declares one |
| module versions | `composer show` in the PrestaShop checkout |

**Stop before starting** if the theme under test falls outside the PrestaShop range it declares.
Every result would be about a combination nobody supports, and reporting them as defects of the
theme would be wrong.

A theme carries two versions on purpose: what the checked-out code claims, and what the shop
installed. After a checkout they disagree, and the back office offers to update the theme. Say
which one the campaign is about.

## Builds and caches

The theme's compiled CSS and JavaScript are not in git, so switching git refs changes the sources
and leaves the built files exactly as they were. Anything under `src/` needs the build run again.
Templates recompile themselves and need nothing.

This matters most when comparing against an older theme version: **check the older build actually
succeeded** before believing anything it shows. A build that failed quietly gives an unstyled
shop, where every visual problem looks like it was always there.

Twig, PHP and YAML changes need the cache cleared. The silent one is the PHP opcode cache: with
timestamp checking off, common in production-shaped containers, the new file lands on disk and
never reaches the browser.

The developer owns `git`. Everything downstream of a checkout, the build, `composer install`,
`cache:clear`, this skill offers to run.

## Reading the shop settings

`fingerprint.js` runs a read-only command you give it, so nothing about the setup is assumed:

```bash
export QA_SQL='docker exec -i <db container> mariadb -u<user> -p<password> <database> -N -B'
node "$SKILL_DIR/scripts/fingerprint.js" --out="$RUN/baseline/settings.json"
```

**The command goes in the environment, like the back office credentials.** A command line is
readable by every other user on the machine, and the skill prints the commands it is about to run,
so an argument also lands in the transcript and in any log that gets pasted. `--sql=` stays for a
command that carries no secret.

It finds the table prefix from the database rather than assuming one, reads every setting, and
hashes them. **The command is never written to any file**, because it carries a password.

Plenty of tables end in `configuration` without being a shop's: `ps_smartblog_configuration` is a
module's. So each candidate is checked for the rest of a shop behind it, a matching `shop_url`
table, and only a real second shop makes it refuse. Two shops in one database means the reading
could be about either, and a fingerprint of the wrong shop still comes out green: point the command
at one database, or pass `--prefix=ps_`.

`baseline/settings.json` holds the merchant's email address and can hold credentials. It stays in
the campaign folder. What travels is the fingerprint and the names of settings that moved, never
their values.

Before each new section:

```bash
export QA_SQL='[the same read-only command]'
node "$SKILL_DIR/scripts/fingerprint.js" --compare="$RUN/baseline/settings.json"
```

`QA_SQL` is exported again because every command runs in a fresh shell. Without it the script
prints its usage and exits, which reads like a check that passed and is a check that never ran.

It exits 0 when the shop is the one measured before, and 1 when it has moved, naming what moved.
A move nothing in the journal explains means results either side are not about the same shop:
stop rather than carry on.

**Nothing is ignored by default.** Measured on a running shop, ordinary browsing moves no setting
at all, so a guessed list of "settings that move by themselves" would only have hidden real
drift. If a reading reports something that moved with nobody touching it, add it to the
campaign's own ignore file with the reason, and it appears in the report as a stated exception.

## The toolkit that ships with the checklist

Before building anything, read the whole of `docs/qa/` at the ref the checklist came from. The
checklist is documentation for a toolkit, and a campaign that reads only the markdown rebuilds —
badly — what is already sitting next to it. On the Hummingbird checklist that is:

```bash
# the shop root is the working directory, and the scripts live outside the checkout
docker exec -u www-data -w /var/www/html <php container> php /tmp/hb-qa/seed.php --status
docker exec -u www-data -w /var/www/html <php container> php /tmp/hb-qa/config.php --get PS_CATALOG_MODE
node docs/qa/bem-inventory.mjs --block product
```

* **`seed.php`** brings a demo install up to the state the checklist assumes: `--status` says what
  is missing, `--apply` makes it, `--undo` puts back everything that can be put back. It is
  idempotent and goes through PrestaShop's model classes, so search indexes, image types and
  friendly URLs stay consistent — which raw inserts do not.
* **`config.php`** reads and writes one setting through the Configuration API the back office
  itself calls, and prints the value read back rather than the value asked for. Section 4 is
  twenty-four settings to flip and restore; driving twenty-four back office forms for that is
  slower and far more brittle, and a campaign that cannot put a setting back is worse than one
  that never changed it.
* **`bem-inventory.mjs`** prints the theme's real class names out of its templates and
  stylesheets. Read it before writing a selector.

Run `seed.php --status` before agreeing the run with anyone. What it reports missing is the
difference between a campaign that answers the checklist and one that spends its report
explaining that the shop could not answer it.

## Making up data to test with

**Use the seeder first.** Everything below applies to what it does not cover.

A good part of the checklist cannot be answered on an empty shop. The You might also like block
does not render without a linked accessory. Cross-selling and best sellers need order history.
The vouchers page needs a cart rule that applies to the customer. Reviews need reviews. So the
campaign may create what a point needs, under four rules.

**Look before making anything.** A demo install already carries most of it. Counted on one:
around twenty active products, half of them with combinations, a pack, virtual products,
specific prices so the discounts page has something on it, a handful of orders so best sellers
and cross-selling work, a cart rule, product reviews, and a customisation field. What is usually
missing is narrow: no linked accessories, so the accessories block cannot render at all, and no
merchandise returns. Creating a product to test a listing that already has twenty is work that
buys nothing and changes the shop for every section that follows.

**Make it through the shop's own path**, the back office or the front office, not by writing to
the database. A product inserted straight into the tables has no search index entry, no generated
image sizes, no position in its category and no friendly URL, and the theme then looks broken
when it is not. That is a false red, which costs more than the point it was meant to answer.

**Give it a name anyone can recognise**, `QA` and what it is, so somebody opening the shop in a
month can tell which records are not theirs.

**Write it down before making it**, exactly like a setting, and end it one of two ways:

```js
const f = fixtureCreated({
  what: 'a linked accessory on the Hummingbird printed t-shirt',
  how: 'back office, Catalogue > the product > Related products',
  id: 'QA-acc-1',
  why: '3.4/07, the You might also like block, which does not render without one',
});
// ... the checks that needed it ...
fixtureRemoved(f, stillThere);          // read it back, do not assume
```

Some records cannot be taken away. An order is not un-placed, and a review that has been through
moderation does not go back. Those are left on purpose, and say so:

```js
fixtureLeft(f, 'an order cannot be un-placed without leaving the shop inconsistent');
```

A record that is neither removed nor deliberately left stops the report from building. That is
the point: the alternative is a shop quietly carrying invented data that the next campaign reads
as real.

**Made-up data changes other points.** A new product changes every listing count and the
pagination, and it breaks the checks for an empty listing and for a listing with a single
product. So make the narrowest thing that answers the point, as late in the campaign as it can
be made, and prefer changing an existing product to adding one.

The report lists everything that was made up, why it was needed, and whether it is still there.

## Putting a setting back

**Prefer the setting to the form.** Where a point names a configuration key, write it with
`config.php --set NAME=value`, which prints what the value reads afterwards, and keep the browser
for the front-office half of the point. Back office forms are worth driving only when the point is
about the form. Driven forms fail in ways that are quiet and specific to each page: a Save with no
`type` attribute so `button[type="submit"]` matches nothing, a real submit named `[submit]` while a
button matched by the word "Save" belongs to another dialog, a Bootstrap switch whose click does
not register, a country select that re-renders the form and discards what was typed, a switch that
clears a companion field so the restore is refused. Each of those turns into a setting reported as
having no effect when it was never saved — or worse, a setting left changed.

Whatever writes it, **read the value back from a freshly loaded page**, never from the DOM that was
just edited: a form that failed to save still shows what was typed into it.

A change is written down **before** it is made, so a run that dies in the middle still leaves a
record of what to undo. Afterwards the value is read again, and a restore nobody could confirm
counts as a failure, not a success.

When it cannot be put back, the reset is to reinstall the shop. The compose files in the theme
repository erase and reinstall on the way up, so a clean shop with the demo catalogue is one
command. Say in the report that a reset happened: orders and customers from before it are gone,
so results either side were measured on different shops even when the settings match.

**B2B mode belongs to the campaign, not to a section.** It is a shop-wide switch, so every
ordinary-customer cell runs, it is flipped once, then every B2B cell runs. A campaign that flips
it per section strands the shop in the wrong mode on the first crash.
