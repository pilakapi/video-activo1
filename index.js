import express from "express";
import pkg from "pg";
import fetch from "node-fetch";

const { Pool } = pkg;

const app = express();
app.use(express.json());

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

let isPinging = false;

// Crear tabla si no existe
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
  console.log("Base de datos lista");
}

// Middleware de PIN
function auth(req, res, next) {
  const pin = req.headers["x-pin"];
  if (pin !== ADMIN_PIN) {
    return res.status(403).json({ error: "PIN inválido" });
  }
  next();
}

// Agregar canal
app.post("/channels", auth, async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: "Datos incompletos" });

  await pool.query(
    "INSERT INTO channels (name, url) VALUES ($1, $2)",
    [name, url]
  );

  res.json({ message: "Canal agregado" });
});

// Listar canales
app.get("/channels", auth, async (req, res) => {
  const result = await pool.query("SELECT * FROM channels ORDER BY id DESC");
  res.json(result.rows);
});

// Activar / desactivar canal
app.patch("/channels/:id", auth, async (req, res) => {
  const { active } = req.body;
  await pool.query(
    "UPDATE channels SET active = $1 WHERE id = $2",
    [active, req.params.id]
  );
  res.json({ message: "Estado actualizado" });
});

// Eliminar canal
app.delete("/channels/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM channels WHERE id = $1", [req.params.id]);
  res.json({ message: "Canal eliminado" });
});

// Endpoint para UptimeRobot
app.get("/status", (req, res) => {
  res.json({ status: "online", time: new Date() });
});

// Motor de Ping optimizado
async function pingChannels() {
  if (isPinging) return;
  isPinging = true;

  try {
    const result = await pool.query(
      "SELECT id, url FROM channels WHERE active = true"
    );

    for (const channel of result.rows) {
      try {
        const response = await fetch(channel.url, {
          method: "GET",
          timeout: 10000
        });

        await pool.query(
          "UPDATE channels SET last_status = $1, last_check = NOW() WHERE id = $2",
          [response.status, channel.id]
        );

        console.log(`OK ${channel.id} - ${response.status}`);
      } catch (err) {
        await pool.query(
          "UPDATE channels SET last_status = 500, last_check = NOW() WHERE id = $1",
          [channel.id]
        );

        console.log(`ERROR ${channel.id}`);
      }
    }
  } catch (err) {
    console.error("Error general de ping:", err.message);
  }

  isPinging = false;
}

// Intervalo inteligente (cada 3 minutos)
setInterval(pingChannels, 180000);

// Iniciar servidor
app.listen(PORT, async () => {
  await initDB();
  console.log(`Servidor ultra activo en puerto ${PORT}`);
});
