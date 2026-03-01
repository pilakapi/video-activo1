import express from "express";
import pkg from "pg";
import fetch from "node-fetch";

const { Pool } = pkg;
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_PIN || !DATABASE_URL) {
  console.error("Faltan variables de entorno.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Crear tabla
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      active BOOLEAN DEFAULT true,
      last_status INTEGER DEFAULT 0,
      last_check TIMESTAMP
    );
  `);
}

// Middleware PIN simple
function checkPin(req, res, next) {
  const pin = req.query.pin || req.body.pin;
  if (pin !== ADMIN_PIN) {
    return res.send(loginPage("PIN incorrecto"));
  }
  next();
}

// Página login
function loginPage(error = "") {
  return `
  <html>
  <head>
    <title>Login</title>
    <style>
      body{font-family:Arial;background:#111;color:#fff;text-align:center;margin-top:100px}
      input{padding:10px;margin:5px;border-radius:5px;border:none}
      button{padding:10px 20px;border:none;border-radius:5px;background:#00c853;color:#fff;cursor:pointer}
      .error{color:red}
    </style>
  </head>
  <body>
    <h2>Panel Stream Guardian</h2>
    ${error ? `<p class="error">${error}</p>` : ""}
    <form method="POST" action="/panel">
      <input type="password" name="pin" placeholder="PIN de acceso" required />
      <br/>
      <button type="submit">Entrar</button>
    </form>
  </body>
  </html>
  `;
}

// Dashboard
async function dashboard(pin) {
  const result = await pool.query("SELECT * FROM channels ORDER BY id DESC");

  const rows = result.rows.map(c => `
    <tr>
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td style="max-width:300px;overflow:hidden">${c.url}</td>
      <td>${c.active ? "🟢" : "🔴"}</td>
      <td>${c.last_status}</td>
      <td>
        <a href="/toggle/${c.id}?pin=${pin}">Activar/Desactivar</a> |
        <a href="/delete/${c.id}?pin=${pin}">Eliminar</a>
      </td>
    </tr>
  `).join("");

  return `
  <html>
  <head>
    <title>Panel</title>
    <style>
      body{font-family:Arial;background:#111;color:#fff;padding:20px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #444;padding:8px;text-align:center}
      input{padding:8px;margin:5px;border-radius:5px;border:none}
      button{padding:8px 15px;border:none;border-radius:5px;background:#00c853;color:#fff;cursor:pointer}
      a{color:#00e5ff}
    </style>
  </head>
  <body>
    <h2>Stream Guardian - Panel</h2>

    <form method="POST" action="/add">
      <input type="hidden" name="pin" value="${pin}" />
      <input type="text" name="name" placeholder="Nombre del canal" required />
      <input type="text" name="url" placeholder="URL m3u8" required />
      <button type="submit">Agregar Canal</button>
    </form>

    <br/>
    <table>
      <tr>
        <th>ID</th>
        <th>Nombre</th>
        <th>URL</th>
        <th>Activo</th>
        <th>Status</th>
        <th>Acciones</th>
      </tr>
      ${rows}
    </table>
  </body>
  </html>
  `;
}

// Rutas
app.get("/", (req, res) => {
  res.send(loginPage());
});

app.post("/panel", async (req, res) => {
  if (req.body.pin !== ADMIN_PIN) {
    return res.send(loginPage("PIN incorrecto"));
  }
  res.send(await dashboard(req.body.pin));
});

app.post("/add", checkPin, async (req, res) => {
  const { name, url, pin } = req.body;
  await pool.query("INSERT INTO channels (name, url) VALUES ($1,$2)", [name, url]);
  res.send(await dashboard(pin));
});

app.get("/toggle/:id", checkPin, async (req, res) => {
  const id = req.params.id;
  await pool.query("UPDATE channels SET active = NOT active WHERE id=$1", [id]);
  res.send(await dashboard(req.query.pin));
});

app.get("/delete/:id", checkPin, async (req, res) => {
  await pool.query("DELETE FROM channels WHERE id=$1", [req.params.id]);
  res.send(await dashboard(req.query.pin));
});

// Endpoint Uptime
app.get("/status", (req, res) => {
  res.json({ status: "online", time: new Date() });
});

// Motor ping automático
async function pingChannels() {
  const result = await pool.query("SELECT id,url FROM channels WHERE active=true");
  for (const c of result.rows) {
    try {
      const response = await fetch(c.url);
      await pool.query(
        "UPDATE channels SET last_status=$1,last_check=NOW() WHERE id=$2",
        [response.status, c.id]
      );
    } catch {
      await pool.query(
        "UPDATE channels SET last_status=500,last_check=NOW() WHERE id=$1",
        [c.id]
      );
    }
  }
}

setInterval(pingChannels, 180000);

app.listen(PORT, async () => {
  await initDB();
  console.log("Panel visual activo en puerto " + PORT);
});
