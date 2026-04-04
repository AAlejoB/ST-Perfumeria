/**
 * Vercel Serverless Function — Enviar notificaciones push
 * POST /api/send-notification
 * Body: { title, body, url, adminPass }
 */

const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const ADMIN_PASS = process.env.ADMIN_PASS;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

webpush.setVapidDetails(
  'mailto:st.perfumeria.cr@gmail.com',
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { title, body, url, adminPass } = req.body || {};

    // Verificar contraseña admin
    if (adminPass !== ADMIN_PASS) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    if (!title || !body) {
      return res.status(400).json({ error: 'Faltan title y body' });
    }

    // Rate limit: máximo 5 envíos masivos por día
    const MAX_SENDS_PER_DAY = 5;
    const today = new Date().toISOString().slice(0, 10);
    const logRes = await fetch(
      SUPABASE_URL + '/rest/v1/push_send_log?select=id&sent_date=eq.' + today,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      }
    );
    if (logRes.ok) {
      const todayLogs = await logRes.json();
      if (todayLogs.length >= MAX_SENDS_PER_DAY) {
        return res.status(429).json({ error: 'Límite de ' + MAX_SENDS_PER_DAY + ' envíos por día alcanzado' });
      }
    }

    // Obtener suscripciones de Supabase
    const response = await fetch(SUPABASE_URL + '/rest/v1/push_subscriptions?select=*', {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'Error leyendo suscripciones: ' + errText });
    }

    const subscriptions = await response.json();

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ sent: 0, failed: 0, message: 'No hay suscriptores' });
    }

    const payload = JSON.stringify({
      title: title,
      body: body,
      url: url || '/',
      icon: '/img/logo-st.webp'
    });

    let sent = 0;
    let failed = 0;
    const toDelete = [];

    // Enviar a cada suscriptor
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          const pushSub = JSON.parse(sub.subscription);
          await webpush.sendNotification(pushSub, payload);
          sent++;
        } catch (err) {
          failed++;
          // Si la suscripción ya no es válida (410 Gone o 404), marcarla para eliminar
          if (err.statusCode === 410 || err.statusCode === 404) {
            toDelete.push(sub.id);
          }
        }
      })
    );

    // Limpiar suscripciones inválidas
    if (toDelete.length > 0) {
      await fetch(SUPABASE_URL + '/rest/v1/push_subscriptions?id=in.(' + toDelete.join(',') + ')', {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      });
    }

    // Registrar envío en log
    await fetch(SUPABASE_URL + '/rest/v1/push_send_log', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        body: body,
        sent_count: sent,
        failed_count: failed,
        sent_date: new Date().toISOString().slice(0, 10)
      })
    });

    return res.status(200).json({
      sent: sent,
      failed: failed,
      cleaned: toDelete.length,
      total: subscriptions.length
    });

  } catch (err) {
    console.error('Push error:', err);
    return res.status(500).json({ error: err.message });
  }
};
