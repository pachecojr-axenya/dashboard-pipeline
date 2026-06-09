/**
 * electron-shim.js — Substitui window.electronAPI (Electron IPC) por chamadas fetch (web)
 *
 * Cobre TODOS os 20 métodos expostos em preload.js:
 *   login, getCurrentUser, listUsers, refresh, logout,
 *   getSettings, saveSettings, pullHubSpot, pullCSData,
 *   fetchDealActivities, fetchCompanyActivities, fetchCompanyDeals,
 *   geminiGenerate, aiCompanyAnalysis, aiCSInsights,
 *   loadAICache, saveAICache, setAutoRefresh,
 *   exploreTickets, pullTickets, fetchTicketActivities,
 *   loadCachedDeals, loadCachedCS, loadCachedCotacao,
 *   onAutoRefreshTick,
 *   jarvisChat, jarvisTestKey, jarvisLoadHistory, jarvisSaveHistory,
 *   saveUserViz, loadUserViz, deleteUserViz,
 *   readKpiSnapshots, writeKpiSnapshot,
 *   resetUserState
 *
 * Segurança:
 * - Sessão em cookie HttpOnly (axenya_session), emitido pelo /api/auth/*
 *   → inacessível ao JS (mitigação XSS), persiste por 30 dias
 * - Fetch usa credentials: 'include' — o browser anexa o cookie automaticamente
 * - User info (nome/email/picture) em localStorage para UI (não é secret)
 * - Cache de dados em sessionStorage (criptografia em trânsito via HTTPS)
 */

(function () {
  'use strict';

  // ===== USER INFO (não-sensível, localStorage para UI) =====
  const USER_KEY = 'axenya_current_user';

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setUser(user) {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }

  // ===== CACHE (sessionStorage) =====
  const CACHE_KEYS = {
    deals: 'axenya_cache_deals',
    cs: 'axenya_cache_cs',
    cotacao: 'axenya_cache_cotacao',
    ai: 'axenya_cache_ai',
    jarvisHistory: 'axenya_jarvis_history',
    jarvisViz: 'axenya_jarvis_viz',
    kpiSnapshots: 'axenya_kpi_snapshots'
  };

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEYS[key]);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeCache(key, data) {
    try {
      sessionStorage.setItem(CACHE_KEYS[key], JSON.stringify(data));
    } catch (e) {
      console.warn('[shim] Cache write failed (storage full?):', e.message);
    }
  }

  // ===== FETCH HELPERS =====

  async function apiPost(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    // 401 → redirecionar para login
    if (res.status === 401) {
      setUser(null);
      window.location.href = '/';
      return { success: false, error: 'Sessão expirada. Faça login novamente.' };
    }

    return res.json();
  }

  async function apiGet(path) {
    const res = await fetch(path, { method: 'GET', credentials: 'include' });

    if (res.status === 401) {
      setUser(null);
      window.location.href = '/';
      return { success: false, error: 'Sessão expirada. Faça login novamente.' };
    }

    return res.json();
  }

  // ===== AUTO-REFRESH (substituição do IPC event) =====
  let _autoRefreshTimer = null;
  const _autoRefreshCallbacks = [];

  function triggerAutoRefresh() {
    _autoRefreshCallbacks.forEach(cb => {
      try { cb(null, {}); } catch { /* ignore */ }
    });
  }

  // ===== window.electronAPI SHIM =====
  window.electronAPI = {

    // --- AUTH ---

    login: async (email, password) => {
      // Suporte dual: Google Auth (novo) + email/password (legado/fallback)
      // O servidor emite cookie HttpOnly; só guardamos user info (não-secret) localmente.
      const result = password
        ? await apiPost('/api/login', { email, password })
        : await apiPost('/api/auth/google', { credential: email });
      if (result.success && result.user) {
        setUser(result.user);
        window.location.href = '/dashboard';
      }
      return result;
    },

    getCurrentUser: async () => {
      // Hidrata do servidor na primeira vez — garante que o cookie ainda vale
      // e pega user info fresca (ex.: nova foto). Cai para cache local se offline.
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.success) {
            setUser(data.user);
            return data.user;
          }
        }
        if (res.status === 401) {
          setUser(null);
          window.location.href = '/';
          return null;
        }
      } catch { /* offline — usa cache */ }
      return getUser();
    },

    listUsers: async () => {
      const result = await apiGet('/api/users');
      return result.success ? result.users : [];
    },

    refresh: async () => {
      window.location.reload();
      return { success: true };
    },

    logout: async () => {
      // Pede ao servidor para limpar o cookie HttpOnly (JS não consegue removê-lo)
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
      setUser(null);
      // Limpar todos os caches
      Object.values(CACHE_KEYS).forEach(k => sessionStorage.removeItem(k));
      if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
      window.location.href = '/';
      return { success: true };
    },

    // --- SETTINGS ---

    getSettings: async () => {
      const result = await apiGet('/api/settings');
      return result.success ? result.settings : {};
    },

    saveSettings: async (settings) => {
      const result = await apiPost('/api/settings', { settings });
      return result;
    },

    // --- HUBSPOT DATA ---

    pullHubSpot: async () => {
      const result = await apiPost('/api/pull-hubspot');
      if (result.success && result.data) {
        writeCache('deals', result.data);
      }
      return result;
    },

    pullCSData: async () => {
      const result = await apiPost('/api/pull-cs-data');
      if (result.success && result.data) {
        writeCache('cs', result.data);
      }
      return result;
    },

    fetchDealActivities: async (hsId) => {
      return apiPost('/api/deal-activities', { hsId: String(hsId) });
    },

    fetchCompanyActivities: async (hsId) => {
      return apiPost('/api/company-activities', { hsId: String(hsId) });
    },

    fetchCompanyDeals: async (hsId) => {
      return apiPost('/api/company-deals', { hsId: String(hsId) });
    },

    // --- TICKETS ---

    exploreTickets: async () => {
      return apiPost('/api/explore-tickets');
    },

    pullTickets: async () => {
      const result = await apiPost('/api/pull-tickets');
      if (result.success && result.data) {
        writeCache('cotacao', result.data);
      }
      return result;
    },

    fetchTicketActivities: async (hsId) => {
      return apiPost('/api/ticket-activities', { hsId: String(hsId) });
    },

    // --- CACHED DATA ---

    loadCachedDeals: async () => {
      return readCache('deals');
    },

    loadCachedCS: async () => {
      return readCache('cs');
    },

    loadCachedCotacao: async () => {
      return readCache('cotacao');
    },

    // --- AI (Claude) ---

    geminiGenerate: async (prompt) => {
      return apiPost('/api/ai-analysis', { prompt });
    },

    aiCompanyAnalysis: async (companyData, activities) => {
      return apiPost('/api/ai-company-analysis', { companyData, activities });
    },

    aiCSInsights: async (portfolioSummary) => {
      return apiPost('/api/ai-cs-insights', { portfolioSummary });
    },

    jarvisChat: async ({ messages, systemPrompt }) => {
      return apiPost('/api/jarvis-chat', { messages, systemPrompt });
    },

    jarvisTestKey: async () => {
      return apiPost('/api/jarvis-chat', {
        messages: [{ role: 'user', content: 'ping' }],
        systemPrompt: 'Reply with the single word: pong.'
      });
    },

    // (jarvisLoadHistory / jarvisSaveHistory defined below — server-first)
    // (loadAICache / saveAICache defined below — server-first)

    // --- AUTO-REFRESH ---

    setAutoRefresh: async (minutes) => {
      if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
      if (minutes > 0) {
        _autoRefreshTimer = setInterval(triggerAutoRefresh, minutes * 60 * 1000);
        return { success: true, interval: minutes };
      }
      return { success: true, interval: 0 };
    },

    // Substitui ipcRenderer.on('auto-refresh-tick', callback)
    onAutoRefreshTick: (callback) => {
      _autoRefreshCallbacks.push(callback);
    },

    // --- JARVIS (Chart-building AI assistant) ---

    jarvisChat: async ({ messages, systemPrompt, model }) => {
      return apiPost('/api/jarvis-chat', { messages, systemPrompt, model });
    },

    jarvisTestKey: async () => {
      try {
        const result = await apiPost('/api/jarvis-chat', {
          messages: [{ role: 'user', content: 'Responda apenas: OK' }],
          systemPrompt: 'Responda apenas a palavra OK, nada mais.'
        });
        return { success: !!result.success };
      } catch {
        return { success: false };
      }
    },

    jarvisLoadHistory: async () => {
      // Server-first; sessionStorage is the offline/cache fallback
      try {
        const result = await apiGet('/api/user-state?key=jarvis-history');
        if (result && result.success && Array.isArray(result.value)) {
          try { sessionStorage.setItem(CACHE_KEYS.jarvisHistory, JSON.stringify(result.value)); } catch {}
          return result.value;
        }
      } catch (e) { console.warn('[shim] jarvisLoadHistory server fetch failed:', e.message); }
      try {
        const raw = sessionStorage.getItem(CACHE_KEYS.jarvisHistory);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },

    jarvisSaveHistory: async (messages) => {
      const trimmed = Array.isArray(messages) && messages.length > 100
        ? messages.slice(messages.length - 100)
        : (messages || []);
      try { sessionStorage.setItem(CACHE_KEYS.jarvisHistory, JSON.stringify(trimmed)); } catch {}
      try {
        const result = await apiPost('/api/user-state', { key: 'jarvis-history', value: trimmed });
        return { success: true, synced: !!(result && result.success) };
      } catch (e) {
        console.warn('[shim] jarvisSaveHistory server sync failed:', e.message);
        return { success: true, synced: false };
      }
    },

    // --- USER VIZ (Jarvis chart persistence) ---
    // Server-first via /api/jarvis-viz (KV-backed, per-user under
    // `user:<email>:jarvis-viz`); sessionStorage used as a local cache and
    // as the fallback path when the server store isn't configured (503)
    // or the request fails.

    saveUserViz: async (spec) => {
      const entry = { ...spec, id: spec.id || ('viz_' + Date.now()), savedAt: new Date().toISOString() };
      // Always update local cache immediately so UI stays snappy
      try {
        const raw = sessionStorage.getItem(CACHE_KEYS.jarvisViz);
        const list = raw ? JSON.parse(raw) : [];
        const i = list.findIndex(v => v && v.id === entry.id);
        if (i >= 0) list[i] = entry; else list.push(entry);
        sessionStorage.setItem(CACHE_KEYS.jarvisViz, JSON.stringify(list));
      } catch (e) { console.warn('[shim] saveUserViz local cache failed:', e.message); }
      // Best-effort sync to server
      try {
        const result = await apiPost('/api/jarvis-viz', { action: 'save', spec: entry });
        if (result && result.success) return { success: true, id: entry.id, synced: true };
        console.warn('[shim] saveUserViz server returned:', result && result.error);
        return { success: true, id: entry.id, synced: false };
      } catch (e) {
        console.warn('[shim] saveUserViz server sync failed:', e.message);
        return { success: true, id: entry.id, synced: false };
      }
    },

    loadUserViz: async () => {
      // Try server first; on success, overwrite local cache
      try {
        const result = await apiGet('/api/jarvis-viz');
        if (result && result.success && Array.isArray(result.charts)) {
          try { sessionStorage.setItem(CACHE_KEYS.jarvisViz, JSON.stringify(result.charts)); } catch {}
          return result.charts;
        }
      } catch (e) { console.warn('[shim] loadUserViz server fetch failed:', e.message); }
      // Fallback to local cache
      try {
        const raw = sessionStorage.getItem(CACHE_KEYS.jarvisViz);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },

    deleteUserViz: async (id) => {
      // Update local cache immediately
      try {
        const raw = sessionStorage.getItem(CACHE_KEYS.jarvisViz);
        const list = raw ? JSON.parse(raw) : [];
        sessionStorage.setItem(CACHE_KEYS.jarvisViz, JSON.stringify(list.filter(v => v && v.id !== id)));
      } catch (e) { console.warn('[shim] deleteUserViz local cache failed:', e.message); }
      // Best-effort server delete
      try {
        const result = await apiPost('/api/jarvis-viz', { action: 'delete', id });
        return { success: true, synced: !!(result && result.success) };
      } catch (e) {
        console.warn('[shim] deleteUserViz server sync failed:', e.message);
        return { success: true, synced: false };
      }
    },

    // --- KPI SNAPSHOTS (server-first, sessionStorage fallback) ---

    readKpiSnapshots: async () => {
      try {
        const result = await apiGet('/api/user-state?key=kpi-snapshots');
        if (result && result.success && Array.isArray(result.value)) {
          try { sessionStorage.setItem(CACHE_KEYS.kpiSnapshots, JSON.stringify(result.value)); } catch {}
          return result.value;
        }
      } catch (e) { console.warn('[shim] readKpiSnapshots server fetch failed:', e.message); }
      try {
        const raw = sessionStorage.getItem(CACHE_KEYS.kpiSnapshots);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },

    writeKpiSnapshot: async (data) => {
      // Read current list (local cache first for speed)
      let list = [];
      try {
        const raw = sessionStorage.getItem(CACHE_KEYS.kpiSnapshots);
        list = raw ? JSON.parse(raw) : [];
      } catch {}
      list.push({ ...data, timestamp: new Date().toISOString() });
      if (list.length > 90) list = list.slice(list.length - 90);
      try { sessionStorage.setItem(CACHE_KEYS.kpiSnapshots, JSON.stringify(list)); } catch {}
      try {
        const result = await apiPost('/api/user-state', { key: 'kpi-snapshots', value: list });
        return { success: true, synced: !!(result && result.success) };
      } catch (e) {
        console.warn('[shim] writeKpiSnapshot server sync failed:', e.message);
        return { success: true, synced: false };
      }
    },

    // --- AI CACHE (server-first, sessionStorage fallback) ---

    loadAICache: async () => {
      try {
        const result = await apiGet('/api/user-state?key=ai-cache');
        if (result && result.success && result.value) {
          try { sessionStorage.setItem(CACHE_KEYS.ai, JSON.stringify(result.value)); } catch {}
          return result.value;
        }
      } catch (e) { console.warn('[shim] loadAICache server fetch failed:', e.message); }
      const cached = readCache('ai');
      return cached || { companyAnalysis: {}, csInsights: null, lastUpdated: null };
    },

    saveAICache: async (data) => {
      const current = readCache('ai') || { companyAnalysis: {}, csInsights: null };
      const merged = { ...current, ...data, lastUpdated: new Date().toISOString() };
      writeCache('ai', merged);
      try {
        await apiPost('/api/user-state', { key: 'ai-cache', value: merged });
      } catch (e) { console.warn('[shim] saveAICache server sync failed:', e.message); }
      return merged;
    },

    // --- RESET all user state (server + local) ---

    resetUserState: async () => {
      let serverOk = false;
      try {
        const result = await apiPost('/api/user-state', { action: 'reset' });
        serverOk = !!(result && result.success);
      } catch (e) { console.warn('[shim] resetUserState server call failed:', e.message); }
      // Wipe local caches regardless (so UI reflects reset even if KV isn't configured)
      try {
        Object.values(CACHE_KEYS).forEach(k => sessionStorage.removeItem(k));
        sessionStorage.removeItem('axenya_jarvis_history');
        // Dashboard layout / card sizes live in localStorage (persist across tabs)
        localStorage.removeItem('axenya_dashboard_layout');
        localStorage.removeItem('axenya_card_sizes');
      } catch {}
      return { success: true, serverSynced: serverOk };
    }
  };

  console.log('[electron-shim] window.electronAPI inicializado (modo web)');
})();
