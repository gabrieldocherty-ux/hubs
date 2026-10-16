// The emails BluModel Studio sends, as `{ subject, text }` (createMailer adds the HTML). Plain
// words, no tracking pixels or remote images, and every link points at PUBLIC_URL, never at an
// address taken from a request.
//
// No account's display name goes into a message: a name is whatever was typed at sign-up, and one
// like "https://evil.example/verify-account" would turn into a link inside an official email
// (mail clients auto-link URLs in plain text, and textToHtml links them in the HTML part). Every
// message opens with the same neutral greeting instead.

const GREETING = 'Hello,';
const signOff = (supportEmail) =>
  supportEmail ? `If this wasn’t you, reply to this email or write to ${supportEmail}.\n\nBluModel Studio` : 'If this wasn’t you, reply to this email.\n\nBluModel Studio';

/** The forgot-password email: a single-use link that works for `minutes`. */
export function resetEmail({ url, minutes }) {
  return {
    subject: 'Reset your BluModel Studio password',
    text: `${GREETING}

Someone (hopefully you) asked to reset the password for your BluModel Studio account. Choose a new one here:

${url}

The link works once, for ${minutes} minutes. Using it signs you out on every device.

If you didn’t ask for this, ignore this email: your password stays the same.

BluModel Studio`,
  };
}

/** To the OLD address after the account's email changes. */
export function emailChangedEmail({ newEmail, supportEmail }) {
  return {
    subject: 'Your BluModel Studio email address was changed',
    text: `${GREETING}

The email address for your BluModel Studio account was just changed to ${newEmail}. You’ll sign in with the new address from now on, and other devices were signed out.

${signOff(supportEmail)}`,
  };
}

/** After a password change (in settings or by a reset link). */
export function passwordChangedEmail({ supportEmail, viaReset }) {
  return {
    subject: 'Your BluModel Studio password was changed',
    text: `${GREETING}

The password for your BluModel Studio account was just changed${viaReset ? ' with a reset link' : ''}. ${viaReset ? 'Every device was signed out.' : 'Your other devices were signed out.'}

${signOff(supportEmail)}`,
  };
}

/** A sign-in from a browser the account hasn't used before (Email notifications > Sign-in alerts). */
export function signInAlertEmail({ device, when, settingsUrl, supportEmail }) {
  return {
    subject: 'New sign-in to BluModel Studio',
    text: `${GREETING}

Your BluModel Studio account was just signed in to from ${device} (${when}).

If that was you, there’s nothing to do. If not, change your password and sign out the devices you don’t recognise in Account settings > Security:

${settingsUrl}

You can turn these alerts off in Account settings > Email notifications.

${signOff(supportEmail)}`,
  };
}
