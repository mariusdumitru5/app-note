// =============================================================
//  Frontend "Registro" - Studente B
//  Express serve le 2 pagine statiche + le API REST verso PostgreSQL
//  Tutti i parametri di connessione arrivano da variabili d'ambiente
//  (nel Deployment OpenShift verranno lette dal Secret dello Studente A)
// =============================================================
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const PORT = parseInt(process.env.PORT || '8080', 10);

// Restituisce il valore della prima variabile d'ambiente presente (e non vuota).
// Così l'app accetta sia i nomi DB_* sia quelli usati dalle immagini PostgreSQL:
//   POSTGRES_*   -> immagine ufficiale postgres
//   POSTGRESQL_* -> immagine Red Hat
function pick(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

const dbConfig = {
  host: pick('DB_HOST', 'POSTGRES_HOST', 'POSTGRESQL_HOST') || 'db-service',
  port: parseInt(pick('DB_PORT', 'POSTGRES_PORT', 'POSTGRESQL_PORT') || '5432', 10),
  user: pick('DB_USER', 'POSTGRES_USER', 'POSTGRESQL_USER'),
  password: pick('DB_PASSWORD', 'POSTGRES_PASSWORD', 'POSTGRESQL_PASSWORD'),
  database: pick('DB_NAME', 'POSTGRES_DB', 'POSTGRESQL_DATABASE'),
};

// Nei log si vede subito a cosa prova a collegarsi (la password non viene mai stampata)
console.log('[db] configurazione: host=%s port=%d database=%s user=%s password=%s',
  dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user,
  dbConfig.password ? '(impostata)' : '(MANCANTE)');

const pool = new Pool({
  ...dbConfig,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// Fondamentale per il crash test: se il pod del DB muore, le connessioni
// inattive vanno in errore. Senza questo handler il processo Node crasherebbe.
pool.on('error', (err) => console.error('[db] connessione persa:', err.message));

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS records (
    id         SERIAL PRIMARY KEY,
    nome       VARCHAR(100) NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    creato_il  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

// Crea la tabella all'avvio, riprovando finche' il DB non risponde
// (il pod del frontend potrebbe partire prima di quello del database)
async function ensureTable(attempt = 1) {
  try {
    await pool.query(CREATE_TABLE);
    console.log('[db] connesso a %s, tabella "records" pronta', pool.options.host);
  } catch (err) {
    const wait = Math.min(attempt * 2000, 15000);
    console.error(`[db] tentativo ${attempt} fallito (${err.message}), riprovo tra ${wait / 1000}s`);
    setTimeout(() => ensureTable(attempt + 1), wait);
  }
}

function dbError(res, err) {
  console.error('[db] errore query:', err.message);
  if (err.code === '42P01') ensureTable(); // tabella sparita: la ricreo
  res.status(503).json({ error: 'il database non risponde, riprova tra qualche secondo.' });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Alias delle pagine come da traccia
app.get('/insert', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/manage', (req, res) => res.sendFile(path.join(__dirname, 'public', 'search.html')));

// Probe per OpenShift: risponde se il processo Node e' vivo
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// Stato del DB per la barra "HP" dell'interfaccia
app.get('/api/status', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM records');
    res.json({ db: 'online', records: rows[0].n });
  } catch (err) {
    if (err.code === '42P01') ensureTable();
    res.status(503).json({ db: 'offline' });
  }
});

// Pagina 1 - INSERT
app.post('/api/records', async (req, res) => {
  const nome = String(req.body.nome ?? '').trim();
  const note = String(req.body.note ?? '').trim();
  if (!nome) return res.status(400).json({ error: 'il campo Nome è obbligatorio.' });
  if (nome.length > 100) return res.status(400).json({ error: 'il Nome può avere al massimo 100 caratteri.' });
  if (note.length > 1000) return res.status(400).json({ error: 'le Note possono avere al massimo 1000 caratteri.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO records (nome, note) VALUES ($1, $2) RETURNING id, nome, note, creato_il',
      [nome, note]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    dbError(res, err);
  }
});

// Pagina 2 - SELECT con ricerca testuale su nome e note
app.get('/api/records', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  // Escape di % e _ cosi' vengono cercati come caratteri normali
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, note, creato_il
         FROM records
        WHERE nome ILIKE $1 OR note ILIKE $1
        ORDER BY id DESC
        LIMIT 200`,
      [pattern]
    );
    res.json(rows);
  } catch (err) {
    dbError(res, err);
  }
});

// Pagina 2 - DELETE
app.delete('/api/records/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id non valido.' });
  try {
    const { rowCount } = await pool.query('DELETE FROM records WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'questo record non esiste più.' });
    res.status(204).end();
  } catch (err) {
    dbError(res, err);
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[web] in ascolto sulla porta ${PORT}`);
  ensureTable();
});

// Spegnimento pulito quando OpenShift ferma il pod (SIGTERM)
process.on('SIGTERM', () => {
  console.log('[web] SIGTERM ricevuto, chiudo...');
  server.close(() => pool.end().finally(() => process.exit(0)));
});