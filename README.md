# website

## Contact form email delivery

The contact form now posts to `/api/contact`, a Vercel-compatible serverless function
that relays submissions through the [Resend](https://resend.com/) email API. Configure
the following environment variables for production deployments:

- `RESEND_API_KEY` – Resend API key used to authorize requests.
- `CONTACT_RECIPIENT` – The email address that should receive contact requests.
- `CONTACT_SENDER` *(optional)* – Overrides the `from` address used when sending mail
  (defaults to `CDNguru <no-reply@cdnguru.com>`).
- `CONTACT_ALLOW_ORIGIN` *(optional)* – Restricts CORS responses to a specific origin.

Without these values the endpoint will return a `500` response indicating that the
email service is not configured.
