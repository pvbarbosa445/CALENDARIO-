// Camada de persistência em IndexedDB.
// Os dados ficam no aparelho e NÃO são afetados por atualizações do código no GitHub
// (o Service Worker só gerencia o cache de arquivos, nunca este banco).
// Para evoluir o esquema, aumente DB_VERSION e acrescente um passo em upgrade() — nunca apague stores.

const DB_NAME = 'calendario-financeiro';
const DB_VERSION = 3;
export const STORES = ['entries', 'overrides', 'tags', 'settings', 'history', 'checks', 'accounts', 'piggies', 'metas'];
let dbp;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('entries', { keyPath: 'id' });     // lançamentos e recorrências
    db.createObjectStore('overrides', { keyPath: 'key' });  // ajustes por ocorrência (pago, adiado...)
    db.createObjectStore('tags', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('history', { keyPath: 'id', autoIncrement: true }); // histórico de alterações
  }
  if (oldVersion < 2) {
    db.createObjectStore('checks', { keyPath: 'date' });   // dias conferidos
    db.createObjectStore('accounts', { keyPath: 'id' });   // contas
  }
  if (oldVersion < 3) {
    db.createObjectStore('piggies', { keyPath: 'id' });    // cofrinhos
    db.createObjectStore('metas', { keyPath: 'id' });      // metas e orçamentos
  }
}

export function openDB() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => upgrade(req.result, e.oldVersion);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getAll = store => tx(store, 'readonly', s => s.getAll());
export const put = (store, value) => tx(store, 'readwrite', s => s.put(value));
export const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const clear = store => tx(store, 'readwrite', s => s.clear());

/** Aplica um conjunto de mudanças de forma atômica (tudo ou nada). */
export function applyBatch(changes) {
  const stores = Object.keys(changes).filter(k => changes[k].size);
  if (!stores.length) return Promise.resolve();
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    for (const st of stores) {
      const os = t.objectStore(st);
      for (const [k, v] of changes[st]) v ? os.put(v) : os.delete(k);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function log(action, payload) {
  return put('history', { at: new Date().toISOString(), action, payload });
}

/** Pede ao navegador para não apagar os dados em caso de pouco espaço. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch { /* ignora */ }
  return false;
}
