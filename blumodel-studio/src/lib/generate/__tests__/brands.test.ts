import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrandPrefs, PlacedItem, Product, Room } from '../../../types';
import { composeNewKitchen } from '../../../data/compose';
import { TEMPLATES } from '../../../data/templates';
import { getProduct } from '../../../data/catalog';
import { useCatalog } from '../../../store/useCatalog';
import { useDesignStore } from '../../../store/useDesignStore';
import { prepareDocForSave, sanitizeDoc } from '../../doc';
import { BASICS_BRAND, brandOptions, brandPicker, brandPrefsLabel, brandShare, cleanBrandPrefs, filterToPrefs, isBasics } from '../brands';
import type { Picked } from '../layout';

const ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };
const LOW_ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 96 };

const fin = (id: string) => [{ id, name: id, hex: '#eeeeee', material: 'paint' as const }];
/** A brand product shaped like a Basics one (same depth and height), in one width and finish. */
function mk(fromId: string, over: Partial<Product>): Product {
  const from = getProduct(fromId)!;
  return { ...from, widthOptions: undefined, finishes: fin('white'), brand: 'Testco', line: 'Alpha', source: 'brand', price: 100, blurb: '', ...over } as Product;
}
const pickOf = (p: Product, widthIn = p.widthIn): Picked => ({ productId: p.id, product: p, widthIn });
const width = (it: PlacedItem) => it.widthIn ?? getProduct(it.productId)!.widthIn;
/** Where each piece sits (a pendant hangs free, so its own width is the brand's). */
const geometry = (items: PlacedItem[]) => items.map((it) => ({ x: it.x, y: it.y, rotation: it.rotation, width: getProduct(it.productId)!.kind === 'pendant' ? 0 : width(it) }));

// Registered for the compose tests (each test file runs in its own process).
const FAKES: Product[] = [
  mk('base', { id: 'tc-base-30', widthIn: 30 }),
  mk('base', { id: 'tc-base-36', widthIn: 36 }),
  mk('wall', { id: 'tc-wall-30', widthIn: 30 }),
  mk('wall', { id: 'tc-wall-36', widthIn: 36 }),
  // Too deep for a base slot: never used.
  mk('base', { id: 'tc-base-33-deep', widthIn: 33, depthIn: getProduct('base')!.depthIn + 8 }),
  mk('pendant-dome', { id: 'lc-pendant', brand: 'Lightco', widthIn: 11 }),
];
useCatalog.getState().register(FAKES);

test('no brands (or only BluModel Basics) builds exactly the Basics kitchen', () => {
  for (const t of TEMPLATES) {
    const plain = composeNewKitchen('', ROOM, t.id);
    const strip = (items: PlacedItem[]) => items.map(({ id: _id, ...rest }) => rest);
    for (const prefs of [undefined, {}, { cabinets: [] }, { cabinets: [BASICS_BRAND] }] as (BrandPrefs | undefined)[]) {
      assert.deepEqual(strip(composeNewKitchen('', ROOM, t.id, prefs).items), strip(plain.items), `${t.id} ${JSON.stringify(prefs)}`);
    }
    assert.equal('brandPrefs' in plain, false);
  }
});

test('a chosen brand fills every slot it sells in that type and size; the rest stay Basics; nothing moves', () => {
  let swapped = 0;
  for (const t of TEMPLATES) {
    const plain = composeNewKitchen('', ROOM, t.id);
    const branded = composeNewKitchen('', ROOM, t.id, { cabinets: ['Testco'], lighting: ['Lightco'] });
    assert.deepEqual(branded.brandPrefs, { cabinets: ['Testco'], lighting: ['Lightco'] });
    assert.deepEqual(geometry(branded.items), geometry(plain.items), `${t.id}: same places, rotations and widths`);
    plain.items.forEach((it, i) => {
      const before = getProduct(it.productId)!;
      const after = getProduct(branded.items[i].productId)!;
      const sells = FAKES.some((f) => f.brand === 'Testco' && f.kind === before.kind && f.variant === before.variant && f.widthIn === width(it) && f.depthIn <= before.depthIn + 3);
      if (before.category === 'cabinets' && sells) {
        assert.equal(after.brand, 'Testco', `${t.id}: ${before.id} at ${width(it)}″ should be Testco`);
        assert.equal(after.kind, before.kind);
        swapped++;
      } else if (before.kind === 'pendant') {
        assert.equal(after.id, 'lc-pendant', `${t.id}: pendants are any size`);
      } else {
        assert.equal(after.id, before.id, `${t.id}: ${before.id} (${width(it)}″, ${before.variant ?? ''}) has no Testco match and stays Basics`);
      }
    });
  }
  assert.ok(swapped > 10, `Testco took ${swapped} slots across the templates`);
});

test("a layout applied in the editor (a blank room's templates) uses the kitchen's brand choices", () => {
  const S = useDesignStore.getState;
  const blank = composeNewKitchen('Blank', ROOM, null, { cabinets: ['Testco'] });
  assert.equal(blank.items.length, 0);
  S().loadDoc(blank);
  S().applyTemplate('l-island');
  const branded = S().doc.items.filter((it) => getProduct(it.productId)?.brand === 'Testco');
  assert.ok(branded.length > 0, 'the L + Island applied in the editor has Testco cabinets');
  assert.deepEqual(S().doc.brandPrefs, { cabinets: ['Testco'] });
  // A kitchen with no choices gets the Basics layout, as before.
  S().loadDoc(composeNewKitchen('Plain', ROOM, null));
  S().applyTemplate('l-island');
  assert.equal(S().doc.items.filter((it) => getProduct(it.productId)?.brand === 'Testco').length, 0);
});

test('brand pieces wear their own finish; the share counts pieces from the chosen brands', () => {
  const doc = composeNewKitchen('', ROOM, 'l-island', { cabinets: ['Testco'] });
  const testco = doc.items.filter((it) => getProduct(it.productId)!.brand === 'Testco');
  assert.ok(testco.length > 0);
  for (const it of testco) assert.equal(it.finishId, 'white');
  const share = brandShare(doc, doc.brandPrefs);
  assert.equal(share.fromBrands, testco.length);
  assert.equal(share.inCategories, doc.items.filter((it) => getProduct(it.productId)!.category === 'cabinets').length);
  assert.ok(share.fromBrands < share.inCategories, 'drawer bases, corners and the island stay Basics');
});

test('the picker keeps one look per brand, follows the chosen order, the variant asked for and the ceiling', () => {
  const base30 = pickOf(getProduct('base')!, 30);
  const base36 = pickOf(getProduct('base')!, 36);
  const catalog = [
    mk('base', { id: 'a-30', widthIn: 30 }),
    mk('base', { id: 'a-33', widthIn: 33 }),
    mk('base', { id: 'a-27', widthIn: 27 }),
    mk('base', { id: 'b-36', widthIn: 36, line: 'Beta', finishes: fin('grey') }),
    mk('base', { id: 'b-30', widthIn: 30, line: 'Beta', finishes: fin('grey') }),
  ];
  // Fresh: the look the brand sells most of.
  assert.equal(brandPicker({ cabinets: ['Testco'] }, { catalog })!(base30).productId, 'a-30');
  // Once Beta is in the kitchen (only Beta sells 36″), the 30″ slot stays Beta.
  const swap = brandPicker({ cabinets: ['Testco'] }, { catalog })!;
  assert.equal(swap(base36).productId, 'b-36');
  assert.equal(swap(base30).productId, 'b-30');
  assert.equal(swap(base30).widthIn, 30);

  // Chosen order wins over catalog order.
  const two = [mk('base', { id: 'one-30', brand: 'One', widthIn: 30 }), mk('base', { id: 'two-30', brand: 'Two', widthIn: 30 })];
  assert.equal(brandPicker({ cabinets: ['Two', 'One'] }, { catalog: two })!(base30).productId, 'two-30');
  assert.equal(brandPicker({ cabinets: ['one'] }, { catalog: two })!(base30).productId, 'one-30', 'brand names match ignoring case');

  // A slot that asks for induction does not take a gas range; one that asks for nothing does.
  const range = getProduct('range-30')!;
  const gas = [mk('range-30', { id: 'gas-30', brand: 'Stoveco', category: 'appliances', variant: 'gas-4', finishes: fin('steel') })];
  assert.equal(brandPicker({ appliances: ['Stoveco'] }, { catalog: gas })!(pickOf(range), 'induction').productId, range.id);
  assert.equal(brandPicker({ appliances: ['Stoveco'] }, { catalog: gas })!(pickOf(range)).productId, 'gas-30');
  // Stoveco chosen for cabinets only: it sells none, so there is nothing to pick from.
  assert.equal(brandPicker({ cabinets: ['Stoveco'] }, { catalog: gas }), undefined);
  // Cabinets chosen, appliances not: the range stays Basics.
  assert.equal(brandPicker({ cabinets: ['Testco'] }, { catalog: [...catalog, ...gas] })!(pickOf(range)).productId, range.id);

  // A tall cabinet that would hit the ceiling is not used.
  const pantry = getProduct('pantry')!;
  const tall = [mk('pantry', { id: 'tall-pantry', heightIn: 100, elevationIn: 0 })];
  assert.equal(brandPicker({ cabinets: ['Testco'] }, { catalog: tall, ceilingIn: LOW_ROOM.ceilingIn })!(pickOf(pantry)).productId, pantry.id);
  assert.equal(brandPicker({ cabinets: ['Testco'] }, { catalog: tall, ceilingIn: ROOM.ceilingIn })!(pickOf(pantry)).productId, 'tall-pantry');

  // No usable product of a chosen brand at all: no picker, so the build is untouched.
  assert.equal(brandPicker({ cabinets: ['Nobody'] }, { catalog }), undefined);
  assert.equal(brandPicker(undefined), undefined);
});

test('the choices are cleaned, kept on the kitchen through save and open, and summarised', () => {
  assert.deepEqual(cleanBrandPrefs({ cabinets: ['  Landon  & Co ', 'landon & co', 7, ''], appliances: [], flooring: ['X'] }), { cabinets: ['Landon & Co'] });
  assert.equal(cleanBrandPrefs({ sinks: [] }), undefined);
  assert.equal(cleanBrandPrefs(['GE']), undefined);
  assert.equal(cleanBrandPrefs({ appliances: Array.from({ length: 30 }, (_, i) => `B${i}`) })!.appliances!.length, 20);

  const doc = composeNewKitchen('Mine', ROOM, 'galley', { cabinets: ['Testco'], appliances: ['GE', 'Bosch'] });
  const saved = prepareDocForSave(doc);
  assert.deepEqual(saved.brandPrefs, { cabinets: ['Testco'], appliances: ['GE', 'Bosch'] });
  assert.ok(saved.products?.['tc-base-30'] || saved.products?.['tc-base-36'], 'brand pieces are snapshotted');
  const opened = sanitizeDoc(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(opened.brandPrefs, { cabinets: ['Testco'], appliances: ['GE', 'Bosch'] });
  assert.equal('brandPrefs' in sanitizeDoc({ ...saved, brandPrefs: { cabinets: [] } }), false);

  assert.equal(brandPrefsLabel(undefined), 'Any brand');
  assert.equal(brandPrefsLabel({ cabinets: ['Testco'], sinks: ['testco'] }), 'Testco');
  assert.equal(brandPrefsLabel({ cabinets: ['Testco'], appliances: ['GE'] }), 'Testco & GE');
  assert.equal(brandPrefsLabel({ cabinets: ['A'], appliances: ['B'], lighting: ['C'] }), '3 chosen brands');
});

test('brand options merge the retail counts with the catalog; BluModel Basics is never offered', () => {
  const products = [...useCatalog.getState().products];
  const opts = brandOptions(products, {
    cabinets: [
      { brand: 'Landon & Co', products: 29, stores: ['RONA'] },
      { brand: 'testco', products: 2, stores: ['Home Depot', 'RONA'] },
      { brand: BASICS_BRAND, products: 10, stores: [], basics: true },
    ],
    sinks: [{ brand: 'Kraus', products: 5, stores: ['Home Depot', 'Home Hardware'] }],
  });
  assert.deepEqual(
    opts.cabinets.map((o) => [o.brand, o.products, o.inCatalog, o.stores.join('|')]),
    [
      ['Landon & Co', 29, 0, 'RONA'],
      ['testco', 5, 5, 'Home Depot|RONA'],
    ],
  );
  assert.deepEqual(opts.sinks.map((o) => o.brand), ['Kraus']);
  assert.deepEqual(opts.lighting.map((o) => o.brand), ['Lightco']);
  assert.deepEqual(opts.appliances, []);
  for (const list of Object.values(opts)) for (const o of list) assert.notEqual(o.brand, BASICS_BRAND);
  assert.ok(products.filter(isBasics).length > 40, 'every built-in counts as Basics');
});

test("Add products' Your brands filter narrows only the categories with a chosen brand in the catalog", () => {
  const products = useCatalog.getState().products;
  const mine = filterToPrefs(products, { cabinets: ['Testco'], sinks: ['Nobody'] });
  assert.ok(mine.filter((p) => p.category === 'cabinets').every((p) => p.brand === 'Testco'));
  assert.equal(mine.filter((p) => p.category === 'sinks').length, products.filter((p) => p.category === 'sinks').length, 'no Nobody sinks: the category stays whole');
  assert.equal(mine.filter((p) => p.category === 'appliances').length, products.filter((p) => p.category === 'appliances').length);
  assert.equal(filterToPrefs(products, undefined), products);
});
