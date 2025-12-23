# render-server

# Menu Discovery Script Server

Simple Express server to host the Menu Discovery script for Chrome extension.

## Deploy to Render

1. **Create a new Web Service on Render**
   - Connect your GitHub repository
   - Select this directory (`render-server`) as the root
   - Build command: `npm install`
   - Start command: `npm start`

2. **Environment Variables**
   - `PORT` - Automatically set by Render (defaults to 10000)

3. **After Deployment**
   - Your script will be available at: `https://your-service.onrender.com/menu-discovery.js`
   - Update the Chrome extension to use this URL

## Local Development

```bash
npm install
npm start
```

The server will run on `http://localhost:10000`

## Endpoints

- `GET /menu-discovery.js` - Serves the Menu Discovery script
- `GET /health` - Health check endpoint
- `GET /` - Service information

## CORS

The server is configured to allow requests from any origin (Chrome extensions need this).

