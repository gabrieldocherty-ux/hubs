// The emails the showroom side sends, as `{ subject, text }` for createMailer (server/email). As in
// server/email/messages.mjs, nothing a visitor typed goes into a message to a third party: a
// showroom's lead notice says a lead arrived and links to the inbox, it never quotes the lead.
// The showroom's name is set by its staff or by us, so it may appear.

const oneLine = (s, max = 100) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/** To a new team member: set a password and sign in to the company workspace. */
export function inviteEmail({ showroom, url }) {
  const name = oneLine(showroom);
  return {
    subject: `You’ve been added to ${name}’s showroom team`,
    text: `Hello,

You’ve been added to the team for ${name}’s online showroom on BluModel Studio. Choose a password to sign in:

${url}

The link works once, for 7 days.

BluModel Studio`,
  };
}

/**
 * To an address that already has an account on the showroom and was invited to its team. The link
 * only works together with that account's own password (POST /api/auth/join); it never sets one.
 */
export function inviteAcceptEmail({ showroom, url, role }) {
  const name = oneLine(showroom);
  return {
    subject: `You’re invited to join ${name}’s showroom team`,
    text: `Hello,

You’ve been invited to join the team for ${name}’s online showroom on BluModel Studio as ${role === 'owner' ? 'an owner' : 'staff'}. You already have an account there with this address. To accept, open this link and sign in with your own password:

${url}

The link works for 7 days. If you weren’t expecting this, ignore this email: nothing changes until you accept.

BluModel Studio`,
  };
}

/** To a showroom's contact address when a visitor sends a design. */
export function leadNoticeEmail({ showroom, inboxUrl }) {
  const name = oneLine(showroom);
  return {
    subject: `New design request on ${name}’s showroom`,
    text: `Hello,

A potential customer sent a design to ${name} from your online showroom. Open Potential customers in your workspace to see it:

${inboxUrl}

BluModel Studio`,
  };
}

/**
 * To the visitor who sent a design: what they sent, to whom, and the link back to it. Nothing they
 * typed is repeated (the address is theirs, but a typo'd one would carry their notes to a stranger).
 */
export function designSentReceiptEmail({ showroom, designName, designUrl, showroomUrl }) {
  const name = oneLine(showroom);
  const design = oneLine(designName, 80);
  return {
    subject: `${name} has your design`,
    text: `Hello,

Thanks for sending ${design ? `“${design}”` : 'your design'} to ${name}. They’ll be in touch about it.

${designUrl ? `Your design, to look at again or share:
${designUrl}

` : ''}Keep designing on ${name}’s showroom:
${showroomUrl}

You’re getting this because you sent a design from ${name}’s online showroom. BluModel Studio runs the showroom for ${name}.`,
  };
}

/**
 * To SUPPORT_EMAIL (us) when a company books a call on the sales site. This one goes to our own
 * inbox, so it carries what they typed, each field on one line.
 */
export function salesLeadEmail({ lead, adminUrl }) {
  const f = (label, v, max) => `${label}: ${oneLine(v, max) || '-'}`;
  return {
    subject: `Book a call: ${oneLine(lead.company, 80) || 'a company'}`,
    text: `A company asked for a call on the sales site.

${f('Company', lead.company, 120)}
${f('Name', lead.name, 80)}
${f('Phone', lead.phone, 40)}
${f('Email', lead.email, 254)}
${f('City', lead.city, 80)}

Message:
${String(lead.message ?? '').trim().slice(0, 2000) || '-'}

Admin: ${adminUrl}`,
  };
}
