// Paired with Ai-Project/scripts/publish_kv_json.py. Deploy this reader before
// publishing compressed values. Metadata and bytes belong to one KV write.
export const KV_JSON_LIMITS = Object.freeze({encoded: 25 * 1024 * 1024, decoded: 64 * 1024 * 1024});
const SCHEMA = 'kv-json-gzip-v1';

function invalid(message) {
  const error = new Error(message);
  error.code = 'KV_JSON_TRANSPORT';
  return error;
}

export async function decodeKVJSON(value, metadata, limits = KV_JSON_LIMITS) {
  if (value == null) return null;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
    : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : typeof value === 'string' ? new TextEncoder().encode(value) : null;
  if (!bytes || bytes.byteLength > limits.encoded) throw invalid('Stored JSON exceeds the transport limit');
  let decoded = bytes;
  if (metadata != null) {
    if (typeof metadata !== 'object' || Array.isArray(metadata) || metadata.schema !== SCHEMA || metadata.encoding !== 'gzip') {
      throw invalid('Unknown JSON transport metadata');
    }
    const size = metadata.uncompressed_bytes;
    if (!Number.isSafeInteger(size) || size < 1 || size > limits.decoded || !/^[a-f0-9]{64}$/.test(metadata.sha256 || '')) {
      throw invalid('Invalid JSON transport size or digest');
    }
    // Allocate once, within the declared and absolute limits. Stop inflation as
    // soon as the producer's declared length is exceeded, including zip bombs.
    decoded = new Uint8Array(size);
    const stream = new ReadableStream({start(controller) { controller.enqueue(bytes); controller.close(); }})
      .pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    let offset = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.byteLength > size) throw invalid('Inflated JSON exceeds its declared size');
        decoded.set(chunk.value, offset);
        offset += chunk.value.byteLength;
      }
      if (offset !== size) throw invalid('Inflated JSON does not match its declared size');
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error?.code === 'KV_JSON_TRANSPORT' ? error : invalid('Invalid compressed JSON');
    } finally {
      reader.releaseLock();
    }
    const hash = await crypto.subtle.digest('SHA-256', decoded);
    const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (sha256 !== metadata.sha256) throw invalid('JSON transport digest mismatch');
  }
  if (decoded.byteLength > limits.decoded) throw invalid('Decoded JSON exceeds the transport limit');
  try { return new TextDecoder('utf-8', {fatal: true}).decode(decoded); }
  catch { throw invalid('JSON transport is not valid UTF-8'); }
}

export async function readKVJSON(kv, key) {
  if (!kv) return null;
  if (typeof kv.getWithMetadata === 'function') {
    const {value, metadata} = await kv.getWithMetadata(key, 'arrayBuffer');
    return decodeKVJSON(value, metadata);
  }
  // Compatibility with plain-text local adapters. Real KV bindings always use
  // the atomic value + metadata read above; never infer a codec from the bytes.
  return decodeKVJSON(await kv.get(key), null);
}
