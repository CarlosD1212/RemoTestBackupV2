const express = require("express");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw6wUQo9N5Kg69Tw3NtwWIVPaWfiaYIUfPPoN-_6CDPum1a-VaivvHnbbVEop2hyCLU4g/exec";

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);
});

// CLAIM endpoint
app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;

  const url = `${GOOGLE_SCRIPT_URL}?action=claim&subtask=${subtask}&username=${username}`;
  try {
    const response = await fetch(url, { method: "POST" });
    const json = await response.json();

    if (json.status === "success") {
      io.emit("taskClaimed", { subtask, username }); // 🔔 Notifica a todos
    }

    res.json(json);
  } catch (err) {
    console.error("❌ Error en /api/claim:", err);
    res.status(500).json({ status: "error", message: "Internal error in claim" });
  }
});

// FINISH endpoint
app.post("/api/mark-finished", async (req, res) => {
  const { subtask } = req.body;

  const url = `${GOOGLE_SCRIPT_URL}?action=mark_finished&subtask=${subtask}`;
  try {
    const response = await fetch(url, { method: "POST" });
    const json = await response.json();

    if (json.status === "success") {
      io.emit("taskFinished", { subtask });
    }

    res.json(json);
  } catch (err) {
    console.error("❌ Error en /api/mark-finished:", err);
    res.status(500).json({ status: "error", message: "Internal error in finish" });
  }
});

// LOAD tasks from admin panel
app.post("/api/tasks", async (req, res) => {
  const tasks = req.body.tasks;
  try {
    for (const task of tasks) {
      const { subtask, batch, level } = task;
      const url = `${GOOGLE_SCRIPT_URL}?action=add&subtask=${subtask}&batch=${batch}&level=${level}`;
      await fetch(url, { method: "POST" });
    }
    res.json({ status: "success", message: "Tasks sent to Google Sheets" });
  } catch (err) {
    console.error("❌ Error en /api/tasks:", err);
    res.status(500).json({ status: "error", message: "Error submitting tasks" });
  }
});

// REGISTER users
app.post("/api/register-users", async (req, res) => {
  const users = req.body.users;
  try {
    for (const user of users) {
      const { username, password, role } = user;
      const url = `${GOOGLE_SCRIPT_URL}?action=add_user&username=${username}&password=${password}&role=${role}`;
      await fetch(url, { method: "POST" });
    }
    res.json({ status: "success", message: "Users registered successfully" });
  } catch (err) {
    console.error("❌ Error en /api/register-users:", err);
    res.status(500).json({ status: "error", message: "Error registering users" });
  }
});

// Inicia el servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
