import express from "express";
import open from "open";
import { google } from "googleapis";
import dotenv from "dotenv";
import OpenAI from "openai";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

dotenv.config();

// --- OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PORT = 4153;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

// --- Google OAuth client ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

let tokens: any = null;

const app = express();
app.use(express.json());
app.use(express.static("src")); // serve chatbot.html + js

// --- OAuth flow ---
app.get("/auth", async (_req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });
  await open(url);
  res.send("OAuth flow started. Please check your browser.");
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code as string;
  const { tokens: newTokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(newTokens);
  tokens = newTokens;
  res.send("✅ Authentication successful. You can close this tab.");
});

// --- API endpoints ---

// List events
app.post("/api/listEvents", async (req, res) => {
  try {
    const events = await listEvents(req.body.maxResults || 5);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// Create event
app.post("/api/createEvent", async (req, res) => {
  try {
    const { summary, start, end } = req.body;
    const event = await createEvent(summary, start, end);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: "Failed to create event" });
  }
});

// Update event
app.post("/api/updateEvent", async (req, res) => {
  try {
    const { eventId, summary, start, end } = req.body;
    const event = await updateEvent(eventId, summary, start, end);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: "Failed to update event" });
  }
});

// Delete event
app.post("/api/deleteEvent", async (req, res) => {
  try {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: "Missing eventId" });
    const result = await deleteEvent(eventId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// --- Chat endpoint with OpenAI ---
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  try {
    const intentResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a calendar assistant. Classify the user's intent into one of: list_events, create_event, update_event, delete_event, or chat.",
        },
        { role: "user", content: message },
      ],
    });

    const intent = intentResp.choices[0]?.message?.content?.trim();

    if (intent === "list_events") {
      const events = await listEvents();
      return res.json({ reply: events });
    }

    if (intent === "create_event") {
      const event = await createEvent(
        "New Event",
        "2025-09-25T10:00:00",
        "2025-09-25T11:00:00"
      );
      return res.json({ reply: `✅ Event created: ${event.link}` });
    }

    if (intent === "update_event") {
      return res.json({
        reply: "Use the [Update] button on an event to modify it.",
      });
    }

    if (intent === "delete_event") {
      return res.json({
        reply: "Use the [Delete] button on an event to remove it.",
      });
    }

    // Fallback: just chat
    const chatResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful calendar chatbot." },
        { role: "user", content: message },
      ],
    });

    const reply = chatResp.choices[0]?.message?.content;
    res.json({ reply: reply || "🤔 No response" });
  } catch (err) {
    res.status(500).json({ error: "Chat failed" });
  }
});

app.listen(PORT, () => {
  console.log(`OAuth + API server running at http://localhost:${PORT}`);
});

// --- Helper functions ---
async function listEvents(maxResults = 5) {
  if (!tokens) throw new Error("Not authenticated. Visit /auth");
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary,
    start: ev.start?.dateTime || ev.start?.date,
  }));
}

async function createEvent(summary: string, start: string, end: string) {
  if (!tokens) throw new Error("Not authenticated. Visit /auth");
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
    },
  });

  return {
    success: true,
    summary: response.data.summary,
    link: response.data.htmlLink,
  };
}

async function updateEvent(
  eventId: string,
  summary?: string,
  start?: string,
  end?: string
) {
  if (!tokens) throw new Error("Not authenticated. Visit /auth");
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const response = await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: {
      summary,
      start: start ? { dateTime: new Date(start).toISOString() } : undefined,
      end: end ? { dateTime: new Date(end).toISOString() } : undefined,
    },
  });

  return {
    success: true,
    summary: response.data.summary,
    link: response.data.htmlLink,
  };
}

async function deleteEvent(eventId: string) {
  if (!tokens) throw new Error("Not authenticated. Visit /auth");
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  await calendar.events.delete({
    calendarId: "primary",
    eventId,
  });

  return {
    success: true,
    message: "Event deleted successfully",
  };
}

// --- MCP server still runs for Claude ---
const mcp = new McpServer({
  name: "Google Calendar MCP",
  version: "1.0.0",
});
async function startMcpServer() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.log("MCP server connected via stdio transport");
}
startMcpServer().catch(console.error
