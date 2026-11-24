// V2 binary object protocol. Chunks are independently authenticated for integrity;
// publication is the caller's responsibility after ALL objects and records verify.
export const ARCHIVE_CHUNK_BYTES = 1024 * 1024;
const hex = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
export async function digestBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function objectFingerprint(size, chunks) {
  return digestBytes(encoder.encode('coast-object-v2\n'+size+'\n'+chunks.join('\n')));
}
export async function validateObjectDescriptor(value, {maxBytes=Number.MAX_SAFE_INTEGER,maxChunks=65536}={}) {
  if (!value || !Number.isSafeInteger(value.size) || value.size<0 || value.size>maxBytes ||
      !Array.isArray(value.chunks) || value.chunks.length>maxChunks ||
      value.chunks.length!==Math.ceil(value.size/ARCHIVE_CHUNK_BYTES) ||
      !value.chunks.every(h=>typeof h==='string'&&hex.test(h)) ||
      typeof value.object_sha256!=='string'||!hex.test(value.object_sha256)) throw Error('invalid archive object descriptor');
  if(await objectFingerprint(value.size,value.chunks)!==value.object_sha256)throw Error('object manifest digest mismatch');
  return value;
}
export async function describeObject(size, chunks, limits) {
  return validateObjectDescriptor({size,chunks:[...chunks],object_sha256:await objectFingerprint(size,chunks)},limits);
}
export function objectPath(descriptor) {
  if(!hex.test(descriptor?.object_sha256||''))throw Error('invalid object path');
  return 'objects/'+descriptor.object_sha256;
}
// Each input element must be exactly one protocol chunk, in order. The sink
// must point to disposable staging storage, never directly to a live record.
export async function stageVerifiedObject(descriptor, source, writeChunk, limits) {
  await validateObjectDescriptor(descriptor,limits);
  let index=0, size=0;
  for await(const chunk of source) {
    if(!(chunk instanceof Uint8Array)||index>=descriptor.chunks.length||
       chunk.byteLength!==Math.min(ARCHIVE_CHUNK_BYTES,descriptor.size-size)||
       await digestBytes(chunk)!==descriptor.chunks[index])throw Error('archive chunk verification failed at '+index);
    await writeChunk(chunk,index);size+=chunk.byteLength;index++;
  }
  if(size!==descriptor.size||index!==descriptor.chunks.length)throw Error('archive object incomplete');
  return {size,object_sha256:descriptor.object_sha256};
}
