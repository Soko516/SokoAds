const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();
const ai = require('./ai');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ADS_FILE = path.join(DATA_DIR, 'ads.json');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const PESAPAL_ENV = String(process.env.PESAPAL_ENV || 'SANDBOX').toUpperCase();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

if (!['SANDBOX', 'LIVE'].includes(PESAPAL_ENV)) throw new Error('PESAPAL_ENV must be SANDBOX or LIVE.');
if (PESAPAL_ENV === 'LIVE' && ADMIN_PASSWORD.length < 12) {
  throw new Error('Set ADMIN_PASSWORD to at least 12 characters before running LIVE.');
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ADS_FILE)) fs.writeFileSync(ADS_FILE, '[]\n', 'utf8');
}

function readAds() {
  ensureDataFile();
  try {
    const value = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8') || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error('Could not read ads database:', error.message);
    return [];
  }
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

function baseUrl() {
  return PESAPAL_ENV === 'LIVE' ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
}

function adminOnly(req, res, next) {
  if (!ADMIN_PASSWORD || req.get('x-admin-password') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }
  next();
}

async function pesapalRequest(endpoint, options = {}) {
  const response = await fetch(`${baseUrl()}${endpoint}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `PesaPal request failed (${response.status}).`);
  return data;
}

async function token() {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('PesaPal credentials are not configured.');
  const data = await pesapalRequest('/api/Auth/RequestToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consumer_key: key, consumer_secret: secret })
  });
  const value = data.token || data.access_token || data.Token;
  if (!value) throw new Error('PesaPal did not return an access token.');
  return value;
}

function authorized(endpoint, accessToken, options = {}) {
  return pesapalRequest(endpoint, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
}

async function transactionStatus(orderTrackingId) {
  return authorized(
    `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    await token()
  );
}

function paymentStatus(data) {
  const code = Number(data.status_code ?? data.statusCode);
  const value = String(data.payment_status_description || data.paymentStatusDescription || data.status || '').toLowerCase();
  if (code === 1 || ['completed', 'paid', 'success', 'successful'].includes(value)) return 'Paid';
  if (code === 2 || code === 3 || ['failed', 'reversed', 'cancelled', 'canceled'].includes(value)) return 'Failed';
  return 'Pending';
}

async function verifyAndSave(trackingId, reference) {
  const result = await transactionStatus(trackingId);
  const status = paymentStatus(result);
  const ads = readAds();
  const index = ads.findIndex((ad) => ad.orderReference === reference);
  if (index >= 0) {
    ads[index] = { ...ads[index], status, orderTrackingId: trackingId, paymentStatus: result };
    writeAds(ads);
  }
  return { status, ...result };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/health', (req, res) => res.json({
  ok: true,
  status: 'healthy',
  env: PESAPAL_ENV,
  paymentConfigured: Boolean(process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_CONSUMER_SECRET),
  ipnConfigured: Boolean(process.env.PESAPAL_IPN_ID)
}));

app.post('/api/ai/chat', async (req, res) => {
  try {
    const message = text(req.body?.message);
    if (!message) return res.status(400).json({ error: 'Message is required.' });
    const answer = await ai.chat(message, readAds());
    res.json({ ok:true, answer });
  } catch (error) {
    res.status(error.status || 500).json({ ok:false, error:error.message });
  }
});

app.post('/api/ai/write-ad', async (req, res) => {
  try {
    const result = await ai.writeAd(req.body || {});
    res.json({ ok:true, result });
  } catch (error) {
    res.status(error.status || 500).json({ ok:false, error:error.message });
  }
});

app.get('/api/ads', (req, res) => {
  res.json(readAds().map(({ paymentStatus: _, ...ad }) => ad));
});


app.post('/api/upload-image', (req, res) => {
  try {
    const dataUrl = text(req.body?.dataUrl);
    if (!dataUrl || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUrl)) {
      return res.status(400).json({ error: 'Tuma picha ya JPG, PNG au WebP.' });
    }
    const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    const ext = match[1].toLowerCase() === 'jpg' ? 'jpg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'Picha ni kubwa sana. Tumia picha chini ya 2MB.' });
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `product-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    return res.status(201).json({ ok: true, url: `/uploads/${filename}` });
  } catch (error) {
    return res.status(500).json({ error: 'Imeshindikana kuhifadhi picha.' });
  }
});

app.post('/api/ads', (req, res) => {
  const body = req.body || {};
  const ad = {
    id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: text(body.name),
    price: Number(body.price),
    category: text(body.category, 'General'),
    phone: text(body.phone),
    desc: text(body.desc, ''),
    image: text(body.image, ''),
    featured: Boolean(body.featured),
    status: 'Pending',
    createdAt: new Date().toISOString()
  };
  if (!ad.name || !ad.phone || !Number.isFinite(ad.price) || ad.price <= 0) {
    return res.status(400).json({ error: 'Name, phone, and a positive price are required.' });
  }
  const ads = readAds();
  ads.unshift(ad);
  writeAds(ads);
  return res.status(201).json(ad);
});

app.get('/api/admin/ads', adminOnly, (req, res) => res.json(readAds()));

app.get('/api/admin/stats', adminOnly, (req, res) => {
  const ads = readAds();
  const paid = ads.filter((ad) => ad.status === 'Paid');
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday);
  startWeek.setDate(startToday.getDate() - startToday.getDay());
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const revenue = (list) => list.reduce((sum, ad) => sum + Number(ad.packageAmount || (String(ad.packageType).toLowerCase() === 'featured' ? 5000 : 2000)), 0);
  const created = (ad) => new Date(ad.createdAt || 0);
  res.json({
    ok: true,
    currency: 'TZS',
    totals: {
      revenue: revenue(paid),
      paidAds: paid.length,
      featuredPaid: paid.filter((ad) => String(ad.packageType).toLowerCase() === 'featured').length,
      basicPaid: paid.filter((ad) => String(ad.packageType).toLowerCase() !== 'featured').length,
      totalAds: ads.length,
      pendingAds: ads.filter((ad) => ad.status !== 'Paid').length
    },
    periods: {
      today: revenue(paid.filter((ad) => created(ad) >= startToday)),
      week: revenue(paid.filter((ad) => created(ad) >= startWeek)),
      month: revenue(paid.filter((ad) => created(ad) >= startMonth))
    },
    transactions: paid.slice(0, 100).map((ad) => ({
      id: ad.id,
      name: ad.name,
      packageType: ad.packageType || (ad.featured ? 'Featured' : 'Basic'),
      amount: Number(ad.packageAmount || (ad.featured ? 5000 : 2000)),
      status: ad.status,
      orderReference: ad.orderReference || '',
      orderTrackingId: ad.orderTrackingId || '',
      createdAt: ad.createdAt || ''
    }))
  });
});

app.post('/api/pesapal/register-ipn', adminOnly, async (req, res) => {
  try {
    const data = await authorized('/api/URLSetup/RegisterIPN', await token(), {
      method: 'POST',
      body: JSON.stringify({ url: `${PUBLIC_BASE_URL}/api/pesapal/ipn`, ipn_notification_type: 'POST' })
    });
    const ipnId = data.ipn_id || data.ipnId || data.id;
    if (!ipnId) throw new Error('PesaPal did not return an IPN ID.');
    return res.json({ ok: true, ipn_id: ipnId, message: 'Save this value as PESAPAL_IPN_ID and restart the service.' });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message });
  }
});

app.post('/api/pesapal/pay', async (req, res) => {
  const body = req.body || {};
  const ad = readAds().find((item) => item.id === text(body.adId));
  if (!ad) return res.status(404).json({ error: 'Advertisement not found.' });
  if (!process.env.PESAPAL_IPN_ID) return res.status(503).json({ error: 'Payment is not configured: register the PesaPal IPN first.' });

  try {
    const reference = `SOKO-${Date.now()}-${ad.id.slice(-8)}`;
    const packageType = text(body.packageType, 'Basic').toLowerCase() === 'featured' ? 'Featured' : 'Basic';
    const amount = packageType === 'Featured' ? 5000 : 2000;
    const payload = {
      id: reference,
      currency: 'TZS',
      amount: amount.toFixed(2),
      description: `SokoAds ${packageType} advertising package`,
      callback_url: `${PUBLIC_BASE_URL}/api/pesapal/callback`,
      notification_id: process.env.PESAPAL_IPN_ID,
      billing_address: {
        email_address: text(body.email, 'customer@example.com'),
        phone_number: text(body.phone, ad.phone),
        first_name: text(body.firstName, 'SokoAds'),
        last_name: text(body.lastName, 'Customer')
      }
    };
    const data = await authorized('/api/Transactions/SubmitOrderRequest', await token(), {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const redirectUrl = data.redirect_url || data.redirectUrl;
    if (!redirectUrl) throw new Error('PesaPal returned no redirect URL.');
    writeAds(readAds().map((item) => item.id === ad.id
      ? { ...item, orderReference: reference, status: 'Awaiting payment', packageType, packageAmount: amount }
      : item));
    return res.json({ ok: true, orderId: data.order_tracking_id || data.orderTrackingId || reference, orderReference: reference, redirect_url: redirectUrl });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message || 'Payment request failed.' });
  }
});

app.get('/api/pesapal/status', async (req, res) => {
  const trackingId = text(req.query.OrderTrackingId || req.query.orderTrackingId);
  if (!trackingId) return res.status(400).json({ error: 'Missing OrderTrackingId.' });
  try {
    return res.json(await transactionStatus(trackingId));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

function paymentData(req) {
  return { ...(req.query || {}), ...(req.body || {}) };
}

async function paymentNotification(req, res) {
  const data = paymentData(req);
  const trackingId = text(data.OrderTrackingId || data.order_tracking_id || data.orderTrackingId);
  const reference = text(data.OrderMerchantReference || data.order_merchant_reference || data.orderReference || data.order_reference);
  if (!trackingId || !reference) return res.status(400).send('Missing payment reference.');
  try {
    const result = await verifyAndSave(trackingId, reference);
    return res.status(200).json(result);
  } catch (error) {
    console.error('PesaPal verification failed:', error.message);
    return res.status(502).send('Verification failed');
  }
}

async function paymentCallback(req, res) {
  const data = paymentData(req);
  const trackingId = text(data.OrderTrackingId || data.order_tracking_id || data.orderTrackingId);
  const reference = text(data.OrderMerchantReference || data.order_merchant_reference || data.orderReference || data.order_reference);
  if (!trackingId || !reference) return res.redirect('/payment-success.html');
  try {
    await verifyAndSave(trackingId, reference);
  } catch (error) {
    console.error('PesaPal callback verification failed:', error.message);
  }
  return res.redirect(`/payment-success.html?OrderTrackingId=${encodeURIComponent(trackingId)}`);
}

app.get('/api/pesapal/callback', paymentCallback);
app.post('/api/pesapal/callback', paymentCallback);
app.post('/api/pesapal/ipn', paymentNotification);
app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`SokoAds listening on port ${PORT} (${PESAPAL_ENV})`));
