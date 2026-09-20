import {decodeKVJSON, KV_JSON_LIMITS} from './kv-json-transport.mjs';

export const RESEARCH_GZIP_PATH = '/research_index.json.gzip';
const METADATA_PATH = '/research_index.metadata.json';

async function boundedBytes(response, limit) {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new Error('Research asset exceeds its transport limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Research asset has no body');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Research asset exceeds its transport limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return bytes;
}

export async function readResearchStaticJSON(assets, requestUrl) {
  if (!assets) return null;
  const fetchAsset = async path => {
    const url = new URL(requestUrl);
    url.pathname = path; url.search = '';
    // Gzip is the stored file format, never HTTP content coding. Request the
    // identity representation to avoid a fetch layer transparently inflating it.
    return assets.fetch(new Request(url, {headers:{'Accept-Encoding':'identity'}}));
  };
  const metadataResponse = await fetchAsset(METADATA_PATH);
  if (metadataResponse.status === 404) return null;
  if (!metadataResponse.ok) throw new Error('Research metadata unavailable');
  const metadata = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await boundedBytes(metadataResponse, 1024)));
  if (!metadata || metadata.schema !== 'kv-json-gzip-v1' || metadata.encoding !== 'gzip'
      || !Number.isSafeInteger(metadata.uncompressed_bytes) || metadata.uncompressed_bytes < 1
      || metadata.uncompressed_bytes > KV_JSON_LIMITS.decoded || !/^[a-f0-9]{64}$/.test(metadata.sha256 || '')) {
    throw new Error('Invalid research transport metadata');
  }
  const response = await fetchAsset(RESEARCH_GZIP_PATH);
  if (!response.ok) throw new Error('Research compressed asset unavailable');
  const coding = response.headers.get('Content-Encoding');
  if (coding && coding.toLowerCase() !== 'identity') {
    await response.body?.cancel();
    throw new Error('Research gzip asset must use identity HTTP content coding');
  }
  return decodeKVJSON(await boundedBytes(response, KV_JSON_LIMITS.encoded), metadata);
}
