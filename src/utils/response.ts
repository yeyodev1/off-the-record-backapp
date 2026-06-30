export function normalizeDocument<T>(doc: T | null | undefined) {
  if (!doc) {
    return null;
  }

  if (typeof doc === "object" && doc && "toObject" in doc && typeof (doc as { toObject: () => T }).toObject === "function") {
    return (doc as { toObject: () => T }).toObject();
  }

  return doc;
}
