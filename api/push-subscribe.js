/**
 * Vercel Serverless Function — Suscribirse a push notifications
 * POST /api/push-subscribe
 * Body: { endpoint, subscription }
 *
 * Protección anti-spam: máximo 3 suscripciones por IP por día
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtgjzzkjrwbkdhkslxix.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { endpoint, subscription } = req.body || {};

    if (!endpoint || !subscription) {
      return res.status(400).json({ error: 'Faltan endpoint y subscription' });
    }

    // Obtener IP del usuario
    const ip = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.headers['x-real-ip'] || 'unknown';

    // Verificar rate limit: máximo 3 suscripciones por IP en las últimas 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const countRes = await fetch(
      SUPABASE_URL + '/rest/v1/push_subscriptions?select=id&ip=eq.' + encodeURIComponent(ip) + '&created_at=gte.' + encodeURIComponent(since),
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      }
    );

    if (countRes.ok) {
      const recent = await countRes.json();
      if (recent.length >= 3) {
        return res.status(429).json({ error: 'Demasiadas suscripciones. Intentá más tarde.' });
      }
    }

    // Guardar/actualizar suscripción
    const upsertRes = await fetch(
      SUPABASE_URL + '/rest/v1/push_subscriptions',
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          endpoint: endpoint,
          subscription: subscription,
          ip: ip,
          created_at: new Date().toISOString()
        })
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return res.status(500).json({ error: 'Error guardando: ' + errText });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: err.message });
  }
};
