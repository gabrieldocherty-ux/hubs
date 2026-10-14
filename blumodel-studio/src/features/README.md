# Feature packages

Each directory here is one feature package from `docs/BUILD_PLAN.md`. The foundation created it
with placeholder screens; the package then owns everything inside it.

| Directory | Package | Public surface (`index.ts`) |
|---|---|---|
| `viewer/` | A viewer | `ProductPage`, `ProductStage` (+ `ProductStageProps`), `RenderButton` |
| `brands/` | B brands | `BrandPortal`, `BrandPage`, `AdminModerationTab`, `AdminBrandsTab` |
| `orders/` | C orders | `OrdersRoot`, `DemoPay`, `AdminStudioTab`, `AdminRevenueTab` |
| `generate/` | D generate | `GenerateScreen` |
| `share/` | E share | `LandingScreen`, `PricingScreen`, `SharedKitchen`, `ShareButton` |
| `marketing/` | E share | the `LandingScreen` and `PricingScreen` modules (re-exported from `share/`) |
| `billing/` | G billing | `BillingPage`, `DemoPlanPay`, `AdminBillingTab`, `useEntitlements`, `requestExport`, `useResumeExport`, `BillingHost` |
| `contractors/` | H contractors | `ContractorRoot`, `usePriceBook`, `ClientViewToggle`, `PresentButton`, `useContractorCatalog`, `useKitchenPriceOf`, `setSharedPrices`, `openQuote` |

## Rules

- **The `index.ts` exports are a frozen contract** (BUILD_PLAN §3.8). You may add exports; never
  rename or remove one. The app shell (`src/App.tsx`, `src/screens/AdminScreen.tsx`,
  `src/components/TopBar.tsx`) imports only from `index.ts`.
- **Every lazy module default-exports its component.** Screens are wrapped in `React.lazy` in
  `index.ts`, so each one is its own chunk and the main bundle stays under budget (675 KB).
- **Exports go through `requestExport(projectId, kind, run)`** from `src/features/billing`: it
  checks the paywall, records the export, and opens the Unlock dialog when the account isn't
  entitled. Never download a kitchen's files directly.
- **Lazy-load anything that touches three.js.** `RenderButton` and `ShareButton` sit in the
  TopBar and are part of the main chunk: they must not statically import `three`,
  `@react-three/*` or `postprocessing`. Open dialogs with `lazy(() => import('./RenderDialog'))`.
- **One stylesheet per package:** `<key>.css`, imported by your own components. Never edit
  `src/styles.css`; ask for a token or class through your handoff note instead.
- **API calls** live in `src/features/<key>/api.ts`, built on `call()` and `upload()` from
  `src/lib/api.ts` (they add the `X-Mise: 1` CSRF header and turn errors into `ApiError`).
- **Package-local types** go in your own directory. Don't redefine anything from
  `src/types.ts` or `src/types/platform.ts`.
- **Tests:** pure-module TS tests in `src/features/<key>/__tests__/*.test.ts`, run with
  `node scripts/test-ts.mjs <filter>`. No DOM, no zustand persistence.

## Reuse these

- Styles and tokens from `src/styles.css`: `btn` (`primary`, `big`, `wide`), `chip`/`chips`,
  `menu`/`menu-wrap`, `modal-backdrop`/`modal`/`modal-actions`, `field`, `screen-msg` (loaders and
  empty states), `home-bar`/`home-main`, `eyebrow`, `mini-label`, `badge`, `empty-note`,
  `auth-error`/`auth-ok`, the `--ink`, `--paper`, `--panel`, `--line`, `--accent` colour tokens.
- Components, read-only: `FeetInchesInput`, `MiniPlan`, `PresetStrip`, `Icons`, `ProductArt`,
  `AccountMenu`, `Toasts`.
- Formatting: `money()`, `feetInches()` and `inches()` from `src/lib/format.ts`.
- Routing: `navigate()`, `hrefFor()`, `useRoute()`, `useHashQuery()`, `pageQuery()` from
  `src/lib/router.ts`. `brand` and `orders` receive a free `rest` sub-path to route internally.
- Catalog: `useCatalog` (`register`, `registerSnapshots`, `load`), `getProduct()`,
  `isBuiltin()`, `productCode()`, `priceFor()` from `src/data/catalog.ts`;
  `PRODUCT_TYPES` from `src/data/productTypes.ts`.
- Kitchens: `Workspace` from `src/screens/Editor.tsx` (`mode: 'edit' | 'view'`, plus optional
  `showPrices` and `banner`), `useDesignStore().openReadOnly(doc, products)`,
  `prepareDocForSave()` from `src/lib/doc.ts`, `saveLocalDraft()` from the design store.
- Analytics: `track(productId, 'view' | 'add' | 'buy_click' | 'render')` from `src/lib/track.ts`
  (a no-op for built-ins and offline; `view` is de-duplicated per session).
- Session: `useSession` (`user.role`, `user.brands`).

## UI conventions

- Every new control has a label. Modals trap focus, close on Esc, and use `role="dialog"`.
- Status is never shown by colour alone (pair it with text or an icon).
- No third-party requests at runtime: no web fonts, CDN decoders, drei `Environment` presets,
  `<Stage>`, `useKTX2` or `useDetectGPU`. QA fails a page that makes one.
- Debug hooks (`window.__miseQa`) only when `location.search` contains `qa`.
