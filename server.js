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

    // ✅ Usa cleanPgArray aquí
    const userRoles = cleanPgArray(user.role);
    const userProjects = cleanPgArray(user.project);

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

async function loadRolesMaster() {
  try {
    const res = await fetch(`${BASE_URL}/api/roles`);
    const list = await res.json(); // ["admin", "0", "1", ...]
    availableRoles = list;
  } catch (err) {
    console.error("Error loading master roles:", err);
  }
}

// ✅ Esta función debe estar disponible antes de ser usada (puedes moverla arriba si prefieres)
function cleanPgArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim().toLowerCase());
  return value
    .replace(/[\{\}"]/g, "")
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}


app.post("/api/update-project", async (req, res) => {
  const { originalName, newName, levels, pause } = req.body;

  try {
    await pool.query(
      "UPDATE projects SET name = $1, levels = $2, pause = $3 WHERE name = $4",
      [newName, levels, pause, originalName]
    );
    res.json({ status: "success", message: "Project updated" });
  } catch (err) {
    console.error("Error updating project:", err);
    res.status(500).json({ status: "error", message: "Error updating project" });
  }
});

app.post("/api/projects", async (req, res) => {
  const { name, levels, pause } = req.body;

  if (!name || !Array.isArray(levels) || levels.length === 0) {
    return res.status(400).json({ status: "error", message: "Missing project name or levels" });
  }

  try {
    await pool.query(
      "INSERT INTO projects (name, levels, pause) VALUES ($1, $2, $3)",
      [name, levels, pause || "disabled"]
    );

    res.json({ status: "success", message: "Project created" });
  } catch (err) {
    console.error("❌ Error saving project:", err);
    res.status(500).json({ status: "error", message: "Error saving project" });
  }
});


app.get("/api/tasks", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "Username required" });

  try {
    // Obtener usuario
    const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username.toLowerCase()]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    const userRoles = Array.isArray(user.role) ? user.role : user.role.split(",");
    const userProject = user.project;

    // Si es admin, ve todo
    if (userRoles.includes("admin")) {
      const allTasks = await pool.query("SELECT * FROM tasks WHERE status != 'finished'");

      // Obtener configuración de pausa para cada proyecto
      const projectsUsed = [...new Set(allTasks.rows.map(t => t.project))];
      const projCfg = await pool.query(
        "SELECT name, pause FROM projects WHERE name = ANY($1::text[])",
        [projectsUsed]
      );
      const projectPauseMap = Object.fromEntries(projCfg.rows.map(r => [r.name, r.pause]));

      // Añadir campo pause_enabled
      const tasksWithPause = allTasks.rows.map(t => ({
        ...t,
        pause_enabled: projectPauseMap[t.project] === 'enabled'
      }));

      return res.json(tasksWithPause);
    }

    // Obtener niveles permitidos del proyecto
    const projResult = await pool.query("SELECT levels FROM projects WHERE name = $1", [userProject]);
    const projectLevels = projResult.rows[0]?.levels || [];

    // Filtrar tareas por proyecto y nivel
const tasks = await pool.query(
  `SELECT * FROM tasks
   WHERE project = $1
     AND (
       status = 'pending'
       OR status = 'claimed'
       OR (status = 'paused' AND claimed_by = $2)
     )`,
  [userProject, username]
);

    const filteredTasks = tasks.rows.filter(task =>
      userRoles.includes(task.level) && projectLevels.includes(task.level)
    );

    // Obtener configuración de pausa para el proyecto
    const projCfg = await pool.query(
      "SELECT name, pause FROM projects WHERE name = ANY($1::text[])",
      [filteredTasks.map(t => t.project)]
    );
    const projectPauseMap = Object.fromEntries(
      projCfg.rows.map(r => [r.name, r.pause])
    );

    const tasksWithPause = filteredTasks.map(t => ({
      ...t,
      pause_enabled: projectPauseMap[t.project] === 'enabled'
    }));

    res.json(tasksWithPause);
  } catch (error) {
    console.error("❌ Error loading tasks:", error);
    res.status(500).json({ error: "Error loading tasks" });
  }
});



app.post("/api/tasks", async (req, res) => {
  const { tasks } = req.body;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ status: "error", message: "No tasks provided." });
  }

  try {
    /* 1️⃣  Obtener niveles permitidos por proyecto (solo una vez por cada proyecto) */
    const projectLevelsMap = {};
    const projects = [...new Set(tasks.map(t => t.project))];

    for (const name of projects) {
      const r = await pool.query("SELECT levels FROM projects WHERE name = $1", [name]);
      projectLevelsMap[name] = r.rows[0]?.levels || [];
    }

    /* 2️⃣  Clasificar tareas */
    const validTasks   = [];
    const invalidTasks = [];   // nivel no permitido

    for (const task of tasks) {
      const allowed = projectLevelsMap[task.project] || [];
      if (allowed.includes(task.level)) {
        validTasks.push(task);
      } else {
        invalidTasks.push(task);
      }
    }

    if (validTasks.length === 0) {
      return res.json({
        status: "success",
        inserted: 0,
        skipped: 0,
        invalid: invalidTasks.length,
        message: "No valid tasks to insert – all levels not permitted for the project(s)."
      });
    }

    /* 3️⃣  Evitar subtareas duplicadas */
    const subList = validTasks.map(t => t.subtask);
    const dupCheck = await pool.query(
      "SELECT subtask FROM tasks WHERE subtask = ANY($1::text[])",
      [subList]
    );
    const duplicates = new Set(dupCheck.rows.map(r => r.subtask));

    const tasksToInsert = validTasks.filter(t => !duplicates.has(t.subtask));

    /* 4️⃣  Insertar las tareas válidas y no duplicadas */
    for (const t of tasksToInsert) {
      await pool.query(
        `INSERT INTO tasks (subtask, batch, level, project, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [t.subtask, t.batch, t.level, t.project]
      );
    }

    /* 5️⃣  Respuesta resumen */
    res.json({
      status: "success",
      inserted: tasksToInsert.length,
      skipped: duplicates.size,
      invalid: invalidTasks.length
    });

  } catch (err) {
    console.error("❌ Error saving tasks:", err);
    res.status(500).json({ status: "error", message: "Server error while saving tasks." });
  }
});






app.post("/api/claim", async (req, res) => {
  const { subtask, username } = req.body;
  try {
    const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username.toLowerCase()]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    const userRoles = cleanPgArray(user.role);

    console.log("🧪 Roles interpretados:", userRoles, typeof userRoles);

    // ✅ Este check es opcional si quieres aplicar reglas por roles
    if (!userRoles.includes("admin")) {
      const alreadyClaimed = await pool.query(
        `SELECT * FROM tasks WHERE claimed_by = $1 AND status = 'claimed'`,
        [username]
      );
      if (alreadyClaimed.rows.length > 0) {
        return res.json({ status: "error", message: "Ya tienes una tarea reclamada" });
      }
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
    console.error("❌ Error en /api/claim:", err);  // ← Mira esta salida en consola para más detalle
    res.status(500).json({ status: "error", message: "Internal error in claim" });
  }
});

app.post("/api/pause", async (req, res) => {
  console.log("✅ /api/pause llamado");
  const { subtask, username } = req.body;

  if (!subtask || !username) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing subtask or username" });
  }

  try {
    // ✔ comprueba que la tarea está reclamada por ese usuario
    const taskCheck = await pool.query(
      `SELECT * FROM tasks
       WHERE subtask = $1 AND claimed_by = $2 AND status = 'claimed'`,
      [subtask, username]
    );
    if (taskCheck.rowCount === 0) {
      return res
        .status(403)
        .json({ status: "error", message: "Task not claimed by this user or already paused/finished" });
    }

    // ✔ verifica que el usuario no tenga otra tarea en pausa
    const pausedCheck = await pool.query(
      "SELECT 1 FROM tasks WHERE claimed_by = $1 AND status = 'paused'",
      [username]
    );
    if (pausedCheck.rowCount > 0) {
      return res
        .status(403)
        .json({ status: "error", message: "You already have a paused task" });
    }

    // ✔ actualiza la tarea a estado ‘paused’
    await pool.query(
      `UPDATE tasks
       SET status = 'paused'
       WHERE subtask = $1 AND claimed_by = $2`,
      [subtask, username]
    );

    io.emit("taskPaused", { subtask, username });   // evento opcional
    res.json({ status: "success", message: "Task paused successfully" });
  } catch (err) {
    console.error("❌ Error pausing task:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});




// ✅ Esta función debe estar disponible antes de ser usada (puedes moverla arriba si prefieres)
function cleanPgArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim().toLowerCase());
  return value
    .replace(/[\{\}"]/g, "")
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}

function getNextLevel(currentLevel, allowedLevels) {
  const sequence = ["-1", "0", "1", "10"];
  const idx = sequence.indexOf(String(currentLevel));
  if (idx === -1) return null;

  // busca el siguiente en la secuencia que esté permitido
  for (let i = idx + 1; i < sequence.length; i++) {
    if (allowedLevels.includes(sequence[i])) return sequence[i];
  }
  return null;
}

/* 🚀 Endpoint actualizado */
/* 🚀 Endpoint actualizado */
/* 🚀 Endpoint /api/mark-finished (versión final) */
app.post("/api/mark-finished", async (req, res) => {
  const {
    subtask,
    batch,              // ← AÑADE ESTA LÍNEA
    review_option,
    email,
    claimed_at,
    finished_at,
    level,
    data_type,
    username
  } = req.body;

  try {
    const taskResult = await pool.query("SELECT * FROM tasks WHERE subtask = $1", [subtask]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Task not found" });
    }

    const task = taskResult.rows[0];
    const project = task.project || "unknown";

    // 1. Guardar en historial
await pool.query(
  `INSERT INTO history 
    (subtask, batch, level, review_option, email, claimed_at, finished_at, project, data_type, username)
   VALUES 
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [subtask, batch, level, review_option, email, claimed_at, finished_at, project, data_type, username]
);
    // 2. Marcar la tarea original como finalizada
    await pool.query("UPDATE tasks SET status = 'finished' WHERE subtask = $1", [subtask]);

    // 3. Obtener niveles permitidos por el proyecto
    const projectResult = await pool.query(
      "SELECT levels FROM projects WHERE name = $1",
      [project]
    );

    if (projectResult.rows.length === 0) {
      console.warn(`⚠️ Proyecto "${project}" no encontrado en tabla 'projects'`);
      io.emit("taskFinished", { subtask });
      return res.json({ status: "success", message: "Task marked as finished (project not found)" });
    }

    const allowedLevels = projectResult.rows[0].levels || [];
    const levelsArray = Array.isArray(allowedLevels)
      ? allowedLevels.map(Number)
      : allowedLevels.replace(/[{}]/g, "").split(",").map(l => parseInt(l)).filter(n => !isNaN(n));

    const levelOrder = [-1, 0, 1, 10];
    const currentIndex = levelOrder.indexOf(Number(level));

    if (currentIndex !== -1) {
      let nextLevel = null;
      for (let i = currentIndex + 1; i < levelOrder.length; i++) {
        if (levelsArray.includes(levelOrder[i])) {
          nextLevel = levelOrder[i];
          break;
        }
      }

      if (nextLevel !== null) {
        await pool.query(
          `INSERT INTO tasks (subtask, batch, level, project, status)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [task.subtask, task.batch, nextLevel, task.project]
        );
      }
    }

    io.emit("taskFinished", { subtask });

    res.json({ status: "success" });
  } catch (err) {
    console.error("❌ Error en /api/mark-finished:", err);
    res.status(500).json({
      status: "error",
      message: err.detail || err.message || "Internal error"
    });
  }
});





// ✅ Esta función debe estar disponible antes de ser usada (puedes moverla arriba si prefieres)
function cleanPgArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim().toLowerCase());
  return value
    .replace(/[\{\}"]/g, "")
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}



app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM history ORDER BY finished_at DESC");
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

app.get("/api/roles", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM roles ORDER BY name");
    const roles = result.rows.map(r => r.name);
    res.json(roles);
  } catch (err) {
    console.error("Error fetching roles:", err);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});


app.post("/api/update-user", async (req, res) => {
  const { username, email, role, project } = req.body;

  try {
    const roleArray = Array.isArray(role) ? role : role.split(",").map(r => r.trim());
    const projectArray = Array.isArray(project) ? project : project.split(",").map(p => p.trim());

    await pool.query(
      "UPDATE users SET email = $1, role = $2, project = $3 WHERE username = $4",
      [email, roleArray, projectArray, username.toLowerCase()]
    );

    res.json({ status: "success", message: "User updated" });
  } catch (err) {
    console.error("❌ Error updating user:", err);
    res.status(500).json({ status: "error", message: "Error updating user" });
  }
});


app.post("/api/delete-user", async (req, res) => {
  const { username } = req.body;

  try {
    await pool.query("DELETE FROM users WHERE username = $1", [username.toLowerCase()]);
    res.json({ status: "success", message: "User deleted" });
  } catch (err) {
    console.error("❌ Error deleting user:", err);
    res.status(500).json({ status: "error", message: "Error deleting user" });
  }
});

app.get("/api/projects", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM projects");
    const projects = result.rows.map(row => ({
      name: row.name,
      levels: row.levels || [],
      pause: row.pause || "disabled"
    }));
    res.json(projects);
  } catch (err) {
    console.error("Error loading projects:", err);
    res.status(500).json({ status: "error", message: "Failed to load projects" });
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
  "INSERT INTO users (username, password, email, role, project) VALUES ($1, $2, $3, $4, $5)",
  [
    user.username.toLowerCase(),
    hashedPassword,
    user.email || "",
    Array.isArray(user.role) ? user.role.join(",") : user.role,
    Array.isArray(user.project) ? user.project.join(",") : user.project
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

app.get("/api/admin-logs", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT 200"
    );
    res.json({ logs: result.rows });
  } catch (error) {
    console.error("Error fetching admin logs:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});
