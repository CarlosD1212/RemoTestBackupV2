const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const pool = new Pool({
  user: "postgres",
  host: "yamanote.proxy.rlwy.net",
  database: "railway",
  password: "RjaUAROUupKqOTLwJNwXqjfatfplGjri",
  port: 57774,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);
});

// ✅ LOGIN
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

// ✅ OBTENER TAREAS
app.get("/api/tasks", async (req, res) => {
  const username = req.query.username;

  if (!username) {
    return res.status(400).json({ status: "error", message: "Username is required" });
  }

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1)", [username.toLowerCase()]);
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

// ✅ CLAIM TAREA
app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1)", [username.toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const taskResult = await pool.query("SELECT * FROM tasks WHERE subtask = $1", [subtask]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Task not found" });
    }

    const task = taskResult.rows[0];

    if (task.status === "finished") {
      return res.status(400).json({ status: "error", message: "Task already finished" });
    }

    if (task.claimed_by && task.claimed_by !== username) {
      return res.status(400).json({ status: "error", message: "Task already claimed" });
    }

    await pool.query(
      "UPDATE tasks SET claimed_by = $1 WHERE subtask = $2",
      [username, subtask]
    );

    io.emit("taskClaimed", { subtask, username });

    res.json({ status: "success", message: "Task claimed" });
  } catch (err) {
    console.error("❌ Error claiming task:", err);
    res.status(500).json({ status: "error", message: "Error claiming task" });
  }
});

// ✅ FINALIZAR TAREA
app.post("/api/mark-finished", async (req, res) => {
  const { subtask } = req.body;

  try {
    await pool.query(
      "UPDATE tasks SET status = 'finished' WHERE subtask = $1",
      [subtask]
    );

    io.emit("taskFinished", { subtask });
    res.json({ status: "success", message: "Task marked as finished" });
  } catch (err) {
    console.error("❌ Error marking task finished:", err);
    res.status(500).json({ status: "error", message: "Error marking task finished" });
  }
});

// ✅ CARGA MASIVA DE TAREAS
app.post("/api/tasks", async (req, res) => {
  const tasks = req.body.tasks;

  try {
    const values = tasks.map(t =>
      `('${t.subtask}', '${t.batch}', '${t.level}', 'pending', '', '${t.project}')`
    ).join(",");

    const query = `INSERT INTO tasks (subtask, batch, level, status, claimed_by, project) VALUES ${values}`;
    await pool.query(query);
    res.json({ status: "success", message: "Tasks inserted" });
  } catch (err) {
    console.error("❌ Error inserting tasks:", err);
    res.status(500).json({ status: "error", message: "Error inserting tasks" });
  }
});

// ✅ REGISTRO DE USUARIOS
app.post("/api/register-users", async (req, res) => {
  const users = req.body.users;

  try {
    const values = users.map(u =>
      `('${u.username.toLowerCase()}', '${u.password}', '${u.role}', '${u.project}')`
    ).join(",");

    const query = `INSERT INTO users (username, password, role, project) VALUES ${values}`;
    await pool.query(query);
    res.json({ status: "success", message: "Users inserted" });
  } catch (err) {
    console.error("❌ Error registering users:", err);
    res.status(500).json({ status: "error", message: "Error registering users" });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
