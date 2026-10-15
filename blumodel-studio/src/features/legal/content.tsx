/*
 * SOURCE: AI-drafted templates, written by Claude (Anthropic) on 2026-10-14 for BluModel Studio from
 * what the code actually does (docs/PLANS_AND_CONTRACTORS.md, docs/BRAND_PAGE.md, server/**). They
 * are NOT legal advice and have not been reviewed by a lawyer. Have a lawyer in the operator's
 * jurisdiction review all three before relying on them, in particular: the refund windows (14 days
 * for an unused kitchen unlock, 7 days for an unwanted renewal), the age limit, the liability cap,
 * the governing-law clause and anything your local consumer law requires. docs/handoff/launch.md
 * lists what to check.
 *
 * Who runs the site comes from `/api/config` → `legal` (LEGAL_NAME, SUPPORT_EMAIL, LEGAL_JURISDICTION
 * on the server). When a value isn't set, the text uses neutral wording ("the operator of this
 * site") and never a placeholder.
 */
import type { ReactNode } from 'react';
import type { LegalConfig, Plan } from '../../types/platform';
import plansJson from '../../data/plans.json';
import { VISUALIZER_DISCLAIMER } from '../../lib/csv';
import type { LegalDocId } from '../../lib/router';
import type { PaymentsMode } from '../../lib/config';

export type { LegalDocId };

export interface LegalSection {
  id: string;
  heading: string;
  body: ReactNode;
}

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  /** Shown in the tab title and the nav. */
  short: string;
  updated: string;
  lede: ReactNode;
  sections: LegalSection[];
}

export const LAST_UPDATED = '15 October 2026';

const PLANS = plansJson as Plan[];
/** "$15 CAD": every price is in Canadian dollars since 15 October 2026. */
const price = (id: Plan['id']) => {
  const c = PLANS.find((p) => p.id === id)?.priceCents ?? 0;
  return `$${(c / 100).toFixed(c % 100 ? 2 : 0)} CAD`;
};

/** The words that depend on who runs the site. */
export interface LegalWords {
  /** "Sample Kitchen Co." or "the operator of this site", mid-sentence. */
  who: string;
  /** The same, at the start of a sentence. */
  Who: string;
  email: string | null;
  jurisdiction: string | null;
  /** How to reach the operator, as a sentence fragment that follows "contact us". */
  contact: ReactNode;
  /**
   * This server's payments. Only the labelled demo gets demo wording; with real Stripe payments the
   * pages say nothing about demos, and while payments aren't open they say so.
   */
  payments: PaymentsMode | null;
}

export function legalWords(legal: LegalConfig, payments: PaymentsMode | null = null): LegalWords {
  const name = legal.businessName;
  const email = legal.supportEmail;
  return {
    who: name ?? 'the operator of this site',
    Who: name ?? 'The operator of this site',
    email,
    jurisdiction: legal.jurisdiction,
    payments,
    contact: email ? (
      <>
        at <a href={`mailto:${email}`}>{email}</a>
      </>
    ) : (
      <>through the contact details provided by the operator of this site</>
    ),
  };
}

const ContactBlock = ({ w }: { w: LegalWords }) =>
  w.email ? (
    <p>
      Write to <a href={`mailto:${w.email}`}>{w.email}</a> from the email address on your account, so we can find it. We answer as soon as we can.
    </p>
  ) : (
    <p>
      Contact the operator of this site through the contact details it provides, from the email address on your account. Much of what you might ask for, you can do yourself:{' '}
      <a href="#/account">Account settings</a> has <b>Download my data</b> and <b>Delete my account</b>, and <a href="#/account/billing">Billing</a> cancels a plan.
    </p>
  );

// ─── Terms ───────────────────────────────────────────────────────────────────

export function termsDoc(w: LegalWords): LegalDoc {
  return {
    id: 'terms',
    title: 'Terms of Service',
    short: 'Terms',
    updated: LAST_UPDATED,
    lede: (
      <>
        BluModel Studio is a kitchen design tool at blumodel.studio, run by {w.who} (“we”, “us”). These terms are the agreement between you and us when you use it. They are written
        to be read: if something is unclear, contact us {w.contact}.
      </>
    ),
    sections: [
      {
        id: 'accounts',
        heading: '1. Your account',
        body: (
          <>
            <p>
              You can design on a device without an account. To save kitchens, share them or buy anything you need a free account. You must be at least 18, or the age of majority
              where you live if that is higher, and give an email address you can receive mail at.
            </p>
            <p>
              Keep your password to yourself: you are responsible for what happens in your account. A Contractor account is one login for one business. If you think someone else
              has used your account, change your password in Account settings (that signs out every other device) and tell us.
            </p>
          </>
        ),
      },
      {
        id: 'free-paid',
        heading: '2. What is free and what you pay for',
        body: (
          <>
            <p>
              Designing, saving, starting from photos and sharing kitchens are free, with no limit. <b>Exports are paid</b>: the floor plan, the 3D image, the shopping list, the
              project file, studio renders without a watermark and contractor quotes. You can pay for them in one of three ways:
            </p>
            <ul>
              <li>
                <b>Kitchen unlock, a one-time payment</b> offered when you export: every export of one kitchen, for as long as the kitchen exists, including after you change it. A
                duplicate is a new kitchen and is not unlocked.
              </li>
              <li>
                <b>Unlimited, {price('unlimited')} a month:</b> every export of every kitchen you own.
              </li>
              <li>
                <b>Contractor, {price('contractor')} a month:</b> everything in Unlimited, plus 3 custom 3D models a month made by our studio (section 5), a private catalog, a price
                book, branded quotes and a public brand page (section 6).
              </li>
            </ul>
            <p>
              <b>Custom 3D models</b> aren’t sold on their own: they come with the Contractor plan (section 5). Orders paid for before 15 October 2026 keep the price, currency and
              terms they were sold at.
            </p>
            <p>
              Every paid feature is priced at the point of purchase, in Canadian dollars (CAD), before you pay; the checkout page shows the final amount, including any tax. Payments made before 15 October 2026
              were in US dollars: their receipts stay in US dollars, and a plan started then renews at its price in US dollars until you change or cancel it. Someone else’s plan
              never covers your exports, even of a kitchen they shared with you.
            </p>
          </>
        ),
      },
      {
        id: 'payments',
        heading: '3. Payments',
        body: (
          <>
            <p>
              Payments are taken by Stripe on its own secure checkout page. We never see or store your card number; we keep a record of what you bought, when, and the amount.
              {w.payments === 'demo' && (
                <>
                  {' '}
                  A page marked <b>DEMO</b> is a simulation: nothing is charged and nothing is bought.
                </>
              )}
              {w.payments === 'none' && ' Payments aren’t open yet: until they are, nothing can be bought here and nothing is charged.'}
            </p>
            <p>
              After a payment we check every export on our server, so the files you paid for are made for you even if your browser was closed mid-way. Anyone can screenshot a screen;
              what an export gives you is the clean, full-resolution, dimensioned file.
            </p>
          </>
        ),
      },
      {
        id: 'subscriptions',
        heading: '4. Subscriptions and cancelling',
        body: (
          <>
            <p>
              Unlimited and Contractor renew every month until you cancel. Cancel any time in <a href="#/account/billing">Account → Billing</a>.{' '}
              <b>Cancelling takes effect at the end of the period you have already paid for</b>: you keep the plan until then, and it does not renew. A kitchen you unlocked with a
              one-time payment stays unlocked whatever happens to a plan.
            </p>
            <p>
              If a renewal payment fails you keep the plan for a 7-day grace period while it is retried; after that the account moves to Free and nothing you designed is deleted.
              When a Contractor plan ends, the catalog, price book and quotes become read-only and the share links you gave clients keep working.
            </p>
            <p>
              If we change a plan’s price we will tell you at least 30 days before your next renewal, and the new price applies only from a renewal after that notice. Refunds are
              covered by the <a href="#/refunds">Refund policy</a>.
            </p>
          </>
        ),
      },
      {
        id: 'models',
        heading: '5. Custom 3D models',
        body: (
          <>
            <p>
              The Contractor plan includes <b>3 custom 3D models a month</b>, made by our studio: one model per product, with up to 3 finishes and 2 revision rounds each. A model
              counts when you send its request. The month is your plan’s billing month; models you don’t use don’t carry over. If you withdraw a request, or we cancel it, before
              modelling starts, its models go back to that month’s allowance. If the plan ends, requests you already sent are still made and delivered, but no new ones can be sent.
            </p>
            <p>
              You send each product’s name and its UPC, photos or both, and the size if you have it; our studio builds a true-to-size 3D model. Turnaround counts business days from
              your request. A revision corrects the model against the brief you sent, it isn’t a new product. When you accept a delivery, the request is complete.
            </p>
            <p>
              Only send material you have the right to use. A custom model is private to your account (a contractor’s goes into their private catalog). It shows inside kitchens you
              share while the link works. We may decline a request we can’t model faithfully, or one that would infringe someone else’s rights; a declined request goes back to your
              allowance. Orders paid for before 15 October 2026 keep the turnaround, revisions and refund terms they were sold with.
            </p>
          </>
        ),
      },
      {
        id: 'contractors',
        heading: '6. Contractors, brand pages and leads',
        body: (
          <>
            <p>
              Contractors who use BluModel Studio are independent businesses. Their products, prices, quotes, installation and any contract with a homeowner are between them and the
              homeowner. We are not a party to that contract and we don’t sell or install anything. A <b>Verified</b> badge means we checked the business is real; it is not a
              recommendation or a guarantee of their work.
            </p>
            <p>
              If you publish a brand page, everything on it (company details, logos, photos, models, prices) must be accurate and yours to publish. Pages and products go live only
              after an admin approves them, and we can remove anything that breaks these terms.
            </p>
            <p>
              <b>Leads.</b> When a homeowner sends a quote request from a brand page, their name, contact details, message and (if they choose) their kitchen go to that one contractor,
              because they asked for it. A contractor may use those details only to answer that request, and must follow the privacy and anti-spam laws that apply to them.
            </p>
          </>
        ),
      },
      {
        id: 'content',
        heading: '7. Your designs, photos and files',
        body: (
          <>
            <p>
              What you make and upload stays yours. You let us store, process and show it only as needed to run BluModel Studio for you: saving your kitchens, drawing them, making the
              exports you pay for, showing a kitchen to people who have your share link, and reading your photos when you use Start from a photo. We don’t sell your content, and we
              don’t use your designs or photos to train AI models.
            </p>
            <p>
              Anyone with an active share link can view that kitchen. You can turn a link off or let it expire at any time. The <a href="#/privacy">Privacy policy</a> says who can see
              what.
            </p>
          </>
        ),
      },
      {
        id: 'rules',
        heading: '8. Fair use',
        body: (
          <ul>
            <li>Don’t upload anything illegal, or anything you don’t have the right to use.</li>
            <li>Don’t try to get into accounts, data or parts of the service that aren’t yours, or to get around the export paywall.</li>
            <li>Don’t copy the catalog’s models or our software out of the service, scrape it, or overload it.</li>
            <li>Don’t use the lead form or brand pages to send spam, or to collect people’s details for anything else.</li>
          </ul>
        ),
      },
      {
        id: 'accuracy',
        heading: '9. Plans, prices and estimates are for planning',
        body: (
          <>
            <p>{VISUALIZER_DISCLAIMER}</p>
            <p>
              The built-in catalog’s brands and prices are illustrations. Product sizes and prices from contractors and brands are theirs. Before you order, build or demolish
              anything, have the space measured and the plan checked by a qualified professional.
            </p>
          </>
        ),
      },
      {
        id: 'service',
        heading: '10. Keeping the service running',
        body: (
          <p>
            We work to keep BluModel Studio available and back up its data every day, but we can’t promise it will never be interrupted or lose data, so keep your own copies of
            exports that matter to you. We may change, add or remove features. If we ever close the service, we will tell account holders at least 30 days ahead so you can download
            your data, and refund any period you have paid for and can no longer use.
          </p>
        ),
      },
      {
        id: 'liability',
        heading: '11. Liability',
        body: (
          <>
            <p>
              BluModel Studio is provided as it is. As far as the law allows, we are not liable for indirect losses, such as lost profit or the cost of building work, and our total
              liability to you is limited to what you paid us in the 12 months before the claim.
            </p>
            <p>Nothing in these terms limits a right you have under consumer law that can’t be limited, or our liability for anything the law doesn’t let us exclude.</p>
          </>
        ),
      },
      {
        id: 'ending',
        heading: '12. Ending',
        body: (
          <p>
            You can stop at any time and delete your account in <a href="#/account">Account settings</a>. We may suspend or close an account that seriously or repeatedly breaks these
            terms; unless the law or safety stops us, we will tell you why and let you download your data first.
          </p>
        ),
      },
      {
        id: 'changes',
        heading: '13. Changes to these terms',
        body: (
          <p>
            We will post any new version here with a new date. If a change matters to you (what you pay, what you get, or your rights) we will tell you in the app or by email before
            it takes effect. If you don’t agree, you can cancel and delete your account.
          </p>
        ),
      },
      {
        id: 'law',
        heading: '14. Governing law',
        body: w.jurisdiction ? (
          <p>
            These terms are governed by the laws of {w.jurisdiction}. If you are a consumer, you also keep the protection of the mandatory laws of the place you live, and you can
            bring a claim there.
          </p>
        ) : (
          <p>
            These terms are governed by the laws of the place where {w.who} is established. If you are a consumer, you also keep the protection of the mandatory laws of the place you
            live, and you can bring a claim there.
          </p>
        ),
      },
      { id: 'contact', heading: '15. Contact', body: <ContactBlock w={w} /> },
    ],
  };
}

// ─── Privacy ─────────────────────────────────────────────────────────────────

export function privacyDoc(w: LegalWords): LegalDoc {
  return {
    id: 'privacy',
    title: 'Privacy policy',
    short: 'Privacy',
    updated: LAST_UPDATED,
    lede: (
      <>
        {w.Who} runs BluModel Studio and is responsible for the personal data it holds. In short: we keep what we need to save your kitchens and run your account, on our own
        server; we set one sign-in cookie and nothing that tracks or advertises; and you can download or delete your data yourself.
      </>
    ),
    sections: [
      {
        id: 'what',
        heading: '1. What we keep',
        body: (
          <ul>
            <li>
              <b>Your account:</b> your name, email address and role. Your password is stored only as a salted hash; nobody can read it back.
            </li>
            <li>
              <b>Your kitchens:</b> the designs, their names, and anything you type into them, such as a client’s name or extra estimate lines.
            </li>
            <li>
              <b>Files you upload:</b> photos of your kitchen (Start from a photo), reference photos and spec sheets for a model order, and, for contractors and brands, logos,
              product photos and 3D models.
            </li>
            <li>
              <b>Contractor details:</b> company name, logo, phone, email, website and service area, and a private price book with your costs and markups.
            </li>
            <li>
              <b>Purchases:</b> what you bought, when, the amount, and Stripe’s reference numbers for the payment and subscription. Never your card number: Stripe holds that.
            </li>
            <li>
              <b>Leads:</b> if you send a quote request to a contractor, your name, email, phone (if you give it), message and, if you choose, your kitchen.
            </li>
            <li>
              <b>How the service is used:</b> counts of product views and clicks, and a record of each export (which kitchen, which kind, when), with no file contents. Your IP
              address is used while you sign in to slow down password guessing.
            </li>
          </ul>
        ),
      },
      {
        id: 'cookies',
        heading: '2. One cookie, no tracking',
        body: (
          <>
            <p>
              We set a single cookie, <code>blumodel_session</code>, when you sign in. It keeps you signed in for 30 days and renews while you use the site; signing out removes it. It
              can’t be read by scripts or sent from other sites.
            </p>
            <p>
              There are no advertising or analytics cookies, no tracking pixels and no third-party scripts. Fonts and every other file are served by us, so loading a page tells no
              one else that you visited. A kitchen you design without an account is kept in your browser’s own storage and never leaves your device until you save it to an account.
            </p>
          </>
        ),
      },
      {
        id: 'who-sees',
        heading: '3. Who can see what',
        body: (
          <ul>
            <li>
              <b>Your kitchens</b> are private to your account. If you make a share link, anyone who has it can view that kitchen, view-only, until you turn the link off or it
              expires. A contractor’s link shows their sell prices, never their costs.
            </li>
            <li>
              <b>Photos you start a kitchen from</b> are private to you. They are not shown on share links.
            </li>
            <li>
              <b>Model orders:</b> your reference photos and brief are seen by you and the studio staff making your model. The finished model is private to your account, and appears
              inside kitchens you share.
            </li>
            <li>
              <b>Brand pages</b> are public once approved, with the company details and products the contractor chose to publish.
            </li>
            <li>
              <b>Leads</b> go to the one contractor you sent them to, because you asked for that when you sent the form. We don’t pass them to anyone else.
            </li>
            <li>
              <b>Our staff</b> (admins and the modelling studio) can open account data when it is needed to run the service: approving brand pages, fulfilling orders, or answering
              you.
            </li>
          </ul>
        ),
      },
      {
        id: 'processors',
        heading: '4. Services we use',
        body: (
          <>
            <p>We don’t sell or rent personal data. A few services handle some of it for us, only to do their job:</p>
            <ul>
              <li>
                <b>Stripe</b> takes payments on its own checkout page and holds your card details under its own privacy policy.
              </li>
              <li>
                <b>Cloudflare</b> carries traffic between your browser and our server, so it handles your IP address and requests in transit.
              </li>
              <li>
                <b>Anthropic</b> (an AI provider): only if you use Start from a photo while photo reading is switched on, the photos you add and your measurements are sent to it to
                read the room for that one request.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: 'where',
        heading: '5. Where your data is kept, and for how long',
        body: (
          <>
            <p>
              BluModel Studio’s database and files live on the operator’s own server, with a backup made every day. We keep your data while your account exists. When you delete
              your account it is removed from the live database at once and drops out of backups as they are replaced.
            </p>
            <p>
              Records of payments and model orders are kept, with your name and email removed, because accounting law requires it. Leads you received as a contractor are deleted
              with your account; a lead you sent stays with the contractor who received it.
            </p>
          </>
        ),
      },
      {
        id: 'rights',
        heading: '6. Your choices and rights',
        body: (
          <>
            <ul>
              <li>
                <b>Download your data:</b> <a href="#/account">Account settings</a> → <b>Download my data</b> gives you a file with your account, kitchens, share links, orders and,
                for contractors, your brand page and leads.
              </li>
              <li>
                <b>Delete your account:</b> <a href="#/account">Account settings</a> → <b>Delete my account</b>. If a paid plan is still running, cancel it in Billing first; you can
                delete as soon as it no longer renews.
              </li>
              <li>
                <b>Correct your details:</b> change your name and password in Account settings, and contractor details under Company.
              </li>
            </ul>
            <p>
              Depending on where you live (for example under the GDPR, the UK GDPR, Canada’s PIPEDA or California’s CCPA) you may also have the right to ask what we hold about you, to
              object to some uses, and to complain to your data protection authority. Contact us {w.contact} and we will help.
            </p>
          </>
        ),
      },
      {
        id: 'security',
        heading: '7. Security',
        body: (
          <p>
            Pages and data travel over HTTPS. Passwords are hashed; sign-in sessions are random tokens we store only in hashed form; changes to your account need a request from this
            site itself; repeated failed sign-ins are slowed down. If we ever learn of a breach that affects you, we will tell you.
          </p>
        ),
      },
      {
        id: 'children',
        heading: '8. Children',
        body: <p>BluModel Studio is for adults planning real kitchens. We don’t knowingly keep data about anyone under 16; if you think we do, contact us and we will delete it.</p>,
      },
      {
        id: 'changes',
        heading: '9. Changes',
        body: <p>We will post any new version here with a new date, and tell account holders in the app or by email before a change that affects how we use their data.</p>,
      },
      { id: 'contact', heading: '10. Contact', body: <ContactBlock w={w} /> },
    ],
  };
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

export function refundsDoc(w: LegalWords): LegalDoc {
  return {
    id: 'refunds',
    title: 'Refund policy',
    short: 'Refunds',
    updated: LAST_UPDATED,
    lede: (
      <>
        You can try everything in BluModel Studio for free before you pay: design, view in 3D, share. What you pay for is the files and the services listed here. This policy says
        when you get your money back. It doesn’t take away any right you have under the consumer law where you live.
      </>
    ),
    sections: [
      {
        id: 'unlock',
        heading: '1. Kitchen unlock (one-time)',
        body: (
          <p>
            If you haven’t exported anything from that kitchen yet, ask within 14 days of paying for a full refund. Once you have downloaded an export, the unlock has been used and
            isn’t refundable, unless the export was broken and we couldn’t fix it, in which case you get your money back.
          </p>
        ),
      },
      {
        id: 'plans',
        heading: '2. Unlimited and Contractor plans',
        body: (
          <>
            <p>
              Cancel any time in <a href="#/account/billing">Account → Billing</a>. Cancelling stops the next renewal; you keep the plan until the end of the period you’ve paid for, and
              we don’t refund the rest of a month you have started.
            </p>
            <p>
              If a renewal went through that you didn’t want and you haven’t exported anything since, ask within 7 days of the renewal and we will refund it and end the plan. If we
              charged you twice or by mistake, we refund the mistake in full.
            </p>
          </>
        ),
      },
      {
        id: 'models',
        heading: '3. Custom 3D models paid for before 15 October 2026',
        body: (
          <ul>
            <li>
              Custom models now come with the Contractor plan and aren’t paid for separately, so there is nothing to refund on a new request: withdraw it before modelling starts
              and its models go back to your allowance. The rest of this section covers orders paid for before then.
            </li>
            <li>
              <b>Before you pay</b>, cancel the order from its page and nothing is charged. <b>After you pay but before modelling starts</b>, contact us to cancel it for a full
              refund.
            </li>
            <li>
              <b>Once modelling has started</b>, the price covers the work. If the model we deliver still doesn’t match your brief (size, shape or finishes) after the two included
              revision rounds, ask and we will refund the order in full or in part, depending on how far it falls short.
            </li>
            <li>
              <b>If we decline the order</b>, or can’t deliver it, you get a full refund. If a rush order arrives later than the rush turnaround, the rush fee is refunded.
            </li>
          </ul>
        ),
      },
      {
        id: 'how',
        heading: '4. How to ask',
        body: (
          <>
            <p>
              Contact us {w.contact} from the email address on your account, and say which purchase it is (the date and amount on your receipt in Billing is enough). Refunds go back
              to the card or account you paid with, through Stripe; your bank usually shows them within 5 to 10 business days.
            </p>
            <p>Please contact us before disputing a charge with your bank: it is quicker for you, and a dispute can freeze your account while it is open.</p>
          </>
        ),
      },
      ...(w.payments === 'demo'
        ? [
            {
              id: 'demo',
              heading: '5. Demo payments',
              body: <p>A checkout marked DEMO is a simulation. Nothing is charged, so there is nothing to refund.</p>,
            },
          ]
        : []),
      { id: 'contact', heading: w.payments === 'demo' ? '6. Contact' : '5. Contact', body: <ContactBlock w={w} /> },
    ],
  };
}

export function legalDoc(id: LegalDocId, legal: LegalConfig, payments: PaymentsMode | null = null): LegalDoc {
  const w = legalWords(legal, payments);
  return id === 'terms' ? termsDoc(w) : id === 'privacy' ? privacyDoc(w) : refundsDoc(w);
}
