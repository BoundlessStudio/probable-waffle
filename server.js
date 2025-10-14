import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_MODEL = "gpt-realtime-preview";

export function createApp({ fetchImpl = fetch, model = process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL } = {}) {
  const app = express();

  app.use(express.static("public"));

  app.get("/session", async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Missing OPENAI_API_KEY environment variable." });
      return;
    }

    try {
      const response = await fetchImpl("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice: process.env.OPENAI_VOICE || "verse",
          modalities: ["text", "audio"],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        res.status(response.status).json({ error: "Failed to create session", details: errorBody });
        return;
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch session token", error);
      res.status(500).json({ error: "Failed to fetch session token" });
    }
  });

  return app;
}

const PORT = process.env.PORT || 3000;

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}
