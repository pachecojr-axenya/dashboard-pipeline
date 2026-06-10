'use strict';
/**
 * GET /api/auth/callback
 * OAuth2 authorization code callback (fallback quando One Tap não funciona).
 * Troca o code por tokens, verifica, e redireciona para /dashboard com JWT no fragment.
 */

const { createToken, buildSessionCookie, isEmailAuthorized } = require('../../lib/auth');

const ALLOWED_DOMAIN = 'axenya.com'; // usado apenas para o papel (staff x guest)

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { code, error } = req.query || {};

  if (error) {
    return res.redirect(302, '/?error=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect(302, '/?error=no_code');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.redirect(302, '/?error=server_config');
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/auth/callback`,
        grant_type: 'authorization_code'
      }).toString(),
      signal: AbortSignal.timeout(10000)
    });

    if (!tokenRes.ok) {
      console.error('[CALLBACK] Token exchange failed:', tokenRes.status);
      return res.redirect(302, '/?error=token_exchange');
    }

    const tokens = await tokenRes.json();

    // Verify the ID token
    const infoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!infoRes.ok) {
      return res.redirect(302, '/?error=invalid_token');
    }

    const payload = await infoRes.json();

    // Verify audience
    if (payload.aud !== clientId) {
      return res.redirect(302, '/?error=aud_mismatch');
    }

    // Acesso restrito: o e-mail precisa estar na lista de autorizados (lib/auth.js + ALLOWED_EMAILS)
    const email = (payload.email || '').toLowerCase();
    if (!isEmailAuthorized(email)) {
      return res.redirect(302, '/?error=domain_not_allowed');
    }

    // Create session JWT
    const user = {
      name: payload.name || email.split('@')[0],
      email,
      picture: payload.picture || null,
      role: email.endsWith(`@${ALLOWED_DOMAIN}`) ? 'staff' : 'guest'
    };

    const sessionToken = createToken({
      name: user.name,
      email: user.email,
      role: user.role,
      picture: user.picture
    });

    console.log(`[CALLBACK] ${user.name} (${user.email}) autenticado via OAuth callback`);

    res.setHeader('Set-Cookie', buildSessionCookie(sessionToken));
    return res.redirect(302, '/dashboard');

  } catch (e) {
    console.error('[CALLBACK] Error:', e.message);
    return res.redirect(302, '/?error=server_error');
  }
};
