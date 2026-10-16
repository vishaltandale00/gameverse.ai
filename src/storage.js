let opening;
function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('gameverse-environment', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close other Gameverse tabs to finish opening progress storage.'));
  });
  return opening;
}
export async function get(key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function put(key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite', { durability: 'strict' });
    tx.objectStore('records').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || Error('Storage write failed.'));
  });
}
// All payloads and the new head commit together. Failed writes leave the prior head intact.
export async function commitCheckpoint(key, expectedRevision, checkpoint, battery) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite', { durability: 'strict' });
    const records = tx.objectStore('records');
    const timer = setTimeout(() => {
      failure = Error('Checkpoint storage timed out. Retry after checking browser storage.');
      try { tx.abort(); } catch { reject(failure); }
    }, 10000);
    let next;
    let failure;
    const request = records.get(key);
    request.onsuccess = () => {
      try {
        const previous = request.result || { revision: 0 };
        if (previous.revision !== expectedRevision) throw Error('Progress changed in another session. The confirmed checkpoint was preserved.');
        records.add(checkpoint, `snapshot:${checkpoint.id}`);
        if (battery) records.add(battery, `battery:${battery.id}`);
        next = { revision: previous.revision + 1, snapshotId: checkpoint.id, batteryId: battery?.id || previous.batteryId, savedAt: checkpoint.savedAt, frame: checkpoint.frame };
        records.put(next, key);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => { clearTimeout(timer); resolve(next); };
    tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure || tx.error || Error('Checkpoint write failed.')); };
  });
}
export async function acquireSessionLock(key) {
  if (!navigator.locks) throw Error('This browser cannot protect progress from concurrent writers. Use a current Chrome browser on localhost.');
  return new Promise((resolve, reject) => {
    const completion = navigator.locks.request(key, { ifAvailable: true }, async lock => {
      if (!lock) { reject(Error('This profile and game are already open in another tab. Return there before continuing.')); return; }
      await new Promise(release => resolve(() => {
        release();
        // Resolving the callback's hold does not synchronously release the Web Lock.
        // Callers may reacquire only after the request itself has completed.
        return completion;
      }));
    });
    completion.catch(reject);
  });
}
