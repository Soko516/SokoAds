const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ADS_FILE = path.join(DATA_DIR, 'ads.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PESAPAL_ENV = (process.env.PESAPAL_ENV || 'SANDBOX').toUpperCase();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const VALID_ENVIRONMENTS = new Set(['SANDBOX', 'LIVE']);

if (!VALID_ENVIRONMENTS.has(PESAPAL_ENV)) throw new Error('PESAPAL_ENV must be SANDBOX or LIVE.');
if (PESAPAL_ENV === 'LIVE' && (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12)) {
  throw new Error('Set ADMIN_PASSWORD to a random value of at least 12 characters before running LIVE.');
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ADS_FILE)) fs.writeFileSync(ADS_FILE, '[]\n', 'utf8');
}
function readAds() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
function writeAds(ads) {
  ensureDataFile();
  const temp = `${ADS_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(ads, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, ADS_FILE);
}
function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function pesapalBaseUrl() {
  return PESAPAL_ENV === 'LIVE' ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
}
function adminOnly(req, res, next) {
  if (!ADMIN_PASSWORD || req.get('x-admin-password') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid admin password.' });
  next();
}
async function pesapalRequest(endpoint, options = {}) {
  const response = await fetch(`${pesapalBaseUrl()}${endpoint}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `PesaPal request failed (${response.status}).`);
  return data;
}
async function requestPesapalToken() {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('PesaPal credentials are not configured.');
  const data = await pesapalRequest('/api/Auth/RequestToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consumer_key: key, consumer_secret: secret }),
  });
  const token = data.token || data.access_token || data.Token;
  if (!token) throw new Error('PesaPal did not return an access token.');
  return token;
}
async function authenticatedRequest(endpoint, token, options = {}) {
  return pesapalRequest(endpoint, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
}
async function getTransactionStatus(orderTrackingId) {
  const token = await requestPesapalToken();
  return authenticatedRequest(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, token);
}
function statusName(data) {
  const code = Number(data.status_code ?? data.statusCode);
  const value = String(data.payment_status_description || data.paymentStatusDescription || data.status || '').toLowerCase();
  if (code === 1 || ['completed', 'paid', 'success', 'successful'].includes(value)) return 'Paid';
  if (code === 2 || code === 3 || ['failed', 'reversed', 'cancelled', 'canceled'].includes(value)) return 'Failed';
  return 'Pending';
}
async function reconcilePayment(orderTrackingId, merchantReference) {
  if (!orderTrackingId || !merchantReference) return 'Pending';
  const result = await getTransactionStatus(orderTrackingId);
  const status = statusName(result);
  const ads = readAds();
  const updated = ads.map((ad) => ad.orderReference === merchantReference ? { ...ad, status, orderTrackingId, paymentStatus: result } : ad);
  writeAds(updated);
  return status;
}

app.use(express.json({ limit: '5mb' }));
app.get('/health', (req, res) => res.json({ ok: true, status: 'healthy', env: PESAPAL_ENV, paymentConfigured: !!(process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_CONSUMER_SECRET), ipnConfigured: !!process.env.PESAPAL_IPN_ID, time: new Date().toISOString() }));
app.get('/api/ads', (req, res) => res.json(readAds().map(({ paymentStatus, ...ad }) => ad)));

app.post('/api/ads', (req, res) => {
  const body = req.body || {};
  const ad = { id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: text(body.name, 'Untitled ad'), price: Number(body.price), category: text(body.category, 'General'), phone: text(body.phone), desc: text(body.desc), image: text(body.image), featured: !!body.featured, status: 'Pending', createdAt: new Date().toISOString() };
  if (!ad.name || !ad.phone || !Number.isFinite(ad.price) || ad.price <= 0) return res.status(400).json({ error: 'Name, phone, and a positive price are required.' });
  const ads = readAds(); ads.unshift(ad); writeAds(ads); res.status(201).json(ad);
});
app.get('/api/admin/ads', adminOnly, (req, res) => res.json(readAds()));

app.post('/api/pesapal/register-ipn', adminOnly, async (req, res) => {
  try {
    const token = await requestPesapalToken();
    const data = await authenticatedRequest('/api/URLSetup/RegisterIPN', token, { method: 'POST', body: JSON.stringify({ url: `${PUBLIC_BASE_URL}/api/pesapal/ipn`, ipn_notification_type: 'POST' }) });
    const ipnId = data.ipn_id || data.ipnId || data.id;
    if (!ipnId) throw new Error('PesaPal did not return an IPN ID.');
    res.json({ ok: true, ipn_id: ipnId, message: 'Save this IPN ID as PESAPAL_IPN_ID in the deployment environment and restart.' });
  } catch (error) { res.status(502).json({ ok: false, error: error.message }); }
});

app.post('/api/pesapal/pay', async (req, res) => {
  const body = req.body || {};
  const adId = text(body.adId);
  const ad = readAds().find((item) => item.id === adId);
  if (!ad) return res.status(404).json({ error: 'Advertisement not found.' });
  if (!process.env.PESAPAL_IPN_ID) return res.status(503).json({ error: 'Payment is not configured: register the PesaPal IPN and set PESAPAL_IPN_ID.' });
  try {
    const token = await requestPesapalToken();
    const orderReference = `SOKO-${Date.now()}-${ad.id.slice(-8)}`;
    const payload = { id: orderReference, currency: 'TZS', amount: ad.price.toFixed(2), description: `SokoAds ad package: ${text(body.packageType, 'Basic')}`, callback_url: `${PUBLIC_BASE_URL}/api/pesapal/callback`, cancellation_url: `${PUBLIC_BASE_URL}/`, notification_id: process.env.PESAPAL_IPN_ID, billing_address: { email_address: text(body.email, 'noreply@example.com'), phone_number: text(body.phone, ad.phone), country_code: 'TZ', first_name: text(body.firstName, 'Customer'), last_name: text(body.lastName, 'User') } };
    const data = await authenticatedRequest('/api/Transactions/SubmitOrderRequest', token, { method: 'POST', body: JSON.stringify(payload) });
    const redirectUrl = data.redirect_url || data.redirectUrl;
    if (!redirectUrl) throw new Error('PesaPal returned no redirect URL.');
    const ads = readAds(); writeAds(ads.map((item) => item.id === ad.id ? { ...item, orderReference, status: 'Awaiting payment' } : item));
    res.json({ ok: true, orderId: data.order_tracking_id || data.orderTrackingId || orderReference, orderReference, redirect_url: redirectUrl });
  } catch (error) { res.status(502).json({ ok: false, error: error.message || 'Payment request failed.' }); }
});

async function paymentNotification(req, res) {
  const data = { ...(req.query || {}), ...(req.body || {}) };
  const trackingId = text(data.OrderTrackingId || data.order_tracking_id || data.orderTrackingId);
  const reference = text(data.OrderMerchantReference || data.order_merchant_reference || data.orderReference || data.order_reference);
  if (!trackingId || !reference) return res.status(400).send('Missing payment reference.');
  try { await reconcilePayment(trackingId, reference); res.status(200).send('OK'); }
  catch (error) { console.error('PesaPal verification failed:', error.message); res.status(502).send('Verification failed'); }
}
app.get('/api/pesapal/callback', paymentNotification);
app.post('/api/pesapal/callback', paymentNotification);
app.post('/api/pesapal/ipn', paymentNotification);
app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`SokoAds listening on port ${PORT} (${PESAPAL_ENV})`));
