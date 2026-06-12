const toPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const createTtlCache = ({ name, ttlMs, maxEntries = 500 }) => {
  const cache = new Map();
  const safeTtlMs = toPositiveNumber(ttlMs, 1000);
  const safeMaxEntries = Math.max(1, Math.trunc(toPositiveNumber(maxEntries, 500)));

  const prune = () => {
    const now = Date.now();

    for (const [key, entry] of cache.entries()) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }

    while (cache.size > safeMaxEntries) {
      const firstKey = cache.keys().next().value;
      if (firstKey == null) break;
      cache.delete(firstKey);
    }
  };

  return {
    get(key) {
      const entry = cache.get(key);
      if (!entry) return null;

      if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
      }

      return entry.value;
    },
    set(key, value) {
      cache.set(key, {
        value,
        expiresAt: Date.now() + safeTtlMs,
      });
      prune();
    },
    delete(key) {
      cache.delete(key);
    },
    clear() {
      cache.clear();
    },
    stats() {
      prune();
      return {
        name,
        ttlMs: safeTtlMs,
        size: cache.size,
        maxEntries: safeMaxEntries,
      };
    },
  };
};
