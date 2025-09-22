import express from "express";
import open from "open";
import { google } from "googleapis";
import dotenv from "dotenv";
import { z } from "zod";

// MCP SDK
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

dotenv.config();

const PORT = 4153;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

// Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

let tokens: any = null; // store access/refresh tokens in memory

// --- Express app for OAuth ---
const app = express();

app.get("/auth", async (_req, res) => {
  try {
    console.log("🔐 Starting OAuth flow...");
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    console.log("Generated OAuth URL:", url);
    await open(url);
    res.send(`
      <h2>OAuth Flow Started</h2>
      <p>✅ Browser should have opened automatically</p>
      <p>If not, click here: <a href="${url}" target="_blank">Authorize with Google</a></p>
    `);
  } catch (error) {
    console.error("❌ Error starting OAuth flow:", error);
    res.status(500).send(`Error: ${error}`);
  }
});

app.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).send("No authorization code received");
    }

    console.log("Received authorization code, exchanging for tokens...");
    const { tokens: newTokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(newTokens);
    tokens = newTokens;
    console.log("✅ Tokens received successfully");
    res.send("Authentication successful! You can close this tab.");
  } catch (error) {
    console.error("❌ OAuth callback error:", error);
    res.status(500).send(`Authentication failed: ${error}`);
  }
});

// 👉 NEW: expose listEvents over HTTP for chatbot frontend
app.get("/api/listEvents", async (_req, res) => {
  if (!tokens) {
    return res
      .status(401)
      .json({ error: "Not authenticated. Visit http://localhost:4153/auth" });
  }

  try {
    oauth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const result = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
    });

    res.json({ events: result.data.items });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
// Serve static files (like chatbot.html) from the src folder
app.use(express.static("src"));

app.listen(PORT, () => {
  console.log(`OAuth + API server running at http://localhost:${PORT}`);
});

// --- MCP Server (still runs in parallel) ---
const mcp = new McpServer({
  name: "Google Calendar MCP",
  version: "1.0.0",
});

mcp.registerTool(
  "listEvents",
  {
    title: "List Calendar Events",
    description: "List upcoming Google Calendar events",
    inputSchema: {
      maxResults: z.number().optional().default(5),
    },
  },
  async (input: { maxResults?: number }) => {
    if (!tokens) {
      return {
        content: [
          {
            type: "text",
            text: "Not authenticated. Visit http://localhost:4153/auth",
          },
        ],
        isError: true,
      };
    }

    try {
      oauth2Client.setCredentials(tokens);
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      const res = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        maxResults: input.maxResults || 5,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = res.data.items || [];
      const eventText =
        events.length > 0
          ? events
              .map(
                (event) =>
                  `${event.summary} - ${
                    event.start?.dateTime || event.start?.date
                  }`
              )
              .join("\n")
          : "No upcoming events found.";

      return { content: [{ type: "text", text: eventText }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching events: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start MCP server with stdio transport
async function startMcpServer() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.log("MCP server connected via stdio transport");
}

startMcpServer().catch(console.error);
