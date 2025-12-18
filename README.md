# SmartResumeFix — Web App (Indian UPI via Razorpay)

This package contains a ready-to-deploy web app that accepts Razorpay (UPI/cards) payments and automatically generates AI-improved resume PDFs.

## What's included
- server.js (Node.js/Express backend)
- public/index.html (simple frontend)
- package.json
- .env.example
- /resumes directory (generated PDFs)

## Deploy on Replit (quick steps)
1. Create a new Repl (Node.js) at https://replit.com/
2. Upload this ZIP contents or copy files into the project
3. Add Secrets (🔑) in Replit: set variables from `.env.example` values to real keys
4. Run `npm install` in the Shell
5. Start the server: `npm start` or press Run
6. Visit the public URL shown by Replit and test

## Notes
- Use Razorpay test keys while testing. UPI may not simulate in test mode; use test card flows.
- Replace `<REPLACE_WITH_YOUR_KEY_ID>` in `public/index.html` or modify frontend to fetch key server-side.
- OpenAI usage costs money; monitor your usage.

If you want, I can guide you step-by-step through Replit deployment (safe: you paste keys into Replit only).