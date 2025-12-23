const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for Chrome extension
app.use(
  cors({
    origin: "*",
    methods: ["GET", "HEAD"],
    allowedHeaders: ["Content-Type"],
  })
);

// Serve the menu-discovery.js script
app.get("/menu-discovery.js", (req, res) => {
  // Try local file first, then fallback to src directory
  const scriptPath = fs.existsSync(path.join(__dirname, "menu-discovery.js"))
    ? path.join(__dirname, "menu-discovery.js")
    : path.join(__dirname, "../src/menu-discovery.js");

  // Check if file exists
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: "Script file not found" });
  }

  // Read and serve the file
  fs.readFile(scriptPath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading script:", err);
      return res.status(500).json({ error: "Failed to read script" });
    }

    // Set proper headers for JavaScript
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    res.setHeader("X-Content-Type-Options", "nosniff");

    res.send(data);
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "menu-discovery-server",
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    service: "Menu Discovery Script Server",
    endpoints: {
      script: "/menu-discovery.js",
      health: "/health",
    },
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Menu Discovery Server running on port ${PORT}`);
  console.log(
    `📦 Script available at: http://localhost:${PORT}/menu-discovery.js`
  );
});
