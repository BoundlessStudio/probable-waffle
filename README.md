# Realtime Map-Aware Voice Chat Demo

A proof-of-concept web application that combines Google Maps with OpenAI's Realtime API so you can talk with an AI assistant while the current map view is continuously added to the conversation as background visual context.

## Features

- ⚡️ WebRTC connection to OpenAI's realtime model for live, bi-directional audio.
- 🗺️ Embedded Google Map that tracks pans, zooms, and drags.
- 🖼️ Automatic map snapshots that are uploaded to the conversation as `input_image` messages.
- 💬 Lightweight chat interface with text input, push-to-talk microphone toggle, and optional browser speech recognition.
- 🔁 Manual `response.create` trigger so the assistant only speaks when you ask.

## Prerequisites

- Node.js 18+
- Google Maps JavaScript API key
- OpenAI API key with access to realtime models

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-...
# Optional overrides
# OPENAI_REALTIME_MODEL=gpt-realtime-preview
# OPENAI_VOICE=verse
# PORT=3000
```

Copy `public/config.example.js` to `public/config.js` and add your Google Maps API key:

```bash
cp public/config.example.js public/config.js
```

Edit `public/config.js`:

```js
window.GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";
```

## Install & Run

```bash
npm install
npm run dev
```

The server serves the static frontend and exposes `/session`, a proxy endpoint that obtains an ephemeral realtime session token from OpenAI. Visit [http://localhost:3000](http://localhost:3000) after starting the server.

## Tests

Run the lightweight API route tests with the Node.js test runner:

```bash
npm test
```

## Usage

1. Allow the site to access your location so the map can center on you (optional).
2. Click **🎙️ Start Mic** to stream audio to the assistant (speech recognition will transcribe optional text snippets).
3. Pan or zoom the map; the app captures a snapshot and injects it into the conversation background context.
4. Type or speak a message, then press **Ask Assistant** (or submit the form) to send `response.create`, prompting the AI to answer using the latest context.

Check the browser console for detailed logs when map snapshots are captured and streamed.

## Notes

- The project uses [`html2canvas`](https://html2canvas.hertzen.com/) to rasterize the map's DOM content into a base64 PNG.
- Speech recognition relies on the experimental Web Speech API and may not be available in all browsers. The realtime audio stream still works without it.
- The assistant preview appears live as partial text deltas arrive; final responses are committed when the API emits `response.completed`.

## License

MIT
