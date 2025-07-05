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

// WebSocket
io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);
});

// ✅ Reclamar tarea (con restricción de una por usuario)
app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;

  try {
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

// ✅ Nueva ruta: obtener tareas desde PostgreSQL
app.post("/api/tasks", async (req, res) => {
  const { username } = req.body;

  try {
    // Obtener info del usuario
    const userResult = await pool.query(`SELECT role, project FROM users WHERE username = $1`, [username]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const user = userResult.rows[0];

    let query = `SELECT * FROM tasks WHERE status != 'finished'`;
    let values = [];

    if (user.role !== 'admin') {
      query += ` AND project = $1 AND level = $2`;
      values = [user.project, user.role];
    }

    const tasks = await pool.query(query, values);
    res.json(tasks.rows);

  } catch (err) {
    console.error("❌ Error al filtrar tareas:", err);
    res.status(500).json({ status: "error", message: "Error loading tasks" });
  }
});



// Finalizar tarea
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

// Registrar tareas
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

// Registrar usuarios
app.post("/api/register-users", async (req, res) => {
  const users = req.body.users;

  try {
    for (const user of users) {
      const { username, password, role, project } = user;

      await pool.query(
        `INSERT INTO users (username, password, role, project) VALUES ($1, $2, $3, $4)`,
        [username, password, role, project]
      );
    }

    res.json({ status: "success", message: "Users registered" });

  } catch (err) {
    console.error("❌ Error registering users:", err);
    res.status(500).json({ status: "error", message: "Could not register users" });
  }
});



// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
