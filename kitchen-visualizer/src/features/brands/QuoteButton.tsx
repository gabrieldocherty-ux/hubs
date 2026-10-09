import { lazy, Suspense, useEffect, useState } from 'react';
import type { Product } from '../../types';
import { brandApi } from './api';
import './brands.css';

const LeadForm = lazy(() => import('./LeadForm'));

type Contact = { slug: string; name: string; leadForm: boolean; verified: boolean };

/**
 * "Request a quote" for a product page (BRAND_PAGE §5): renders only for a live contractor
 * brand's product whose page takes requests; nothing for built-ins, partner brands or custom
 * models. Opens the lead form with the product attached.
 */
export default function QuoteButton({ product, className = 'btn primary' }: { product: Product; className?: string }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [open, setOpen] = useState(false);
  const slug = product.brandSlug;

  useEffect(() => {
    if (!slug) return;
    let live = true;
    brandApi
      .contact(slug)
      .then((r) => live && r.brand.kind === 'contractor' && r.brand.leadForm && setContact(r.brand))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug]);

  if (!contact) return null;
  return (
    <>
      <button
        className={className}
        onClick={() => {
          void brandApi.event(contact.slug, 'quote_click', product.id);
          setOpen(true);
        }}
      >
        Request a quote
      </button>
      <span className="quote-by">
        from <a href={`#/b/${contact.slug}`}>{contact.name}</a>
        {contact.verified ? ' · Verified contractor' : ''}
      </span>
      {open && (
        <Suspense fallback={null}>
          <LeadForm slug={contact.slug} company={contact.name} product={{ id: product.id, name: product.name }} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
