/**
 * Vercel Cron Job — Backup automático, una vez por día
 *
 * Schedule (vercel.json): "0 3 * * *" → 03:00 UTC (00:00 en Argentina). El plan Hobby de
 * Vercel permite un cron por día; el comentario viejo decía "cada 2 horas".
 * [BACKUPS-PIE] decisión 125b: si cambia la hora del cron en vercel.json, cambiar la frase del pie de
 * Backups en admin.html («Automático: una vez por día, a la medianoche»). vercel.json no admite comentarios.
 *
 * Qué hace:
 *   1. Snapshot de las tablas críticas + datos de negocio.
 *   2. INSERT en `admin_backups` con trigger='auto' (la tabla sólo acepta 'manual' o 'auto':
 *      admin_backups_trigger_check; con 'cron' la base respondía 400 y no se guardaba nada).
 *   3. Cleanup: deja solo los 12 más recientes (con el cron diario, ≈ 12 días).
 *
 * Seguridad:
 *   - [CRON-HEADER-FALSO] 26-sep-2026 · SÓLO se acepta `Authorization: Bearer <CRON_SECRET>`, que
 *     Vercel Cron manda solo cuando la variable CRON_SECRET existe en el proyecto (docs de Vercel,
 *     "Securing cron jobs"). Antes también pasaba cualquier pedido con un header
 *     `x-vercel-cron-signature` o un user-agent con "vercel-cron": los dos los puede mandar
 *     cualquiera (curl -A). Sin la clave de servicio no hacía nada; con la clave, cualquiera podía
 *     disparar backups y, con 12 seguidos, borrar los de verdad (el cleanup deja 12).
 *   - Sin CRON_SECRET se rechaza todo (falla cerrado).
 *   - Usa SUPABASE_SERVICE_KEY (service role o secret key sb_secret_…), bypass de RLS.
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
  'ventas',
  'favoritos',      // [BACKUP-SIN-FAVORITOS] 2.9 (A): igual que BACKUP_TABLES de admin.html
  'mi_seleccion'
];

// [BACKUPS-PIE] decisión 125b · TIENE QUE SER IGUAL a BACKUPS_QUE_SE_GUARDAN de admin.html (el pie de Backups dice
// «Se guardan los últimos N» leyendo esa constante).
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
    trigger: 'auto',   // [CRON-TRIGGER-AUTO] 'cron' violaba admin_backups_trigger_check (sólo 'manual' | 'auto')
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
  // [CRON-HEADER-FALSO] Sólo el secreto del cron (ver arriba). Sin CRON_SECRET, 401 a todo.
  const auth = req.headers['authorization'] || '';
  if (!CRON_SECRET || auth !== 'Bearer ' + CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
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
