// JSON transport with explicit Blob encoding; file bytes remain downloadable after DB reload.
export async function encodeWire(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192)
      text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { __blob: btoa(text), type: value.type };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeWire));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encodeWire(v)])),
    );
  return value;
}
export function decodeWire(value: unknown): any {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__blob === 'string')
      return new Blob([Uint8Array.from(atob(obj.__blob), (c) => c.charCodeAt(0))], {
        type: String(obj.type ?? ''),
      });
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decodeWire(v)]));
  }
  return value;
}
