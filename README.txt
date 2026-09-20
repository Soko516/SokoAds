SOKOADS v2 — PESAPAL API 3.0 READY

Hii ni version iliyoboreshwa kutoka MVP. Ina backend ya Node/Express na PesaPal API 3.0.

MUHIMU:
- Usitie Consumer Secret kwenye index.html/browser.
- Usitume Consumer Key/Secret, password au OTP hapa kwenye chat.
- Malipo ya LIVE hayatafanya kazi mpaka credentials zako ziwekwe kwenye .env na website iwe kwenye public HTTPS domain.

1) Install Node.js 18+.
2) Fungua terminal ndani ya folder hili.
3) Run: npm install
4) Copy .env.example kwenda .env
5) Jaza:
   PESAPAL_ENV=SANDBOX (anza na SANDBOX) au LIVE
   PESAPAL_CONSUMER_KEY=...
   PESAPAL_CONSUMER_SECRET=...
   PUBLIC_BASE_URL=https://domain-yako.com
   ADMIN_PASSWORD=...
6) Run: npm start
7) Fungua http://localhost:3000 kwa local test.

IPN:
- Website inahitaji public IPN URL kwa PesaPal.
- Deploy website kwenye HTTPS domain kwanza.
- Ingia Admin kwenye website, bonyeza "Register PesaPal IPN".
- Chukua ipn_id itakayoonyeshwa, weka kwenye PESAPAL_IPN_ID kwenye .env, kisha restart server.
- Kwa live, tumia PESAPAL_ENV=LIVE na live credentials.

PAYMENT FLOW:
Seller anaweka tangazo -> SokoAds ina-create order -> PesaPal redirect -> customer analipa -> PesaPal callback + IPN -> server ina-verify GetTransactionStatus -> tangazo linawekwa Paid.

PRODUCTION NOTE:
Hii version bado inatumia JSON file kama database kwa urahisi wa kuanza. Kwa traffic kubwa, tumia PostgreSQL/MySQL/Supabase/Firebase na image storage ya kweli.

PesaPal docs: https://developer.pesapal.com/
