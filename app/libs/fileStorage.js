export class FileStorage {
  constructor() {
    this.dbName = "FiDropDB";
    this.storeName = "files";
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.db) return this.db;

    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      // ✅ Increment version to force upgrade
      const request = indexedDB.open(this.dbName, 3);

      request.onerror = () => {
        console.error("IndexedDB error:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log("IndexedDB opened successfully, version:", this.db.version);

        // ✅ Handle close event
        this.db.onclose = () => {
          console.log("IndexedDB connection closed");
          this.db = null;
          this.initPromise = null;
        };

        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        console.log(
          `Upgrading IndexedDB from version ${oldVersion} to ${db.version}`
        );

        // ✅ Drop existing store if needed (clean slate)
        if (db.objectStoreNames.contains(this.storeName)) {
          console.log("Dropping existing store");
          db.deleteObjectStore(this.storeName);
        }

        // ✅ Create store with indexes
        const store = db.createObjectStore(this.storeName, { keyPath: "id" });

        // ✅ Create indexes
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("id", "id", { unique: true });

        console.log("Object store and indexes created successfully");
      };
    });

    return this.initPromise;
  }

  async saveFile(sessionId, file) {
    await this.init();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const transaction = this.db.transaction(
            [this.storeName],
            "readwrite"
          );
          const store = transaction.objectStore(this.storeName);
          const id = `${sessionId}_${file.name}_${Date.now()}`;
          const data = {
            id: id,
            sessionId: sessionId,
            name: file.name,
            size: file.size,
            type: file.type,
            data: reader.result,
            timestamp: Date.now(),
          };

          const request = store.put(data);

          request.onsuccess = () => {
            console.log(`✅ File saved to IndexedDB: ${file.name}`);
            resolve(data);
          };

          request.onerror = () => {
            console.error("Error saving to IndexedDB:", request.error);
            reject(request.error);
          };

          transaction.oncomplete = () => {
            console.log("Transaction completed");
          };

          transaction.onerror = (event) => {
            console.error("Transaction error:", event.target.error);
            reject(event.target.error);
          };
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => {
        console.error("FileReader error:", reader.error);
        reject(reader.error);
      };
      reader.readAsDataURL(file);
    });
  }

  async loadFiles(sessionId) {
    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.storeName], "readonly");
        const store = transaction.objectStore(this.storeName);
        const index = store.index("sessionId");
        const request = index.getAll(sessionId);

        request.onsuccess = () => {
          const files = request.result;
          console.log(
            `✅ Loaded ${files.length} files from IndexedDB for session ${sessionId}`
          );

          // Urutkan berdasarkan timestamp
          files.sort((a, b) => a.timestamp - b.timestamp);

          resolve(files);
        };

        request.onerror = (event) => {
          console.error("Error loading from IndexedDB:", event.target.error);
          reject(event.target.error);
        };
      } catch (err) {
        console.error("IndexedDB load error:", err);
        reject(err);
      }
    });
  }

  async deleteFiles(sessionId) {
    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);

        // ✅ Try to use index, fallback to manual filter
        let request;
        try {
          const index = store.index("sessionId");
          request = index.getAll(sessionId);
        } catch (indexError) {
          request = store.getAll();
          request.onsuccess = () => {
            const allFiles = request.result;
            const filesToDelete = allFiles.filter(
              (file) => file.sessionId === sessionId
            );
            filesToDelete.forEach((file) => {
              store.delete(file.id);
            });
            console.log(`Deleted ${filesToDelete.length} files from IndexedDB`);
            resolve();
          };
          request.onerror = () => reject(request.error);
          return;
        }

        request.onsuccess = () => {
          const files = request.result;
          files.forEach((file) => {
            store.delete(file.id);
          });
          console.log(`✅ Deleted ${files.length} files from IndexedDB`);
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  async clearOldFiles(maxAge = 3600000) {
    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.storeName], "readwrite");
        const store = transaction.objectStore(this.storeName);

        // ✅ Try to use index, fallback to manual filter
        let request;
        try {
          const index = store.index("timestamp");
          request = index.getAll();
        } catch (indexError) {
          request = store.getAll();
          request.onsuccess = () => {
            const now = Date.now();
            let deletedCount = 0;
            request.result.forEach((file) => {
              if (now - (file.timestamp || 0) > maxAge) {
                store.delete(file.id);
                deletedCount++;
              }
            });
            console.log(
              `Cleaned up ${deletedCount} old files from IndexedDB (fallback)`
            );
            resolve();
          };
          request.onerror = () => reject(request.error);
          return;
        }

        request.onsuccess = () => {
          const now = Date.now();
          let deletedCount = 0;
          request.result.forEach((file) => {
            if (now - file.timestamp > maxAge) {
              store.delete(file.id);
              deletedCount++;
            }
          });
          console.log(`✅ Cleaned up ${deletedCount} old files from IndexedDB`);
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  async getAllSessions() {
    await this.init();

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.storeName], "readonly");
        const store = transaction.objectStore(this.storeName);
        const request = store.getAll();

        request.onsuccess = () => {
          const sessions = new Set();
          request.result.forEach((file) => {
            sessions.add(file.sessionId);
          });
          resolve(Array.from(sessions));
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }
  async verifyFileExists(sessionId, fileName) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const index = store.index("sessionId");
      const request = index.getAll(sessionId);

      request.onsuccess = () => {
        const exists = request.result.some((f) => f.name === fileName);
        resolve(exists);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const fileStorage = new FileStorage();
