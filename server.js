// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

console.log("🔧 Conectando a PostgreSQL con:");
console.log("HOST:", process.env.PGHOST);
console.log("PORT:", process.env.PGPORT);
console.log("USER:", process.env.PGUSER);
console.log("DATABASE:", process.env.PGDATABASE);
console.log("PASSWORD:", process.env.PGPASSWORD);

const pool = new Pool({
  user: 'postgres',
  host: 'metro.proxy.rlwy.net',       // <- el host público real
  database: 'railway',
  password: 'UhzxAqGbEuJSRihbzMIREGvLHtFWOwQr',
  port: 23376,
  ssl: { rejectUnauthorized: false }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = 3000;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

const connectedUsers = {}; // Lista de usuarios activos por socket.id

io.on("connection", (socket) => {
  console.log("🟢 Cliente conectado:", socket.id);

  socket.on("userConnected", (username) => {
    connectedUsers[socket.id] = username;
    console.log(`👤 ${username} se ha conectado.`);
    io.emit("activeUsers", Object.values(connectedUsers));
  });

  socket.on("disconnect", () => {
    const username = connectedUsers[socket.id];
    console.log(`🔴 Cliente desconectado: ${socket.id} (${username || "desconocido"})`);
    delete connectedUsers[socket.id];
    io.emit("activeUsers", Object.values(connectedUsers));
  });
});



app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username.toLowerCase()]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ status: "error", message: "Invalid credentials" });
    }

    // 👉 Aquí conviertes role y project en arrays (aunque vengan como string de PostgreSQL)
    const userRoles = typeof user.role === "string" ? user.role.split(",") : user.role;
    const userProjects = typeof user.project === "string" ? user.project.split(",") : user.project;

    res.json({
      status: "success",
      user: {
        username: user.username,
        role: userRoles,
        project: userProjects,
        email: user.email || ""
      }
    });
  } catch (err) {
    console.error("❌ Error en /api/login:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});






app.get("/api/projects", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM projects");
    res.json(result.rows.map(r => r.name));
  } catch (err) {
    console.error("❌ Error /api/projects:", err);
    res.status(500).json({ status: "error", message: "Error loading projects" });
  }
});

app.post("/api/projects", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ status: "error", message: "Project name is required" });
  }
  try {
    const existing = await pool.query("SELECT 1 FROM projects WHERE name = $1", [name]);
    if (existing.rowCount > 0) {
      return res.json({ status: "success", inserted: 0, skipped: 1 });
    }

    await pool.query("INSERT INTO projects (name) VALUES ($1)", [name]);
    res.json({ status: "success", inserted: 1, skipped: 0 });
  } catch (err) {
    console.error("❌ Error adding project:", err);
    res.status(500).json({ status: "error", message: "Could not add project" });
  }
});


app.get("/api/tasks", async (req, res) => {
  const username = (req.query.username || "").trim().toLowerCase();

  if (!username) {
    return res.status(400).json({ status: "error", message: "Missing username" });
  }

  try {
    const userResult = await pool.query("SELECT role, project FROM users WHERE username = $1", [username]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const user = userResult.rows[0];
    const roles = Array.isArray(user.role) ? user.role : user.role?.split(",") || [];
    const projects = Array.isArray(user.project) ? user.project : user.project?.split(",") || [];

    // ✅ Si es admin, ver todas las tareas
    if (roles.includes("admin")) {
      const all = await pool.query("SELECT * FROM tasks");
      return res.json(all.rows);
    }

    // ✅ Si no es admin, filtrar por roles y proyectos
    const query = `
      SELECT * FROM tasks
      WHERE level = ANY($1::text[]) AND project = ANY($2::text[])
    `;
    const filtered = await pool.query(query, [roles, projects]);
    res.json(filtered.rows);

  } catch (err) {
    console.error("❌ Error en /api/tasks:", err);
    res.status(500).json({ status: "error", message: "Failed to load tasks" });
  }
});


app.get("/api/tasks", async (req, res) => {
  try {
    // 1. Obtén los datos del usuario (vía query, token o sesión)
    //    Aquí supongo que los recibes como parámetros de consulta:
    const { role, project } = req.query;   // role = "admin,10"  |  project = "Project Alpha,Project Beta"

    // 2. Convierte a arrays para manejarlos cómodamente
    const userRoles = Array.isArray(role) ? role : role.split(",");
    const userProjects = Array.isArray(project) ? project : project.split(",");

    // 3. Construye la consulta según privilegios
    let query  = "SELECT * FROM tasks";
    const cond = [];
    const vals = [];

    if (!userRoles.includes("admin")) {
      cond.push(`level    = ANY($1::text[])`);
      vals.push(userRoles);

      cond.push(`project  = ANY($2::text[])`);
      vals.push(userProjects);
    }

    if (cond.length) query += " WHERE " + cond.join(" AND ");

    // 4. Ejecuta la consulta
    const result = await pool.query(query, vals);
    res.json(result.rows);

  } catch (err) {
    console.error("❌ Error en /api/tasks:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
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
      `UPDATE tasks SET claimed_by = $1, claimed_at = NOW(), status = 'claimed' WHERE subtask = $2 AND status = 'pending' RETURNING *`,
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
    subtask,
    review_option,
    email,
    claimed_at,
    finished_at,
    level,
    username,
    data_type
  } = req.body;

  try {
    const taskResult = await pool.query("SELECT * FROM tasks WHERE subtask = $1", [subtask]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Task not found" });
    }

    const task = taskResult.rows[0];

    const project = task.project || "unknown";

    await pool.query(
      `INSERT INTO task_history 
        (subtask, level, review_option, email, claimed_at, finished_at, project, data_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [subtask, level, review_option, email, claimed_at, finished_at, project, data_type || null]
    );

    await pool.query("UPDATE tasks SET status = 'finished' WHERE subtask = $1", [subtask]);

    io.emit("taskFinished", { subtask });

    res.json({ status: "success" });
  } catch (err) {
    console.error("❌ Error en /api/mark-finished:", err);
    res.status(500).json({ status: "error", message: "Internal error" });
  }
});




app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM task_history ORDER BY finished_at DESC");
    res.json({ status: "success", tasks: result.rows });
  } catch (err) {
    console.error("Error loading history:", err);
    res.status(500).json({ status: "error", message: "Failed to load history" });
  }
});


app.post("/api/clear-history", async (req, res) => {
  try {
    await pool.query("DELETE FROM task_history");
    res.json({ status: "success", message: "Historial eliminado" });
  } catch (err) {
    console.error("❌ Error clear-history:", err);
    res.status(500).json({ status: "error", message: "No se pudo borrar el historial" });
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
    await pool.query("UPDATE tasks SET status = 'pending', claimed_by = '', claimed_at = NULL WHERE subtask = $1", [subtask]);
    res.json({ status: "success", message: "Task restored" });
  } catch (err) {
    console.error("❌ Error restoring task:", err);
    res.status(500).json({ status: "error", message: "Failed to restore task" });
  }
});

app.post("/api/update-user", async (req, res) => {
  const { username, password, email, role, project } = req.body;

  if (!username) {
    return res.status(400).json({ status: "error", message: "Missing username" });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET password = $1, email = $2, role = $3, project = $4 WHERE LOWER(username) = $5`,
      [
        password,
        email,
        Array.isArray(role) ? role : role.split(','),
        Array.isArray(project) ? project : project.split(','),
        username.toLowerCase()
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    res.json({ status: "success", message: "User updated" });
  } catch (err) {
    console.error("❌ Error updating user:", err);
    res.status(500).json({ status: "error", message: "Error updating user" });
  }
});







app.post("/api/delete-user", async (req, res) => {
  const { username } = req.body;
  try {
    const result = await pool.query("DELETE FROM users WHERE LOWER(username) = $1", [username.toLowerCase()]);
    res.json(result.rowCount > 0 ? { status: "success" } : { status: "error", message: "User not found" });
  } catch (err) {
    console.error("❌ Error deleting user:", err);
    res.status(500).json({ status: "error", message: "Error deleting user" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query("SELECT username, role, project, email, password FROM users ORDER BY username ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.status(500).json({ status: "error", message: "Error loading users" });
  }
});


server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

const bcrypt = require("bcrypt");          //  NUEVO

app.post("/api/register-users", async (req, res) => {
  const users = req.body.users || [];

  try {
    // 1. Usuarios ya existentes (evita duplicados)
    const { rows: existing } = await pool.query("SELECT username FROM users");
    const existingUsers = new Set(existing.map(u => u.username.toLowerCase()));

    // 2. Filtra solo los nuevos
    const uniqueUsers = users.filter(
      u => !existingUsers.has(u.username.toLowerCase())
    );

    const inserted = [];

    // 3. Inserta cada usuario con contraseña encriptada
    for (const user of uniqueUsers) {
      const hashedPassword = await bcrypt.hash(user.password, 10);   //  NUEVO

      await pool.query(
        `INSERT INTO users (username, password, email, role, project)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.username.toLowerCase(),
          hashedPassword,                                            //  NUEVO
          user.email || "",
          Array.isArray(user.role) ? user.role : user.role.split(","),
          Array.isArray(user.project) ? user.project : user.project.split(",")
        ]
      );
      inserted.push(user.username.toLowerCase());
    }

    res.json({
      status: "success",
      inserted: inserted.length,
      skipped: users.length - inserted.length
    });
  } catch (err) {
    console.error("❌ Error registering users:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

