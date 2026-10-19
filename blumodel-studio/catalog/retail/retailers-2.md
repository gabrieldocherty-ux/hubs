# Retail research, round 2 (checked 2026-10-16)

`retailers-2.json` adds 268 products to the 190 in `retailers.json`. Same schema, group `retail-retailers-2`. No key or store SKU repeats round 1 (a build script dropped 7 rows whose store SKU, or key, was already there). Round 1 used different keys for some of the same Home Depot items, so a merge step should join by store SKU, not key.

## What was verified, and how

| Source | How it was read | What it gave |
|---|---|---|
| Structube (14 products) | Public product pages fetched | Price, item number, W x D x H, colours, materials. Confidence `high`. |
| Home Depot Canada, RONA, Home Hardware, Best Buy | Search results and snippets only. The sites return 403 or time out on automated fetches, and no workaround was tried. | Width, height, depth, finish and model from the product title and URL, SKU from the URL. Confidence `medium`. |
| Tasco, Leon's, Tepperman's, Canadian Appliance, CANEX, Handy Appliances | Search snippets | Dishwasher prices and models where the chains did not appear. Several pages are flagged discontinued or have expired sales. |
| Wayfair.ca, Canadian Tire | Search snippets | Stools and pendants. Confidence `low`; Wayfair gives no model numbers. |

Counts by kind: 27 hoods, 25 sinks, 25 dishwashers, 23 ranges, 23 pendants, 22 stools, 21 faucets, 15 fridges, 14 pulls, 9 knobs, 1 microwave, 63 cabinets (15 base, 4 drawer base, 1 sink base, 9 corner, 24 wall, 10 tall).

## What could not be verified

- **No UPCs.** Every `upc` is null. Retail pages that were reachable did not show one.
- **Most depths and heights are null.** Appliance, hood, sink and faucet titles give the width only. Cabinet dimensions come from titles, which for Hampton Bay Edson disagree between pages (34.5 x 24.5 on some, 35 x 25 on others). The title figure is used.
- **Prices are rare.** Only 52 store rows have a number, all search snapshots of unknown date. Null means not seen.
- **Finish hex values are approximate swatches**, not sampled from photos. Some Home Hardware, RONA and EBSU titles name no finish; those carry a placeholder swatch and say so in `notes`.
- **Seat height versus overall height for stools.** Structube stools use the overall height from the page (the "61 cm" in their names is not labelled as seat height, except Denmark, 60 cm). The Home Depot, Wayfair and Canadian Tire stools only have a seat height in the title, so `heightIn` is null and the seat height is in `notes`.
- **Pendants:** `heightIn` is the listed overall height including cable or rod, not a hanging drop. Linear fixtures (Ulani, Flint, Kirun) have the long run as `widthIn`; Structube's page lists those two dimensions the other way round.
- **Knob and pull sizes:** `widthIn` is the diameter for knobs and the overall length for pulls where the listing gave a length. Pull centre-to-centre spacing is in the name and notes. `knob` is a new `kind` not used in round 1.

## Gaps (negative results)

- **HomeSense: nothing.** Searches for homesense.ca returned no Canadian product pages (only US store-locator pages), so no HomeSense stool or pendant is included. Stock there is rotating and the site is not indexed.
- **Pantries at 90-96 in: none found.** Home Depot, RONA and Home Hardware pantry listings stop at 84 to 85 in for kitchen cabinets. The "96 in" hits were toe-kick strips, and 90 in hits were freestanding furniture, which are excluded. The 84 in pantries added are Edson T188424L (18, white and Dusk), T248424L (24), Pembroke 18, Hampton unfinished 18, Thomasville Cavette and Rhett 18, EBSU 15 x 84, Hugo&Borg 18 x 84.5, and the Cristal and San Diego 15 in units.
- **Standard 12-36 in base and wall widths are only partly covered.** Home Depot Edson now has bases at 9, 12, 15, 18, 21, 24 (3 drawer), 30, 36 and walls at 9, 12, 15, 18, 21, 27, 30, 36; RONA adds a few Landon, Eklipse and EBSU units. There is no 24 in Edson wall cabinet and no 33 in sink base in the results.
- **Same-model multi-store coverage is thin.** The chains rarely surfaced for the same appliance model in one search. Only a few dishwashers carry two or three stores (Frigidaire FFCD2413US: Canadian Appliance, Handy, Best Buy; Maytag MDB4949SKZ: Leon's, Tepperman's, Canadian Appliance, RONA). Most appliances list one store.
- **Canadian Tire and Wayfair are thin** (5 and 3 products) because their search results were mostly category pages and a direct Canadian Tire fetch returned a template with no specs.
- **Some hoods, sinks and faucets have no depth or spout data** and cannot be placed with real size until a spec sheet is read.

## Notes for the placement step

- Corner and blind-corner cabinets (Edson CC3635L and BCR36, Eklipse and EBSU 36 in) list width only, so the footprint of the blind return is unknown.
- Items marked "insert" (GE 350 CFM hood insert) have no width.
- The Canadian dealer appliances (CANEX is military-only, in-store) are listed as stores for price evidence, not as retail links the app should push shoppers to.
