const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "yamanote.proxy.rlwy.net",
  database: "railway",
  password: "RjaUAROUupKqOTLwJNwXqjfatfplGjri",
  port: 57774,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = 3000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);
});

// 🔐 LOGIN
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND password = $2`,
      [username.toLowerCase(), password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ status: "error", message: "Invalid credentials" });
    }

    const user = result.rows[0];
    res.json({ status: "success", user });
  } catch (err) {
    console.error("❌ Error en login:", err);
    res.status(500).json({ status: "error", message: "Internal login error" });
  }
});

// 📋 GET TASKS
app.get("/api/tasks", async (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ status: "error", message: "Username is required" });
  }

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
      [username.toLowerCase()]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const user = userResult.rows[0];

    let tasksResult;
    if (user.role === "admin") {
      tasksResult = await pool.query("SELECT * FROM tasks WHERE status != 'finished'");
    } else {
      tasksResult = await pool.query(
        "SELECT * FROM tasks WHERE status != 'finished' AND project = $1 AND level = $2",
        [user.project, user.role]
      );
    }

    res.json(tasksResult.rows);
  } catch (err) {
    console.error("❌ Error fetching tasks:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
