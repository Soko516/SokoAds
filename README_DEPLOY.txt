# SokoAds deployment

## Required production configuration

Set these variables in your hosting provider. Never commit credentials:

- `PESAPAL_ENV=LIVE` (use `SANDBOX` while testing)
- `PESAPAL_CONSUMER_KEY`
- `PESAPAL_CONSUMER_SECRET`
- `PUBLIC_BASE_URL=https://your-real-domain.example`
- `ADMIN_PASSWORD` (at least 12 random characters)
- `PESAPAL_IPN_ID`

The app exposes `/health`. It must report `env: LIVE`, `paymentConfigured: true`, and `ipnConfigured: true` before accepting live payments.

### Connect PesaPal

1. Deploy the service with a public HTTPS URL.
2. Open `/health` and confirm the service is healthy.
3. Log in to the Admin section and click **Register PesaPal IPN**.
4. Save the returned `ipn_id` as `PESAPAL_IPN_ID` in the host's environment settings, then redeploy/restart.
5. Make one small sandbox payment first. Switch to `LIVE` only after the complete redirect, callback, IPN, and status-verification flow succeeds.

The server never trusts a browser callback as proof of payment. It calls PesaPal `GetTransactionStatus` before changing an ad to `Paid`.

The JSON file database is suitable only for a single small instance. Use PostgreSQL or another durable database and object storage before significant production traffic; free hosting may lose local files on restart.
