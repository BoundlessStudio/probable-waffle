import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { createApp } from "../server.js";

let originalApiKey;
let originalModel;
let originalVoice;

beforeEach(() => {
  originalApiKey = process.env.OPENAI_API_KEY;
  originalModel = process.env.OPENAI_REALTIME_MODEL;
  originalVoice = process.env.OPENAI_VOICE;

  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_REALTIME_MODEL;
  delete process.env.OPENAI_VOICE;
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }

  if (originalModel === undefined) {
    delete process.env.OPENAI_REALTIME_MODEL;
  } else {
    process.env.OPENAI_REALTIME_MODEL = originalModel;
  }

  if (originalVoice === undefined) {
    delete process.env.OPENAI_VOICE;
  } else {
    process.env.OPENAI_VOICE = originalVoice;
  }
});

test("returns error when OpenAI API key is missing", async () => {
  const app = createApp();
  const response = await request(app).get("/session");

  assert.strictEqual(response.statusCode, 500);
  assert.match(response.body.error, /Missing OPENAI_API_KEY/);
});

test("creates a realtime session when API key is provided", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const fetchCalls = [];
  const fakeFetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ id: "session-id" }),
    };
  };

  const app = createApp({ fetchImpl: fakeFetch, model: "custom-model" });
  const response = await request(app).get("/session");

  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(response.body, { id: "session-id" });
  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(fetchCalls[0].url, "https://api.openai.com/v1/realtime/sessions");

  const requestBody = JSON.parse(fetchCalls[0].options.body);
  assert.strictEqual(requestBody.model, "custom-model");
  assert.deepStrictEqual(requestBody.modalities, ["text", "audio"]);
});
