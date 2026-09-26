/* IndexedDB persistence and one-time legacy localStorage migration. */
const CashflowStorage = (() => {
  const DATABASE_NAME = 'cashflow-manager';
  const DATABASE_VERSION = 1;
  const DATA_STORES = ['wallets', 'transactions', 'notes'];
  const LEGACY_KEYS = {
    wallets: 'axis_wallets',
    transactions: 'axis_transactions',
    notes: 'axis_notes',
    settings: 'axis_settings'
  };
  let databasePromise;
  let writeQueue = Promise.resolve();

  function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        DATA_STORES.forEach(name => {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
        });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
        if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata');
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error('Unable to open local database.'));
      request.onblocked = () => reject(new Error('The local database is blocked by another open tab.'));
    });

    return databasePromise;
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
      transaction.onerror = () => reject(transaction.error || new Error('Database transaction failed.'));
    });
  }

  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function readSnapshotFromTransaction(transaction) {
    const requests = [...DATA_STORES, 'settings'].map(name => new Promise((resolve, reject) => {
      const request = name === 'settings'
        ? transaction.objectStore(name).get('current')
        : transaction.objectStore(name).getAll();
      request.onsuccess = () => resolve([name, name === 'settings' ? request.result || {} : request.result || []]);
      request.onerror = () => reject(request.error || new Error(`Unable to read ${name}.`));
    }));
    return Promise.all(requests).then(entries => Object.fromEntries(entries));
  }

  function normalizeLegacyData() {
    const data = {};
    Object.entries(LEGACY_KEYS).forEach(([storeName, key]) => {
      const raw = localStorage.getItem(key);
      if (raw === null) {
        data[storeName] = storeName === 'settings' ? {} : [];
        return;
      }
      data[storeName] = JSON.parse(raw);
      if (storeName !== 'settings' && !Array.isArray(data[storeName])) {
        throw new Error(`Legacy ${storeName} data is not a list.`);
      }
      if (storeName === 'settings' && (!data[storeName] || Array.isArray(data[storeName]) || typeof data[storeName] !== 'object')) {
        throw new Error('Legacy settings data is invalid.');
      }
    });
    return data;
  }

  function writeLegacyData(database, data) {
    const transaction = database.transaction([...DATA_STORES, 'settings', 'metadata'], 'readwrite');
    const done = transactionDone(transaction);
    DATA_STORES.forEach(name => {
      const store = transaction.objectStore(name);
      store.clear();
      data[name].forEach((item, index) => store.put(item, `legacy-${String(index).padStart(12, '0')}`));
    });
    transaction.objectStore('settings').put(data.settings, 'current');
    transaction.objectStore('metadata').put({ complete: false }, 'legacy-migration');
    return done;
  }

  async function readSnapshot() {
    const database = await openDatabase();
    const transaction = database.transaction([...DATA_STORES, 'settings'], 'readonly');
    const done = transactionDone(transaction);
    const snapshot = await readSnapshotFromTransaction(transaction);
    await done;
    return snapshot;
  }

  async function migrateLegacyData(database) {
    const metadataTransaction = database.transaction('metadata', 'readonly');
    const metadataDone = transactionDone(metadataTransaction);
    const markerRequest = metadataTransaction.objectStore('metadata').get('legacy-migration');
    const marker = await new Promise((resolve, reject) => {
      markerRequest.onsuccess = () => resolve(markerRequest.result);
      markerRequest.onerror = () => reject(markerRequest.error);
    });
    await metadataDone;
    if (marker && marker.complete) return;

    const legacyData = normalizeLegacyData();
    await writeLegacyData(database, legacyData);
    const migrated = await readSnapshot();
    const verified = DATA_STORES.every(name => stableJson(migrated[name]) === stableJson(legacyData[name])) &&
      stableJson(migrated.settings) === stableJson(legacyData.settings);
    if (!verified) throw new Error('Legacy data could not be verified after migration.');

    const completionTransaction = database.transaction('metadata', 'readwrite');
    const completionDone = transactionDone(completionTransaction);
    completionTransaction.objectStore('metadata').put({ complete: true, completedAt: new Date().toISOString() }, 'legacy-migration');
    await completionDone;
  }

  async function initialize() {
    const database = await openDatabase();
    await migrateLegacyData(database);
    return readSnapshot();
  }

  function serializeWrite(operation) {
    const next = writeQueue.then(operation);
    writeQueue = next.catch(error => console.error('IndexedDB write failed:', error));
    return next;
  }

  function replaceSnapshot(snapshot) {
    return serializeWrite(async () => {
      const database = await openDatabase();
      const transaction = database.transaction([...DATA_STORES, 'settings'], 'readwrite');
      const done = transactionDone(transaction);
      DATA_STORES.forEach(name => {
        const store = transaction.objectStore(name);
        store.clear();
        (snapshot[name] || []).forEach((item, index) => store.put(item, `record-${String(index).padStart(12, '0')}`));
      });
      transaction.objectStore('settings').put(snapshot.settings || {}, 'current');
      await done;
    });
  }

  async function get(storeName, key) {
    if (![...DATA_STORES, 'settings', 'metadata'].includes(storeName)) throw new Error('Unknown data store.');
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const result = await new Promise((resolve, reject) => {
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await done;
    return result;
  }

  function put(storeName, value, key) {
    if (![...DATA_STORES, 'settings', 'metadata'].includes(storeName)) return Promise.reject(new Error('Unknown data store.'));
    return serializeWrite(async () => {
      const database = await openDatabase();
      const transaction = database.transaction(storeName, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeName).put(value, key);
      await done;
    });
  }

  function remove(storeName, key) {
    if (![...DATA_STORES, 'settings', 'metadata'].includes(storeName)) return Promise.reject(new Error('Unknown data store.'));
    return serializeWrite(async () => {
      const database = await openDatabase();
      const transaction = database.transaction(storeName, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(storeName).delete(key);
      await done;
    });
  }

  async function query(storeName, predicate = () => true) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const rows = await new Promise((resolve, reject) => {
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await done;
    return rows.filter(predicate);
  }

  return { initialize, readSnapshot, replaceSnapshot, get, put, remove, query };
})();