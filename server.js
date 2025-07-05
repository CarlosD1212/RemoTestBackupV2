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

// ✅ CORS correctamente configurado una sola vez
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;


app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ruta por defecto al acceder a "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// WebSocket
io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);
});

// Reclamar tarea
app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tasks SET claimed_by = $1, status = 'claimed' WHERE subtask = $2 RETURNING *`,
      [username, subtask]
    );
    if (result.rowCount > 0) {
      io.emit("taskClaimed", { subtask, username });
      return res.json({ status: "success", message: "Tarea reclamada" });
    } else {
      return res.json({ status: "error", message: "Tarea no encontrada" });
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

// Registrar tareas nuevas
app.post("/api/tasks", async (req, res) => {
  const tasks = req.body.tasks;

  console.log("📩 Tareas recibidas:", tasks);


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
    console.error("❌ Error en /api/tasks:", err);
    res.status(500).json({ status: "error", message: "Error guardando tareas" });
  }
});

// Registrar usuarios nuevos
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
    console.error("❌ Error en /api/register-users:", err);
    res.status(500).json({ status: "error", message: "Error registrando usuarios" });
  }
});

// Inicia el servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
