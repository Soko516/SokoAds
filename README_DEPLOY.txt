SokoAds Render deployment

IMPORTANT: The current Render URL showing "Not Found" / "Hello, World!" indicates Render is serving a different starter service/repository, not this SokoAds project. This package is ready for a Node Web Service.

Render settings:
- Runtime: Node
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /health
- Root Directory: leave blank (project files must be at repository root)

Environment variables:
- PESAPAL_ENV=SANDBOX
- PESAPAL_CONSUMER_KEY=your key
- PESAPAL_CONSUMER_SECRET=your secret
- ADMIN_PASSWORD=your admin password

After deploy, test:
- https://YOUR-SERVICE.onrender.com/health
- https://YOUR-SERVICE.onrender.com/

Do not use the Render "Hello World" starter repository for this service.
