# Supabase Auth Email Setup

Use this when running PostFreely on Cloudflare Pages with Supabase Auth.

## Redirect URLs

In Supabase `Authentication -> URL Configuration` set:

- `Site URL`: `https://postfreely.pages.dev`
- Additional redirect URLs:
  - `https://postfreely.pages.dev/auth/callback.html`
  - `https://postfreely.pages.dev/auth/confirm.html`

PostFreely signup now requests `https://postfreely.pages.dev/auth/callback.html` as the email confirmation redirect so the session can be restored automatically after the user confirms their email.

## Custom confirmation email

In Supabase `Authentication -> Email Templates`, replace the default confirmation template with a PostFreely-branded version like this:

```html
<h2>Confirm your PostFreely account</h2>
<p>One more step and your workspace will be ready.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm.html?confirmation_url={{ .ConfirmationURL }}">
    Confirm email
  </a>
</p>
<p>If you did not create this account, you can safely ignore this message.</p>
```

That template sends the user to PostFreely's branded confirmation page first, then forwards them to the Supabase confirmation URL.

## Custom SMTP

Supabase's built-in test sender is limited and not intended for production. Configure custom SMTP in `Authentication -> Settings -> SMTP Settings` if you want:

- email delivery to addresses outside your Supabase team
- your own sender address
- reliable production delivery
- branded account emails

## Important note about duplicate emails

With email confirmations enabled, Supabase may intentionally return a generic signup response instead of explicitly saying that an email already exists. That behavior is a security/privacy feature to reduce account enumeration. PostFreely now shows clearer guidance in the UI, but the exact duplicate-email check is still constrained by Supabase auth behavior.
