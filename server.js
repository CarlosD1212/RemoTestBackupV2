const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

// 📦 Configuración PostgreSQL Railway
const pool = new Pool({
  user: "postgres",
  host: "yamanote.proxy.rlwy.net",
  database: "railway",
  password: "RjaUAROUupKqOTLwJNwXqjfatfplGjri",
  port: 57774,
  ssl: {
    rejectUnauthorized: false
  }
});

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// WebSocket
io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);
});

// ✅ Endpoint mejorado: reclamar tarea (solo una por usuario)
app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;

  try {
    // Verificar si ya tiene otra tarea reclamada
    const check = await pool.query(
      `SELECT * FROM tasks WHERE claimed_by = $1 AND status = 'claimed'`,
      [username]
    );

    if (check.rows.length > 0) {
      return res.json({
        status: "error",
        message: "Ya tienes una tarea reclamada"
      });
    }

    // Reclamar la tarea si está pendiente
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

// Marcar tarea como finalizada
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

// Guardar tareas nuevas
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

// Guardar usuarios nuevos
app.post("/api/register-users", async (req, res) => {
  const users = req.body.users;

  try {
    for (const user of users) {
      const { username, password, role } = user;
      await pool.query(
        `INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`,
        [username, password, role]
      );
    }

    res.json({ status: "success", message: "Usuarios registrados" });

  } catch (err) {
    console.error("❌ Error al registrar usuarios:", err);
    res.status(500).json({ status: "error", message: "No se pudieron registrar los usuarios" });
  }
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
