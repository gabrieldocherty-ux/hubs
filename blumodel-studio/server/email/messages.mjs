// The emails BluModel Studio sends, as `{ subject, text }` (createMailer adds the HTML). Plain
// words, no tracking pixels or remote images, and every link points at PUBLIC_URL, never at an
// address taken from a request.

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const signOff = (supportEmail) =>
  supportEmail ? `If this wasn’t you, reply to this email or write to ${supportEmail}.\n\nBluModel Studio` : 'If this wasn’t you, reply to this email.\n\nBluModel Studio';

/** The forgot-password email: a single-use link that works for `minutes`. */
export function resetEmail({ name, url, minutes }) {
  return {
    subject: 'Reset your BluModel Studio password',
    text: `Hi ${firstName(name)},

Someone (hopefully you) asked to reset the password for your BluModel Studio account. Choose a new one here:

${url}

The link works once, for ${minutes} minutes. Using it signs you out on every device.

If you didn’t ask for this, ignore this email: your password stays the same.

BluModel Studio`,
  };
}

/** To the OLD address after the account's email changes. */
export function emailChangedEmail({ name, newEmail, supportEmail }) {
  return {
    subject: 'Your BluModel Studio email address was changed',
    text: `Hi ${firstName(name)},

The email address for your BluModel Studio account was just changed to ${newEmail}. You’ll sign in with the new address from now on, and other devices were signed out.

${signOff(supportEmail)}`,
  };
}

/** After a password change (in settings or by a reset link). */
export function passwordChangedEmail({ name, supportEmail, viaReset }) {
  return {
    subject: 'Your BluModel Studio password was changed',
    text: `Hi ${firstName(name)},

The password for your BluModel Studio account was just changed${viaReset ? ' with a reset link' : ''}. ${viaReset ? 'Every device was signed out.' : 'Your other devices were signed out.'}

${signOff(supportEmail)}`,
  };
}

/** A sign-in from a browser the account hasn't used before (Email notifications > Sign-in alerts). */
export function signInAlertEmail({ name, device, when, settingsUrl, supportEmail }) {
  return {
    subject: 'New sign-in to BluModel Studio',
    text: `Hi ${firstName(name)},

Your BluModel Studio account was just signed in to from ${device} (${when}).

If that was you, there’s nothing to do. If not, change your password and sign out the devices you don’t recognise in Account settings > Security:

${settingsUrl}

You can turn these alerts off in Account settings > Email notifications.

${signOff(supportEmail)}`,
  };
}
