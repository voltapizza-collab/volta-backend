import express from "express";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

const router = express.Router();

/* ===============================
   CONFIG (desde .env)
================================ */
const BACKUP_MODE = process.env.BACKUP_MODE || "manual";
const BACKUP_DIR = process.env.BACKUP_DIR || "_db_backups";
const BACKUP_RETENTION = parseInt(process.env.BACKUP_RETENTION || "7");

/* ===============================
   PARSE DATABASE_URL (CLAVE)
================================ */
function parseDatabaseUrl(url) {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port,
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.replace("/", "")
  };
}

const db = parseDatabaseUrl(process.env.DATABASE_URL);

/* ===============================
   BACKUP ENDPOINT
================================ */
router.post("/backup", (req, res) => {

  // 🔐 PROTECCIÓN API KEY
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log(`Backup mode: ${BACKUP_MODE}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const backupDir = path.resolve(BACKUP_DIR);

  // 📁 crear carpeta si no existe
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }

  const filePath = path.join(backupDir, `backup-${timestamp}.sql`);

  /* ===============================
     RETENCIÓN (mantener últimos N)
  ================================ */
  try {
    const files = fs.readdirSync(backupDir)
      .map(name => ({
        name,
        time: fs.statSync(path.join(backupDir, name)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    files.slice(BACKUP_RETENTION).forEach(file => {
      fs.unlinkSync(path.join(backupDir, file.name));
    });

  } catch (err) {
    console.warn("Retention cleanup failed:", err.message);
  }

  /* ===============================
     SWITCH DE MODOS
  ================================ */
  if (BACKUP_MODE === "manual") {

    const cmd = `mysqldump -h ${db.host} -P ${db.port} -u ${db.user} -p${db.password} ${db.database} > "${filePath}"`;

    exec(cmd, (error) => {
      if (error) {
        console.error("Backup error:", error);
        return res.status(500).json({ error: "Backup failed" });
      }

      console.log("Backup created:", filePath);

      // 📥 descarga directa
      return res.download(filePath);
    });

  } else {

    return res.json({
      message: "Backup mode is not manual. Use external worker.",
      mode: BACKUP_MODE
    });

  }

});

export default router;