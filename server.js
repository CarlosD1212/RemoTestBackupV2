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
  try {
    const result = await pool.query("SELECT * FROM tasks");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error en /api/tasks:", err);
    res.status(500).json({ status: "error", message: "Failed to load tasks" });
  }
});


app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM task_history ORDER BY finished_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error en /api/history:", err);
    res.status(500).json({ status: "error", message: "Failed to load history" });
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
  const {
    subtask, level, review_option, email, claimed_at, finished_at, data_type
  } = req.body;

  try {
    // 1. Actualizar tarea como finalizada
    await pool.query(
      `UPDATE tasks SET status = 'finished' WHERE subtask = $1`,
      [subtask]
    );

    // 2. Guardar en historial
    await pool.query(
      `INSERT INTO task_history (subtask, level, review_option, email, claimed_at, finished_at, data_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [subtask, level, review_option, email, claimed_at, finished_at, data_type]
    );

    io.emit("taskFinished", { subtask });
    return res.json({ status: "success", message: "Tarea finalizada y registrada" });
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

app.post("/api/delete-task", async (req, res) => {
  const { subtask } = req.body;

  try {
    await pool.query("DELETE FROM tasks WHERE subtask = $1", [subtask]);
    res.json({ status: "success", message: "Task deleted" });
  } catch (err) {
    console.error("❌ Error deleting task:", err);
    res.status(500).json({ status: "error", message: "Failed to delete task" });
  }
});

app.post("/api/restore-task", async (req, res) => {
  const { subtask } = req.body;

  try {
    await pool.query(
      "UPDATE tasks SET status = 'pending', claimed_by = '' WHERE subtask = $1",
      [subtask]
    );
    res.json({ status: "success", message: "Task restored" });
  } catch (err) {
    console.error("❌ Error restoring task:", err);
    res.status(500).json({ status: "error", message: "Failed to restore task" });
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

// Eliminar usuario por username
app.post("/api/delete-user", async (req, res) => {
  const { username } = req.body;
  try {
    const result = await pool.query("DELETE FROM users WHERE LOWER(username) = $1", [username.toLowerCase()]);
    if (result.rowCount > 0) {
      res.json({ status: "success", message: "User deleted" });
    } else {
      res.json({ status: "error", message: "User not found" });
    }
  } catch (err) {
    console.error("❌ Error deleting user:", err);
    res.status(500).json({ status: "error", message: "Error deleting user" });
  }
});

// Obtener lista de usuarios
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT username, role, project FROM users ORDER BY username ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.status(500).json({ status: "error", message: "Error loading users" });
  }
});


server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
