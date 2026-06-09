export function createLogStore() {
  const entries = [];
  const subscribers = new Set();

  function add(level, message) {
    const entry = {
      timestamp: new Date().toISOString().slice(11, 19),
      level,
      message,
    };
    entries.push(entry);
    for (const fn of subscribers) fn(entry);
    return entry;
  }

  return {
    entries,
    info: (msg) => add("INFO", msg),
    warn: (msg) => add("WARN", msg),
    error: (msg) => add("ERROR", msg),
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
