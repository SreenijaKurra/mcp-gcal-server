const chatWindow = document.getElementById("chat-window");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");

let messages = [];

// Helper to append a message
function appendMessage(text, sender, withButtons = false, eventId = null) {
  const msgDiv = document.createElement("div");
  msgDiv.className = "message " + sender;
  msgDiv.textContent = text;

  if (withButtons && eventId) {
    const btnContainer = document.createElement("div");
    btnContainer.className = "bot-buttons";

    // Update button
    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Update";
    updateBtn.onclick = () => {
      const newSummary = prompt("Enter new event title:");
      if (newSummary) {
        fetch("/api/updateEvent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, summary: newSummary }),
        })
          .then((res) => res.json())
          .then((data) => {
            appendMessage("✅ Event updated: " + data.summary, "bot");
          })
          .catch(() => {
            appendMessage("❌ Failed to update event.", "bot");
          });
      }
    };

    // Create button
    const createBtn = document.createElement("button");
    createBtn.textContent = "Create Event";
    createBtn.onclick = () => {
      const summary = prompt("Event title?");
      const start = prompt("Start date-time (YYYY-MM-DDTHH:mm:ss)");
      const end = prompt("End date-time (YYYY-MM-DDTHH:mm:ss)");
      if (summary && start && end) {
        fetch("/api/createEvent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary, start, end }),
        })
          .then((res) => res.json())
          .then((data) => {
            appendMessage("✅ Created: " + data.summary, "bot");
          })
          .catch(() => {
            appendMessage("❌ Failed to create event.", "bot");
          });
      }
    };

    btnContainer.appendChild(updateBtn);
    btnContainer.appendChild(createBtn);
    msgDiv.appendChild(btnContainer);
  }

  chatWindow.appendChild(msgDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Handle sending messages
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage(text, "user");
  userInput.value = "";
  userInput.focus();

  // Bot loading placeholder
  const loadingDiv = appendMessage("...", "bot");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();

    // Remove loading placeholder
    chatWindow.removeChild(chatWindow.lastChild);

    // If response is events array, render with buttons
    if (Array.isArray(data.reply)) {
      data.reply.forEach((ev) => {
        appendMessage(
          `${ev.summary || "(no title)"} — ${ev.start}`,
          "bot",
          true,
          ev.id
        );
      });
    } else {
      appendMessage(data.reply || "🤔 No response", "bot");
    }
  } catch (err) {
    console.error(err);
    appendMessage("❌ Error contacting server.", "bot");
  }
});

// Pressing Enter should send
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});
