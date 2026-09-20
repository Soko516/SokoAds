# SokoAds deployment

## Production checklist

Configure these environment variables in Render (never commit real credentials):

- `PESAPAL_ENV=SANDBOX` until the complete payment flow is tested; use `LIVE` only afterward.
- `PESAPAL_CONSUMER_KEY`
- `PESAPAL_CONSUMER_SECRET`
- `PUBLIC_BASE_URL=https://your-real-domain.example` (no trailing slash)
- `ADMIN_PASSWORD` (at least 12 random characters)
- `PESAPAL_IPN_ID`

After deployment, open `/health`. Before live payments it must report `ok: true`, `paymentConfigured: true`, and `ipnConfigured: true`. Register the IPN from the Admin section, save the returned ID as `PESAPAL_IPN_ID`, then restart the service.

Test a small sandbox payment and verify the redirect, callback, IPN, and status confirmation. The server verifies transaction status with PesaPal before changing an ad to `Paid`.

The JSON file database is suitable only for a small single instance. Use PostgreSQL and object storage before significant production traffic; free hosting may lose local files.
