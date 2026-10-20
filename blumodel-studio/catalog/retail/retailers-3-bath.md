# Retail research, round 3: bathrooms (checked 2026-10-19)

`retailers-3-bath.json` adds 49 real bathroom products from Home Depot Canada and RONA, for the new
Bath kinds (vanity, toilet, tub, shower, mirror). Same schema as rounds 1 and 2, group `retail-retailers-3-bath`.

| Kind | Count | Brands |
|---|---|---|
| Vanities | 14 | Vanity Art, Glacier Bay, Home Decorators Collection, GEF, Diamond Now, VALU+, Cutler Kitchen & Bath, Fresca |
| Toilets | 10 | TOTO, American Standard, Swiss Madison, Foremost |
| Tubs | 11 | MAAX, KOHLER, Streamline, AGUA CANADA, Vanity Art, Jade Bath |
| Showers | 8 | DreamLine, MAAX, OVE Decors, Glass Warehouse |
| Mirrors, medicine cabinets | 6 | Deco Mirror, MIRRORIZE, Glacier Bay, KOHLER, Aquadom |

## How it was read

Search results and snippets only (web search restricted to homedepot.ca and rona.ca). No product page was
fetched, so confidence is `medium`. Sizes come from product titles; where a title gave none the field is
null and the product places at its type's typical size, marked typical. Toilets never list a width in their
titles, so all ten are placed at the typical 20 x 29 in. footprint (two-piece) and marked typical.
Prices are search snapshots of unknown date; null means not seen. No UPCs.

## Known approximations

- Neo-angle and round corner showers (DreamLine Prism Lux, OVE Breeze) are drawn as square corner showers.
- The Glass Warehouse Vela is a fixed panel with no base; it is drawn as a walk-in shower at the typical depth.
- The KOHLER Archer height is the step-over height from the listing, not the overall height.
