// Session persistence — IndexedDB, all local. Closing the tab, switching
// apps on a phone, or a crash mid-edit no longer loses the workspace: photo
// blobs live in one store, the arrangement (slides, tray, settings) as one
// snapshot in another. Preview bitmaps are not stored; restore re-decodes
// them from the blobs with createImageBitmap's native resize.

const DB_NAME = 'photogram'
const DB_VERSION = 1

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const tx = (db, store, mode) => db.transaction(store, mode).objectStore(store)

const done = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })

// strip the live bitmap — everything else round-trips through IDB cleanly
const record = (photo) => {
  const { previewBitmap, ...rest } = photo
  return rest
}

export async function savePhotos(photos) {
  try {
    const db = await openDb()
    const t = db.transaction('photos', 'readwrite')
    const s = t.objectStore('photos')
    for (const p of photos) s.put(record(p))
    await done(t)
  } catch {
    // private browsing or quota — the session just won't survive a reload
  }
}

export async function deletePhotos(ids) {
  try {
    const db = await openDb()
    const t = db.transaction('photos', 'readwrite')
    const s = t.objectStore('photos')
    for (const id of ids) s.delete(id)
    await done(t)
  } catch {
    // ignore
  }
}

export async function saveWorkspace(snapshot) {
  try {
    const db = await openDb()
    const t = db.transaction('state', 'readwrite')
    t.objectStore('state').put(snapshot, 'workspace')
    await done(t)
  } catch {
    // ignore
  }
}

// → { workspace, photos } or null when nothing was stored
export async function loadSession() {
  try {
    const db = await openDb()
    const workspace = await new Promise((resolve, reject) => {
      const req = tx(db, 'state', 'readonly').get('workspace')
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
    if (!workspace) return null
    const photos = await new Promise((resolve, reject) => {
      const req = tx(db, 'photos', 'readonly').getAll()
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error)
    })
    if (photos.length === 0) return null
    return { workspace, photos }
  } catch {
    return null
  }
}

export async function clearSession() {
  try {
    const db = await openDb()
    const t = db.transaction(['photos', 'state'], 'readwrite')
    t.objectStore('photos').clear()
    t.objectStore('state').clear()
    await done(t)
  } catch {
    // ignore
  }
}
