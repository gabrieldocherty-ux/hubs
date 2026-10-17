import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package 'showroom' (docs/SHOWROOM_PIVOT.md §5): what homeowners see on a company's showroom,
 * <slug>.blumodel.studio or its own domain. In the main chunk: the site state, the company mark
 * and the branding; the landing page and the Send dialog are lazy.
 *
 * On the sales site every export here is inert: `useShowroom()` is null, `SiteMark` draws our own
 * mark, and `SendDesign` renders nothing.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const ShowroomLanding: Lazy<{}> = lazy(() => import('./ShowroomLanding'));

export { useShowroom, currentShowroom, useSiteKind, basicsAllowed } from './useShowroom';
export { SiteMark, CompanyLogo } from './SiteMark';
export { applyShowroomBranding, pageTitle, siteName } from './branding';
export { shortName, looksLikeShowroomHost, type PublicTenant, type SiteKind } from './site';
export { showroomLines, showroomPrefs, linesIn, lineFromQuery, isOwnProduct, keepShowroomItems, type ShowroomLine } from './lines';
export { designHref, newDesignHash, roomFromQuery, type RoomKind } from './links';
export { SendDesign, type SendPlace } from './SendDesign';

/**
 * Routes a showroom never has: our sales pages, legacy paid flows, brand and contractor pages, the
 * admin. They show the 404 there (the server answers their APIs with a 404 on a showroom too).
 */
export const NOT_ON_SHOWROOM: ReadonlySet<string> = new Set(['pricing', 'book', 'brandPage', 'brand', 'orders', 'payDemo', 'admin', 'billing', 'pro', 'payDemoPlan', 'payShowroom']);
