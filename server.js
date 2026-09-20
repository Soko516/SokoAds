const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ADS_FILE = path.join(DATA_DIR, 'ads.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PESAPAL_ENV = (process.env.PESAPAL_ENV || 'SANDBOX').toUpperCase();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ADS_FILE)) {
    fs.writeFileSync(ADS_FILE, '[]\n', 'utf8');
  }
}

function readAds() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(ADS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeAds(ads) {
  ensureDataFile();
  fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2) + '\n', 'utf8');
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function buildPesapalBaseUrl() {
  return PESAPAL_ENV === 'LIVE'
    ? 'https://pay.pesapal.com/pesapalv3'
    : 'https://cybqa.pesapal.com/pesapalv3';
}

async function requestPesapalToken() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('PesaPal credentials are not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET in the environment.');
  }

  const response = await fetch(`${buildPesapalBaseUrl()}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consumer_key: consumerKey,
      consumer_secret: consumerSecret,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Unable to request PesaPal token.');
  }

  const token = data.token || data.access_token || data.Token;
  if (!token) {
    throw new Error('PesaPal token not returned by the API.');
  }

  return token;
}

async function createPesapalOrder({ adId, packageType, amount, firstName, lastName, email, phone }) {
  const token = await requestPesapalToken();
  const orderId = `SOKO-${Date.now()}-${String(adId).slice(-8)}`;
  const callbackUrl = `${PUBLIC_BASE_URL}/api/pesapal/callback`;
  const notificationId = process.env.PESAPAL_IPN_ID || '';

  const payload = {
    id: orderId,
    currency: 'TZS',
    amount: String(amount),
    description: `SokoAds ad package: ${packageType}`,
    callback_url: callbackUrl,
    cancellation_url: `${PUBLIC_BASE_URL}/`,
    notification_id: notificationId,
    billing_address: {
      email_address: email || 'noreply@example.com',
      phone_number: phone || '255000000000',
      country_code: 'TZ',
      first_name: firstName || 'Customer',
      last_name: lastName || 'User',
    },
    contact: {
      email_address: email || 'noreply@example.com',
      phone_number: phone || '255000000000',
      first_name: firstName || 'Customer',
      last_name: lastName || 'User',
    },
  };

  const response = await fetch(`${buildPesapalBaseUrl()}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Unable to create PesaPal order.');
  }

  const redirectUrl = data.redirect_url || data.redirectUrl || data.payment_url || data.paymentUrl || '';
  if (!redirectUrl) {
    throw new Error('PesaPal returned no redirect URL.');
  }

  return {
    orderId,
    redirect_url: redirectUrl,
    reference: data.order_reference || orderId,
  };
}

app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    env: PESAPAL_ENV,
    time: new Date().toISOString(),
  });
});

app.get('/api/ads', (req, res) => {
  res.json(readAds());
});

app.post('/api/ads', (req, res) => {
  const body = req.body || {};
  const name = sanitizeText(body.name, 'Untitled ad');
  const price = Number(body.price) || 0;
  const category = sanitizeText(body.category, 'General');
  const phone = sanitizeText(body.phone, '');
  const desc = sanitizeText(body.desc, '');
  const image = sanitizeText(body.image, '');
  const featured = !!body.featured;

  if (!name || !phone || price <= 0) {
    return res.status(400).json({ error: 'Name, phone, and price are required.' });
  }

  const ads = readAds();
  const ad = {
    id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    price,
    category,
    phone,
    desc,
    image: image || '',
    featured,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };

  ads.unshift(ad);
  writeAds(ads);
  return res.status(201).json(ad);
});

app.get('/api/admin/ads', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }

  return res.json(readAds());
});

app.post('/api/pesapal/register-ipn', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }

  const ipnId = process.env.PESAPAL_IPN_ID || `IPN-${Date.now()}`;
  process.env.PESAPAL_IPN_ID = ipnId;

  return res.json({
    ok: true,
    ipn_id: ipnId,
    message: 'Use this value in your PesaPal IPN configuration and restart the server.',
  });
});

app.post('/api/pesapal/pay', async (req, res) => {
  const body = req.body || {};
  const adId = sanitizeText(body.adId, '');
  const packageType = sanitizeText(body.packageType, 'Basic');
  const firstName = sanitizeText(body.firstName, 'Customer');
  const lastName = sanitizeText(body.lastName, 'User');
  const email = sanitizeText(body.email, 'noreply@example.com');
  const phone = sanitizeText(body.phone, '255000000000');

  if (!adId) {
    return res.status(400).json({ error: 'Missing adId.' });
  }

  const ads = readAds();
  const ad = ads.find((item) => item.id === adId);
  const amount = Number(ad?.price || body.amount || 0) || (packageType === 'Featured' ? 50000 : 2000);

  try {
    const result = await createPesapalOrder({
      adId,
      packageType,
      amount,
      firstName,
      lastName,
      email,
      phone,
    });

    return res.json({
      ok: true,
      ...result,
      message: 'Redirecting to PesaPal...',
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error.message || 'Payment request failed.',
    });
  }
});

app.post('/api/pesapal/callback', (req, res) => {
  const data = req.body || {};
  const orderReference = sanitizeText(data.OrderMerchantReference || data.order_reference || data.orderReference || '', '');
  const status = sanitizeText(data.status || data.Status || '', '');

  if (orderReference) {
    const ads = readAds();
    const updated = ads.map((item) => (
      item.id === orderReference || item.orderReference === orderReference
        ? { ...item, status: status || 'Paid', orderReference }
        : item
    ));
    writeAds(updated);
  }

  return res.status(200).send('OK');
});

app.post('/api/pesapal/ipn', (req, res) => {
  const data = req.body || {};
  const orderReference = sanitizeText(data.OrderMerchantReference || data.order_reference || data.orderReference || '', '');
  const status = sanitizeText(data.status || data.Status || '', '');

  if (orderReference) {
    const ads = readAds();
    const updated = ads.map((item) => (
      item.id === orderReference || item.orderReference === orderReference
        ? { ...item, status: status || 'Paid', orderReference }
        : item
    ));
    writeAds(updated);
  }

  return res.status(200).send('OK');
});

app.use(express.static(__dirname));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SokoAds server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
