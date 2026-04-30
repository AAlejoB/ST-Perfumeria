/**
 * Vercel Edge Function — Generador de OG images dinámicas por perfume
 * GET /api/og?slug=khanjar
 *   ó GET /api/og?name=KHANJAR&brand=Lattafa&price=25000&img=...
 *
 * Devuelve un PNG 1200x630 con:
 *   - Foto del perfume (izquierda)
 *   - Nombre + marca + precio + cuotas (derecha)
 *   - Logo ST en esquina
 *   - Paleta consistente con la marca
 *
 * Cache: 1h CDN + stale-while-revalidate. Vercel Edge cachea por URL,
 * así que cada perfume tiene su propio asset reutilizable.
 *
 * Uso desde api/share.js:
 *   og:image → BASE_URL + '/api/og?slug=' + slug
 */

import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const BASE_URL = 'https://www.stperfumeria.com';
const COLOR_BG       = '#0a0a0a';
const COLOR_BG_DEEP  = '#121214';
const COLOR_GOLD     = '#E8B800';
const COLOR_GOLD_DIM = '#a88500';
const COLOR_WHITE    = '#f0ede8';
const COLOR_GRAY     = '#888';

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;

    // Recibimos los datos por query params (los pasa api/share.js)
    const name  = params.get('name')  || 'ST Perfumería';
    const brand = params.get('brand') || '';
    const price = params.get('price') || '';
    const img   = params.get('img')   || '';
    const cat   = params.get('cat')   || '';

    // Formateo del precio en formato AR
    const priceFormatted = price
      ? '$' + Math.round(Number(String(price).replace(/[,.]/g, ''))).toLocaleString('es-AR').replace(/,/g, '.')
      : '';

    // Si tiene foto de perfume, la mostramos a la izquierda. Sino,
    // un placeholder dorado con la primera letra del nombre (consistente
    // con el resto del sitio).
    const hasImage = !!img;
    const initial = (name.trim().charAt(0) || 'S').toUpperCase();

    return new ImageResponse(
      {
        type: 'div',
        props: {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            background: 'linear-gradient(135deg, ' + COLOR_BG + ' 0%, ' + COLOR_BG_DEEP + ' 70%, #1a1308 100%)',
            position: 'relative',
            fontFamily: 'sans-serif',
          },
          children: [
            // Tira dorada izquierda
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px',
                  background: 'linear-gradient(180deg, ' + COLOR_GOLD + ', ' + COLOR_GOLD_DIM + ')',
                },
              },
            },
            // Lado izquierdo: imagen del perfume o placeholder dorado
            {
              type: 'div',
              props: {
                style: {
                  width: '500px',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '50px',
                },
                children: hasImage
                  ? {
                      type: 'img',
                      props: {
                        src: img,
                        width: 400,
                        height: 400,
                        style: {
                          objectFit: 'contain',
                          borderRadius: '12px',
                          filter: 'drop-shadow(0 20px 40px rgba(232,184,0,.18))',
                        },
                      },
                    }
                  : {
                      type: 'div',
                      props: {
                        style: {
                          width: '380px',
                          height: '380px',
                          borderRadius: '20px',
                          background: 'rgba(232,184,0,.08)',
                          border: '2px solid rgba(232,184,0,.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '180px',
                          fontWeight: 700,
                          color: COLOR_GOLD,
                          fontFamily: 'serif',
                        },
                        children: initial,
                      },
                    },
              },
            },
            // Lado derecho: textos
            {
              type: 'div',
              props: {
                style: {
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: '60px 70px 60px 20px',
                  gap: '14px',
                },
                children: [
                  // Eyebrow ST
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: '20px',
                        letterSpacing: '6px',
                        textTransform: 'uppercase',
                        color: COLOR_GOLD,
                        fontWeight: 600,
                        marginBottom: '8px',
                      },
                      children: 'ST · Perfumería',
                    },
                  },
                  // Nombre del perfume
                  {
                    type: 'div',
                    props: {
                      style: {
                        fontSize: name.length > 18 ? '54px' : '70px',
                        fontWeight: 700,
                        color: COLOR_WHITE,
                        lineHeight: 1.1,
                        fontFamily: 'serif',
                        letterSpacing: '-1px',
                      },
                      children: name,
                    },
                  },
                  // Marca + categoría
                  brand
                    ? {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '24px',
                            color: COLOR_GRAY,
                            fontWeight: 400,
                            marginTop: '4px',
                          },
                          children: brand + (cat ? ' · ' + cat : ''),
                        },
                      }
                    : null,
                  // Precio (si tiene)
                  priceFormatted
                    ? {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            marginTop: '20px',
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontSize: '46px',
                                  fontWeight: 700,
                                  color: COLOR_GOLD,
                                  lineHeight: 1,
                                },
                                children: priceFormatted,
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: {
                                  fontSize: '18px',
                                  color: COLOR_GRAY,
                                  marginTop: '6px',
                                  letterSpacing: '1px',
                                },
                                children: '3 cuotas sin interés · 10% off efectivo',
                              },
                            },
                          ],
                        },
                      }
                    : null,
                  // Pie con la URL
                  {
                    type: 'div',
                    props: {
                      style: {
                        marginTop: 'auto',
                        paddingTop: '30px',
                        fontSize: '18px',
                        color: COLOR_GRAY,
                        letterSpacing: '2px',
                      },
                      children: 'stperfumeria.com · Comodoro Rivadavia',
                    },
                  },
                ].filter(Boolean),
              },
            },
            // Esquina inferior derecha: badge "Original"
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  right: '32px',
                  top: '32px',
                  background: 'rgba(232,184,0,.15)',
                  border: '1px solid ' + COLOR_GOLD,
                  borderRadius: '999px',
                  padding: '8px 18px',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: COLOR_GOLD,
                  letterSpacing: '2px',
                },
                children: '✓ ORIGINAL',
              },
            },
          ],
        },
      },
      {
        width: 1200,
        height: 630,
        headers: {
          'Cache-Control': 'public, immutable, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (e) {
    return new Response('Error generando OG: ' + (e && e.message ? e.message : 'unknown'), { status: 500 });
  }
}
