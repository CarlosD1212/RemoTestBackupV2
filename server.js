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

app.post("/api/projects", async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ status: "error", message: "Project name is required" });
  }

  try {
    await pool.query("INSERT INTO projects (name) VALUES ($1)", [name]);
    res.json({ status: "success", message: "Project added" });
  } catch (err) {
    console.error("❌ Error adding project:", err);
    res.status(500).json({ status: "error", message: "Could not add project" });
  }
});


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

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT username, role, project FROM users WHERE LOWER(username) = $1 AND password = $2",
      [username.toLowerCase(), password]
    );

    if (result.rows.length === 0) {
      return res.json({ status: "error", message: "Invalid credentials" });
    }

    res.json({ status: "success", user: result.rows[0] });
  } catch (err) {
    console.error("❌ Error login:", err);
    res.status(500).json({ status: "error", message: "Internal login error" });
  }
});

app.get("/api/projects", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM projects");
    const names = result.rows.map(r => r.name);
    res.json(names);
  } catch (err) {
    console.error("❌ Error /api/projects:", err);
    res.status(500).json({ status: "error", message: "Error loading projects" });
  }
});

app.get("/api/tasks", async (req, res) => {
  const username = req.query.username;

  try {
    const userRes = await pool.query("SELECT role, project FROM users WHERE LOWER(username) = $1", [username.toLowerCase()]);
    if (userRes.rows.length === 0) return res.status(403).json({ status: "error", message: "User not found" });

    const { role, project } = userRes.rows[0];
    let query = "SELECT * FROM tasks WHERE status != 'finished'";
    let params = [];

    if (role !== "admin") {
      query += " AND level = $1 AND project = $2";
      params = [role, project];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error /api/tasks:", err);
    res.status(500).json({ status: "error", message: "Failed to load tasks" });
  }
});

app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;

  try {
    const check = await pool.query(
      `SELECT * FROM tasks WHERE claimed_by = $1 AND status = 'claimed'`,
      [username]
    );

    if (check.rows.length > 0) {
      return res.json({ status: "error", message: "Ya tienes una tarea reclamada" });
    }

    const result = await pool.query(
      `UPDATE tasks SET claimed_by = $1, status = 'claimed' WHERE subtask = $2 AND status = 'pending' RETURNING *`,
      [username, subtask]
    );

    if (result.rowCount > 0) {
      io.emit("taskClaimed", { subtask, username });
      return res.json({ status: "success", message: "Tarea reclamada" });
    } else {
      return res.json({ status: "error", message: "Tarea no encontrada o ya reclamada" });
    }

  } catch (err) {
    console.error("❌ Error en /api/claim:", err);
    res.status(500).json({ status: "error", message: "Internal error in claim" });
  }
});

app.post("/api/mark-finished", async (req, res) => {
  const { subtask } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tasks SET status = 'finished' WHERE subtask = $1 RETURNING *`,
      [subtask]
    );

    if (result.rowCount > 0) {
      io.emit("taskFinished", { subtask });
      return res.json({ status: "success", message: "Tarea finalizada" });
    } else {
      return res.json({ status: "error", message: "Tarea no encontrada" });
    }

  } catch (err) {
    console.error("❌ Error en /api/mark-finished:", err);
    res.status(500).json({ status: "error", message: "Internal error in finish" });
  }
});

app.post("/api/tasks", async (req, res) => {
  const tasks = req.body.tasks;

  try {
    for (const task of tasks) {
      const { subtask, batch, level, project } = task;
      await pool.query(
        `INSERT INTO tasks (subtask, batch, level, status, project) VALUES ($1, $2, $3, $4, $5)`,
        [subtask, batch, level, 'pending', project]
      );
    }

    res.json({ status: "success", message: "Tareas guardadas en PostgreSQL" });

  } catch (err) {
    console.error("❌ Error al guardar tareas:", err);
    res.status(500).json({ status: "error", message: "No se pudieron guardar las tareas" });
  }
});

app.post("/api/register-users", async (req, res) => {
  const users = req.body.users;

  try {
    for (const user of users) {
      const { username, password, role, project } = user;

      await pool.query(
        `INSERT INTO users (username, password, role, project) VALUES ($1, $2, $3, $4)`,
        [username.toLowerCase(), password, role, project]
      );
    }

    res.json({ status: "success", message: "Users registered" });

  } catch (err) {
    console.error("❌ Error registering users:", err);
    res.status(500).json({ status: "error", message: "Could not register users" });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
