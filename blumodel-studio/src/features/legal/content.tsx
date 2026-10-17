/*
 * SOURCE: AI-drafted templates, written by Claude (Anthropic) for BluModel Studio from what the
 * product and the code actually do: first on 2026-10-14 for the homeowner and contractor plans,
 * rewritten on 2026-10-17 for the showroom pivot (docs/SHOWROOM_PIVOT.md): a B2B service agreement
 * with kitchen and bath companies, a privacy policy in which the company is the controller of its
 * showroom visitors' data and we are its processor, and a refund policy for the monthly plan. They
 * are NOT legal advice and have not been reviewed by a lawyer. Have a lawyer in the operator's
 * jurisdiction review all three before relying on them, in particular: the license refund terms,
 * the liability cap, taxes, the processor terms (PIPEDA, Quebec's Law 25, CASL for the leads), the
 * governing-law clause, and what happens to data after a company leaves.
 *
 * Who runs the site comes from `/api/config` → `legal` (LEGAL_NAME, SUPPORT_EMAIL, LEGAL_JURISDICTION
 * on the server). When a value isn't set, the text uses neutral wording ("the operator of this
 * site") and never a placeholder. Prices come from src/data/plans.json, the server's own list.
 */
import type { ReactNode } from 'react';
import type { LegalConfig } from '../../types/platform';
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

export const LAST_UPDATED = '17 October 2026';
/** The day the showroom pivot took effect: purchases before it keep their own terms. */
const PIVOT_DATE = '17 October 2026';

interface PlanJson {
  id: string;
  priceCents: number | null;
  creditRolloverMonths?: number;
  breakdown?: { id: string; cents: number }[];
}
const PLANS = plansJson as unknown as PlanJson[];
const MONTHLY = PLANS.find((p) => p.id === 'showroom_monthly');
const cad = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} CAD`;
const MONTHLY_PRICE = cad(MONTHLY?.priceCents ?? 5000);
const HOSTING_PRICE = cad(MONTHLY?.breakdown?.find((b) => b.id === 'hosting')?.cents ?? 2500);
const CREDIT_PRICE = cad(MONTHLY?.breakdown?.find((b) => b.id === 'render_credits')?.cents ?? 2500);
const ROLLOVER = MONTHLY?.creditRolloverMonths ?? 3;
/** Days a showroom stays live after a failed monthly payment (server/billing, GRACE_DAYS). */
const GRACE_DAYS = 14;

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
      Write to <a href={`mailto:${w.email}`}>{w.email}</a>. A company should write from an address on its team, and say which showroom it is about, so we can find it. We answer as
      soon as we can.
    </p>
  ) : (
    <p>
      Contact the operator of this site through the contact details it provides. Much of what you might ask for, you can do yourself: <a href="#/account">Account settings</a> has{' '}
      <b>Download my data</b> and <b>Delete my account</b>.
    </p>
  );

const PaymentsNote = ({ w }: { w: LegalWords }) => (
  <>
    {w.payments === 'demo' && (
      <>
        {' '}
        A checkout page marked <b>DEMO</b> is a simulation: nothing is charged and nothing is bought.
      </>
    )}
    {w.payments === 'none' && ' Payments aren’t open yet: until they are, nothing can be bought here and nothing is charged.'}
  </>
);

// ─── Service agreement (was: Terms of Service) ───────────────────────────────

export function termsDoc(w: LegalWords): LegalDoc {
  return {
    id: 'terms',
    title: 'Service agreement',
    short: 'Service agreement',
    updated: LAST_UPDATED,
    lede: (
      <>
        BluModel Studio builds, hosts and runs virtual showrooms for kitchen and bath companies. This agreement is between {w.who} (“we”, “us”) and the company that uses a showroom
        (“you”). It is written to be read: if something is unclear, contact us {w.contact}. Section 15 covers people who visit a showroom, and section 16 covers anything bought
        before {PIVOT_DATE}.
      </>
    ),
    sections: [
      {
        id: 'parties',
        heading: '1. Who this agreement is with',
        body: (
          <>
            <p>
              The agreement starts when you accept our quote or order, or pay the first invoice or the first month, whichever comes first. The person who accepts it confirms they
              can act for the company. Your quote or order can add to these terms, or change them for your company, and where the two differ, the quote or order wins.
            </p>
            <p>BluModel Studio is a service for businesses. It is not sold to consumers.</p>
          </>
        ),
      },
      {
        id: 'service',
        heading: '2. What we provide',
        body: (
          <>
            <p>For as long as your showroom is live (section 6), we provide:</p>
            <ul>
              <li>
                <b>Your showroom:</b> a website under your company’s name, logo and colours where your customers design kitchens and bathrooms in 3D with your products.
              </li>
              <li>
                <b>Its web address:</b> a subdomain of blumodel.studio named for your company and, if you own a domain, that domain connected to the showroom at no extra charge.
                You stay responsible for the domain itself and its registration.
              </li>
              <li>
                <b>Hosting, updates and backups:</b> we run the servers, keep the software up to date and back up its data every day.
              </li>
              <li>
                <b>Your products, modelled:</b> 3D models of your starting range (section 3), and more on request, quoted first.
              </li>
              <li>
                <b>A lead inbox and team accounts:</b> leads from your visitors, and accounts for your staff with owner and staff roles.
              </li>
              <li>
                <b>AI renderings:</b> photoreal images of designs, paid for with rendering credits (section 5).
              </li>
            </ul>
            <p>
              A showroom is a sales tool, not a CAD or construction tool. {VISUALIZER_DISCLAIMER} Measurements, final drawings, prices and installation are yours to check and
              confirm with your customers.
            </p>
          </>
        ),
      },
      {
        id: 'license',
        heading: '3. Setup and the yearly license',
        body: (
          <>
            <p>
              The license pays for the showroom software for its term (one year unless your order says otherwise), its setup, and 3D modelling of your starting range. You pay{' '}
              <b>the setup and license fee set out in your order or invoice</b>, which is quoted for your company; your starting range is the one set out there too.
            </p>
            <p>
              We invoice the setup and license fee, and it is due as the invoice says. Products beyond those in your order are quoted before we model them, and nothing is charged without your
              agreement. Before the term ends we will contact you about renewing; the license does not renew by itself unless your order says it does.
            </p>
          </>
        ),
      },
      {
        id: 'monthly',
        heading: '4. The monthly plan',
        body: (
          <>
            <p>
              The monthly plan is <b>{MONTHLY_PRICE} a month</b>: <b>{HOSTING_PRICE}</b> for hosting and running your showroom, including its web address, and{' '}
              <b>{CREDIT_PRICE}</b> of AI rendering credits. It is paid by card through Stripe’s secure checkout, from a link we send you, and renews every month until it is
              cancelled. We never see or store your card number.
              <PaymentsNote w={w} />
            </p>
            <p>
              <b>Cancel any time</b> by asking us, or from your showroom’s plan page where it offers it. Cancelling takes effect at the end of the month you have already paid for,
              and the plan does not renew after that. If we change the monthly price, we will tell you at least 30 days before the renewal it first applies to.
            </p>
          </>
        ),
      },
      {
        id: 'credits',
        heading: '5. Rendering credits',
        body: (
          <>
            <p>
              Each paid month adds {CREDIT_PRICE} of rendering credits to your showroom. Credits you don’t use roll over for {ROLLOVER} months and then expire, oldest first. Your team
              can see the balance, what each rendering costs before making one, and the history of every credit added, spent, refunded or expired.
            </p>
            <p>
              Credits are reserved when a rendering starts and given back if it fails. They have no cash value, can’t be transferred to another company, and aren’t refunded when
              they expire or when the plan ends. We may add credits, or correct a mistake, and every change is recorded.
            </p>
          </>
        ),
      },
      {
        id: 'live',
        heading: '6. When your showroom is live',
        body: (
          <>
            <p>
              Your showroom is live while your license is current <b>and</b> your monthly plan is paid. If a monthly payment fails, the showroom stays live for {GRACE_DAYS} days
              while the payment is retried. After that, or once the license ends, visitors see a polite “temporarily unavailable” page until it is paid again.
            </p>
            <p>
              A lapsed showroom’s products, designs, leads and settings are kept. We don’t delete them automatically; section 13 says what happens when you leave for good.
            </p>
          </>
        ),
      },
      {
        id: 'content',
        heading: '7. Your brand, products and content',
        body: (
          <>
            <p>
              Your name, logo, product information, photos, prices and anything else you give us stay yours. You let us use them only to build and run your showroom, and you
              confirm you have the right to give them to us. Product details, prices and availability shown on your showroom are yours to keep accurate.
            </p>
            <p>
              The 3D models we make of your products are made for your showroom and shown only there. We don’t offer models made from your material to another company without
              your permission. We keep the rights in our software, our product library and the models we make; if you leave and want the model files, ask us.
            </p>
          </>
        ),
      },
      {
        id: 'leads',
        heading: '8. Leads and your visitors’ data',
        body: (
          <>
            <p>
              <b>Leads are yours.</b> When a visitor sends a design to your company, their contact details, the design and their consent go to your team only. We store them for
              you and never sell them, share them with another company or use them to market to your customers.
            </p>
            <p>
              For the personal data of your showroom’s visitors, you are the controller and we are your processor: we handle it only to run your showroom and on your instructions,
              as the <a href="#/privacy">Privacy policy</a> describes. You agree to use leads only to answer the people who sent them, and to follow the privacy and anti-spam laws
              that apply to you, including Canada’s CASL when you email them.
            </p>
          </>
        ),
      },
      {
        id: 'team',
        heading: '9. Your team',
        body: (
          <p>
            Owners can invite staff, change roles and remove people. You are responsible for who you give access to and what they do in your showroom: keep passwords private, and
            remove anyone who leaves. If you think an account has been misused, change its password and tell us.
          </p>
        ),
      },
      {
        id: 'rules',
        heading: '10. Fair use',
        body: (
          <ul>
            <li>Don’t upload anything illegal, or anything you don’t have the right to use.</li>
            <li>Don’t try to get into another company’s showroom, accounts or data, or parts of the service that aren’t yours.</li>
            <li>Don’t copy our software or product library out of the service, scrape it, resell it or overload it.</li>
            <li>Don’t use the lead form or your showroom to send spam, or to collect people’s details for anything else.</li>
          </ul>
        ),
      },
      {
        id: 'availability',
        heading: '11. Keeping it running',
        body: (
          <p>
            We work to keep every showroom available and back its data up every day, but we can’t promise the service will never be interrupted. We may change, add or remove
            features as the product improves, without reducing what you have paid for. If we ever close the service, we will tell you at least 30 days ahead, help you take your
            leads and data with you, and refund any period you have paid for and can no longer use.
          </p>
        ),
      },
      {
        id: 'fees',
        heading: '12. Prices and taxes',
        body: (
          <p>
            Prices are in Canadian dollars and don’t include sales taxes, which are added where the law requires them; your invoice or receipt shows the total. If an invoice stays
            unpaid after we have reminded you, we may pause your showroom until it is paid (section 6). Payment questions are best raised with us before disputing a charge with
            your bank.
          </p>
        ),
      },
      {
        id: 'ending',
        heading: '13. Ending',
        body: (
          <>
            <p>
              You can cancel the monthly plan at any time (section 4); the license runs to the end of its term. We may suspend a showroom that is unpaid or that seriously breaks
              this agreement; unless the law or safety stops us, we will tell you why first and give you a chance to put it right.
            </p>
            <p>
              When you leave, you can export your leads as a spreadsheet from the lead inbox before the showroom goes offline, and ask us for a copy of your other data. Ask us to
              delete your showroom’s data and we will, except records the law requires us to keep, such as invoices and payments.
            </p>
          </>
        ),
      },
      {
        id: 'liability',
        heading: '14. Liability',
        body: (
          <>
            <p>
              The service is provided as it is. As far as the law allows, neither of us is liable to the other for indirect losses such as lost profit or lost jobs, and our total
              liability to you is limited to what you paid us in the 12 months before the claim.
            </p>
            <p>Nothing here limits liability that the law doesn’t allow to be limited.</p>
          </>
        ),
      },
      {
        id: 'visitors',
        heading: '15. If you are visiting a showroom',
        body: (
          <>
            <p>
              A showroom is run for the company named on it. Designing, saving, sharing and downloading a design there are free. The company’s products, prices, quotes and any work
              it does for you are between you and that company; we don’t sell or install anything. Your account on a showroom belongs to that showroom only.
            </p>
            <p>
              Designs are for planning conversations: have the space measured and the plan checked by a professional before you order or build anything. If you send a design to the
              company, it receives your details and the design because you asked it to; the <a href="#/privacy">Privacy policy</a> explains what happens to them.
            </p>
          </>
        ),
      },
      {
        id: 'earlier',
        heading: '16. Earlier purchases',
        body: (
          <p>
            Before {PIVOT_DATE} BluModel Studio sold plans to homeowners and contractors: the Free and Unlimited plans, one-time kitchen unlocks, the Contractor plan and custom
            model orders. They aren’t sold any more. Anything already paid for keeps working, on the terms it was sold with, until it ends or is cancelled: receipts, cancelling,
            the billing portal and refunds stay available in Account → Billing. Exporting your own designs is now free.
          </p>
        ),
      },
      {
        id: 'changes',
        heading: '17. Changes and governing law',
        body: (
          <>
            <p>
              We will post any new version here with a new date, and tell companies by email at least 30 days before a change that affects what they pay, what they get or their
              rights. If you don’t agree, you can cancel before it takes effect.
            </p>
            {w.jurisdiction ? (
              <p>This agreement is governed by the laws of {w.jurisdiction}.</p>
            ) : (
              <p>This agreement is governed by the laws of the place where {w.who} is established.</p>
            )}
          </>
        ),
      },
      { id: 'contact', heading: '18. Contact', body: <ContactBlock w={w} /> },
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
        {w.Who} runs BluModel Studio, which hosts virtual showrooms for kitchen and bath companies. We hold personal data in two roles. For the companies we work with, their staff
        and people who contact us, we decide how it is used. For the people who visit a company’s showroom, <b>the company is in charge of their data and we process it for the
        company</b>. Either way: we keep what is needed, on our own server; we set one sign-in cookie and nothing that tracks or advertises; and we never sell personal data.
      </>
    ),
    sections: [
      {
        id: 'roles',
        heading: '1. Who is responsible',
        body: (
          <ul>
            <li>
              <b>On blumodel.studio</b>, and for company accounts, staff accounts and billing, {w.who} is the controller: we decide what is kept and why, and this policy is ours.
            </li>
            <li>
              <b>On a company’s showroom</b>, the company named on it is the controller of its visitors’ data, and {w.who} is its <b>processor</b>: we store and handle that data
              only to run the showroom for the company, on its instructions and under our agreement with it. Questions about how a company uses your details are best sent to the
              company first; we will help it answer.
            </li>
          </ul>
        ),
      },
      {
        id: 'what',
        heading: '2. What we keep',
        body: (
          <>
            <p>
              <b>About companies and their teams</b>
            </p>
            <ul>
              <li>Staff accounts: name, email address and role. Passwords are stored only as salted hashes; nobody can read them back.</li>
              <li>The company’s details: name, logo, colours, contact details shown to visitors, web addresses and products.</li>
              <li>
                Billing: licenses, invoices and receipts, and Stripe’s references for the monthly plan. Never a card number: Stripe holds that.
              </li>
              <li>Rendering credits: every credit added, spent, refunded or expired, and which team member made each rendering.</li>
              <li>Book a call requests from blumodel.studio: company, name, phone, email, city and message.</li>
            </ul>
            <p>
              <b>About visitors to a showroom, for the company</b>
            </p>
            <ul>
              <li>An account, if the visitor makes one: name and email address, kept for that showroom only.</li>
              <li>Designs the visitor saves, and share links they make.</li>
              <li>
                Leads: when a visitor sends a design to the company, their name, email, phone, postal code, budget, timeline and notes, the consent they gave with its wording and
                time, and a view-only link to the design.
              </li>
            </ul>
            <p>
              <b>About how the service is used:</b> counts of product views, and IP addresses while signing in or sending a form, to slow down password guessing and spam.
            </p>
          </>
        ),
      },
      {
        id: 'use',
        heading: '3. How visitor data is used',
        body: (
          <ul>
            <li>Only to run that company’s showroom: saving designs, showing them, and delivering leads to the company’s team.</li>
            <li>A lead goes to the one company whose showroom it was sent from. No other company can see it, and showrooms are kept apart from one another.</li>
            <li>We don’t sell visitor data, use it to market our own services, or use designs or photos to train AI models.</li>
            <li>Our own staff open a showroom’s data only when needed to run or support it, for example when the company asks for help.</li>
          </ul>
        ),
      },
      {
        id: 'cookies',
        heading: '4. One cookie, no tracking',
        body: (
          <>
            <p>
              We set a single cookie, <code>blumodel_session</code>, when someone signs in. It keeps them signed in for 30 days, renews while they use the site, and is removed when they
              sign out. It belongs to the one site that set it, so a sign-in on one showroom means nothing on another, and it can’t be read by scripts.
            </p>
            <p>
              There are no advertising or analytics cookies, no tracking pixels and no third-party scripts. Fonts and every other file are served by us, so loading a page tells no one
              else that you visited.
            </p>
          </>
        ),
      },
      {
        id: 'processors',
        heading: '5. Services we use',
        body: (
          <>
            <p>A few services handle some data for us, only to do their job:</p>
            <ul>
              <li>
                <b>Stripe</b> takes companies’ monthly payments on its own checkout page and holds card details under its own privacy policy.
              </li>
              <li>
                <b>Cloudflare</b> carries traffic between browsers and our server, so it handles IP addresses and requests in transit.
              </li>
              <li>
                <b>An email delivery service</b> sends sign-in and password emails, team invitations, and notices to a company that a new lead has arrived. The notice doesn’t contain
                the lead’s message.
              </li>
              <li>
                <b>An AI rendering service</b> makes photoreal renderings when a company’s team asks for one. It receives an image of the 3D view and a short description of the room,
                its finishes and products, never a visitor’s contact details.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: 'where',
        heading: '6. Where data is kept, and for how long',
        body: (
          <>
            <p>
              BluModel Studio’s database and files live on the operator’s own server, with a backup made every day. Deleted data drops out of the backups as they are replaced.
            </p>
            <ul>
              <li>
                <b>Visitor data</b> is kept for as long as the company keeps its showroom with us, unless the company or the visitor deletes it sooner. When a company leaves and asks
                us to, we delete its showroom’s data.
              </li>
              <li>
                <b>Company and staff data</b> is kept while the company is a customer, and Book a call requests for as long as we are talking with the company.
              </li>
              <li>
                <b>Invoices and payment records</b> are kept as long as accounting law requires.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: 'rights',
        heading: '7. Your choices and rights',
        body: (
          <>
            <ul>
              <li>
                <b>Download your data:</b> <a href="#/account">Account settings</a> → <b>Download my data</b> gives you a file with your account and designs.
              </li>
              <li>
                <b>Delete your account:</b> <a href="#/account">Account settings</a> → <b>Delete my account</b>. A lead you already sent stays with the company you sent it to:
                ask the company to delete it.
              </li>
              <li>
                <b>Correct your details:</b> change your name and password in Account settings.
              </li>
            </ul>
            <p>
              Depending on where you live (for example under Canada’s PIPEDA, Quebec’s Law 25, the GDPR or California’s CCPA) you may also have the right to ask what is held about
              you, to correct it, to object to some uses, and to complain to your data protection authority. Visitors to a showroom should ask the company first; anyone can
              contact us {w.contact} and we will help or pass the request to the company.
            </p>
          </>
        ),
      },
      {
        id: 'security',
        heading: '8. Security',
        body: (
          <p>
            Pages and data travel over HTTPS. Every showroom’s data is kept apart from every other’s, and each request is checked against the site it came from. Passwords are hashed;
            sign-in sessions are random tokens stored only in hashed form; repeated failed sign-ins and form sends are slowed down. If we learn of a breach that affects personal data
            we hold for a company, we tell that company without delay so it can tell the people affected, and we tell the people affected where we are the controller.
          </p>
        ),
      },
      {
        id: 'children',
        heading: '9. Children',
        body: <p>BluModel Studio is for adults planning real kitchens and bathrooms. We don’t knowingly keep data about anyone under 16; if you think we do, contact us and we will delete it.</p>,
      },
      {
        id: 'changes',
        heading: '10. Changes',
        body: <p>We will post any new version here with a new date, and tell companies before a change that affects how their visitors’ data is handled.</p>,
      },
      { id: 'contact', heading: '11. Contact', body: <ContactBlock w={w} /> },
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
        This policy covers what a company pays for a showroom: the monthly plan, rendering credits and the yearly license. Visitors to a showroom never pay anything. Section 5
        covers purchases made before {PIVOT_DATE}.
      </>
    ),
    sections: [
      {
        id: 'monthly',
        heading: '1. The monthly plan',
        body: (
          <>
            <p>
              Cancel any time. Cancelling stops the next renewal; the showroom stays on the plan until the end of the month you have paid for, and we don’t refund the rest of a month
              that has started.
            </p>
            <p>
              If a renewal went through that you didn’t want, ask within 7 days: if none of that month’s rendering credits have been used, we refund it and end the plan. If we charged
              you twice or by mistake, we refund the mistake in full.
            </p>
          </>
        ),
      },
      {
        id: 'credits',
        heading: '2. Rendering credits',
        body: (
          <p>
            Credits are part of the monthly plan and have no cash value, so they aren’t refunded on their own, when they expire, or when the plan ends. A rendering that fails gives its
            credits back automatically. If a rendering was charged and came out unusable, tell us and we will return its credits.
          </p>
        ),
      },
      {
        id: 'license',
        heading: '3. The yearly license and extra modelling',
        body: (
          <>
            <p>
              <b>Before we start setting up your showroom</b>, you can cancel the license for a full refund. <b>Once setup has started</b>, the license pays for work already done and
              isn’t refundable, unless your order says otherwise or we fail to deliver the showroom, in which case we refund what we didn’t deliver.
            </p>
            <p>
              Products modelled beyond those in your license are quoted first. Cancel before modelling starts and nothing is owed; if a model we deliver doesn’t match the material
              you sent and we can’t put it right, we refund that model.
            </p>
          </>
        ),
      },
      {
        id: 'closing',
        heading: '4. If we close the service',
        body: <p>If we ever close BluModel Studio, we refund any part of the license or the monthly plan you have paid for and can no longer use.</p>,
      },
      {
        id: 'earlier',
        heading: '5. Purchases made before 17 October 2026',
        body: (
          <p>
            Kitchen unlocks, the Unlimited and Contractor plans and custom model orders bought before then keep the refund terms they were sold with: an unused kitchen unlock within
            14 days of paying, an unwanted plan renewal within 7 days if nothing was exported since, and a model order before modelling started. Ask us as described below.
          </p>
        ),
      },
      {
        id: 'how',
        heading: '6. How to ask',
        body: (
          <>
            <p>
              Contact us {w.contact} and say which showroom and which payment it is: the date and amount on the invoice or receipt is enough. Refunds go back the way you paid: to the
              card through Stripe, where your bank usually shows them within 5 to 10 business days, or by the same method as the invoice was paid.
            </p>
            <p>Please contact us before disputing a charge with your bank: it is quicker, and a dispute can pause the showroom while it is open.</p>
          </>
        ),
      },
      ...(w.payments === 'demo'
        ? [
            {
              id: 'demo',
              heading: '7. Demo payments',
              body: <p>A checkout marked DEMO is a simulation. Nothing is charged, so there is nothing to refund.</p>,
            },
          ]
        : []),
      { id: 'contact', heading: w.payments === 'demo' ? '8. Contact' : '7. Contact', body: <ContactBlock w={w} /> },
    ],
  };
}

export function legalDoc(id: LegalDocId, legal: LegalConfig, payments: PaymentsMode | null = null): LegalDoc {
  const w = legalWords(legal, payments);
  return id === 'terms' ? termsDoc(w) : id === 'privacy' ? privacyDoc(w) : refundsDoc(w);
}
