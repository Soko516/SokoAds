services:
  - type: web
    name: sokoads-pesapal
    runtime: node
    plan: starter
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
      - key: PUBLIC_BASE_URL
        value: https://your-app.onrender.com
      - key: PESAPAL_ENV
        value: SANDBOX
      - key: PESAPAL_CONSUMER_KEY
        sync: false
      - key: PESAPAL_CONSUMER_SECRET
        sync: false
      - key: PESAPAL_IPN_ID
        sync: false
      - key: ADMIN_PASSWORD
        sync: false
