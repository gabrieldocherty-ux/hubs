import { DemoLink, MarketingFooter, MarketingHeader, usePendingScroll, useTitle } from './parts';
import { BookSection } from './sections';
import './marketing.css';

/**
 * `#/book` (and `/book`): the sales site's Book a call page, the address to give out on a cold
 * call. The same form as the landing page's, posting to /api/sales-leads.
 */
export default function BookCallScreen() {
  usePendingScroll();
  useTitle('Book a call · BluModel Studio');
  return (
    <div className="mk">
      <MarketingHeader active="book" />
      <main className="mk-book-page">
        <BookSection id="book" />
        <p className="mk-center mk-book-demo">
          Want to look around first? <DemoLink className="mk-link">Open the live demo showroom</DemoLink>
        </p>
      </main>
      <MarketingFooter />
    </div>
  );
}
