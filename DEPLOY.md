# Deploying to Render

## Step-by-Step Guide

### 1. Push to GitHub
Make sure your `render-server` folder is committed and pushed to your GitHub repository.

### 2. Create Render Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `menu-discovery-server` (or your preferred name)
   - **Root Directory**: (leave empty - repository root is already the server directory)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free tier is fine for this

### 3. Deploy

Click **"Create Web Service"** and Render will:
- Install dependencies
- Start the server
- Provide you with a URL like: `https://menu-discovery-server.onrender.com`

### 4. Update Chrome Extension

After deployment, update the script URL in `chrome-extension/content/content.js`:

```javascript
const SCRIPT_URL = 'https://your-service-name.onrender.com/menu-discovery.js';
```

Or add it to `manifest.json`:

```json
{
  "script_url": "https://your-service-name.onrender.com/menu-discovery.js"
}
```

### 5. Test

1. Reload your Chrome extension
2. Open any website
3. Click the extension icon
4. Click "Start Detection"
5. Check the browser console - you should see the script loading

## Troubleshooting

### Script not loading?
- Check Render logs: Dashboard → Your Service → Logs
- Verify the URL is correct
- Check CORS headers in browser DevTools → Network tab

### 404 Error?
- Make sure `menu-discovery.js` exists in the `render-server/` directory
- The server looks for the file locally first, then falls back to `../menu-discovery/src/menu-discovery.js`

### CORS Issues?
- The server already has CORS enabled for all origins
- Chrome extensions should work without additional CORS config

## Free Tier Notes

Render's free tier:
- ✅ Perfect for this use case
- ⚠️ Services spin down after 15 minutes of inactivity
- ⚠️ First request after spin-down may be slow (~30s)
- 💡 Consider upgrading to paid tier for production use

