/**
 * Vercel Cron Job — Backup automático cada 2 horas
 *
 * Schedule (vercel.json): "0 *​/2 * * *" → 00:00, 02:00, 04:00, ... 22:00 UTC
 *
 * Qué hace:
 *   1. Snapshot de las tablas críticas + datos de negocio.
 *   2. INSERT en `admin_backups` con trigger='cron'.
 *   3. Cleanup: deja solo los 12 más recientes (≈ 24h de cobertura).
 *
 * Seguridad:
 *   - Vercel Cron añade automáticamente el header `x-vercel-cron-signature`
 *     y solo se puede invocar desde el cron interno de Vercel. Igual
 *     validamos el header `Authorization` con CRON_SECRET por las dudas.
 *   - Usa SUPABASE_SERVICE_KEY (service role), bypass de RLS.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET || '';

// Tablas a backupear (mismas que el cliente)
const BACKUP_TABLES = [
  // Config editable (crítico)
  'perfume_overrides',
  'perfumes_nuevos',
  'combos',
  'destacados',
  'cierres_especiales',
  'ajuste_horario',
  'votacion_config',
  'decants_config',
  // Data de negocio
  'clientes',
  'opiniones',
  'lista_espera',
  'votos',
  'ventas'
];

const MAX_BACKUPS_TO_KEEP = 12;

async function fetchTable(tableName) {
  try {
    const url = SUPABASE_URL + '/rest/v1/' + encodeURIComponent(tableName) + '?select=*';
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Range-Unit': 'items',
        'Prefer': 'count=exact'
      }
    });
    if (!r.ok) {
      const txt = await r.text();
      return { error: r.status + ' ' + txt.slice(0, 200), rows: [] };
    }
    const rows = await r.json();
    return { rows: rows, count: rows.length };
  } catch (e) {
    return { error: e.message || String(e), rows: [] };
  }
}

async function buildSnapshot() {
  const snapshot = {};
  const rowCounts = {};
  const errors = [];
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const t = BACKUP_TABLES[i];
    const res = await fetchTable(t);
    if (res.error) {
      errors.push({ table: t, error: res.error });
      snapshot[t] = [];
      rowCounts[t] = 0;
    } else {
      snapshot[t] = res.rows;
      rowCounts[t] = res.count || res.rows.length;
    }
  }
  return { snapshot, rowCounts, errors };
}

async function insertBackup(payload, sizeBytes, rowCounts) {
  const url = SUPABASE_URL + '/rest/v1/admin_backups';
  const body = {
    trigger: 'cron',
    actor_email: null,
    size_bytes: sizeBytes,
    row_counts: rowCounts,
    data: payload
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('No se pudo INSERT admin_backups: ' + r.status + ' ' + txt.slice(0, 300));
  }
  return await r.json();
}

async function cleanupOldBackups() {
  // Trae los IDs ordenados por fecha desc, salta los primeros MAX, borra el resto.
  const url = SUPABASE_URL + '/rest/v1/admin_backups?select=id&order=created_at.desc';
  const r = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    }
  });
  if (!r.ok) return { deleted: 0, error: 'no se pudo leer admin_backups' };
  const rows = await r.json();
  if (rows.length <= MAX_BACKUPS_TO_KEEP) return { deleted: 0 };

  const toDelete = rows.slice(MAX_BACKUPS_TO_KEEP).map(b => b.id);
  // Delete en batch (PostgREST soporta in.(...))
  const idsParam = encodeURIComponent('(' + toDelete.join(',') + ')');
  const delUrl = SUPABASE_URL + '/rest/v1/admin_backups?id=in.' + idsParam;
  const delRes = await fetch(delUrl, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    }
  });
  if (!delRes.ok) {
    const txt = await delRes.text();
    return { deleted: 0, error: 'delete fallo: ' + delRes.status + ' ' + txt.slice(0, 200) };
  }
  return { deleted: toDelete.length };
}

module.exports = async (req, res) => {
  // Validación de origen: aceptar solo invocaciones de Vercel Cron
  // o requests con el secret correcto en Authorization header.
  const isVercelCron = req.headers['x-vercel-cron-signature'] !== undefined
    || req.headers['user-agent']?.toLowerCase().includes('vercel-cron');
  const auth = req.headers['authorization'] || '';
  const validAuth = CRON_SECRET && auth === 'Bearer ' + CRON_SECRET;
  if (!isVercelCron && !validAuth) {
    res.status(401).json({ error: 'Unauthorized — solo Vercel Cron o Bearer válido' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({ error: 'SUPABASE_URL o SERVICE_KEY no configurados' });
    return;
  }

  const start = Date.now();
  try {
    // 1) Snapshot
    const built = await buildSnapshot();

    // 2) Insert
    const payload = {
      version: 1,
      created_at: new Date().toISOString(),
      app: 'ST Perfumeria admin backup (cron)',
      snapshot: built.snapshot,
      row_counts: built.rowCounts,
      errors: built.errors.length ? built.errors : undefined
    };
    const jsonStr = JSON.stringify(payload);
    const inserted = await insertBackup(payload, jsonStr.length, built.rowCounts);

    // 3) Cleanup (mantener solo los 12 más recientes)
    const cleanup = await cleanupOldBackups();

    const elapsed = Date.now() - start;
    res.status(200).json({
      ok: true,
      elapsed_ms: elapsed,
      backup_id: inserted && inserted[0] ? inserted[0].id : null,
      size_bytes: jsonStr.length,
      tables: BACKUP_TABLES.length,
      row_counts: built.rowCounts,
      cleanup: cleanup,
      errors: built.errors
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message || String(e),
      elapsed_ms: Date.now() - start
    });
  }
};
