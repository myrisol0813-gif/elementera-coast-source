import { API, requestJson } from '../../core/api.js';

export async function fetchSoilRequest(conversationId) {
  return requestJson(`${API.memorySoil}?conversation_id=${encodeURIComponent(conversationId)}`);
}

export async function saveSoilRequest(conversationId, payload) {
  return requestJson(`${API.memorySoil}?conversation_id=${encodeURIComponent(conversationId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function organizeSoilRequest(payload) {
  return requestJson(API.memorySoilOrganize, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPocketsRequest(conversationId) {
  return requestJson(`${API.memoryPockets}?conversation_id=${encodeURIComponent(conversationId)}&status=pending`);
}

export async function resolvePocketRequest(id, payload) {
  return requestJson(`${API.memoryPockets}/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchPocketRequest(id, payload) {
  return requestJson(`${API.memoryPockets}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deletePocketRequest(id) {
  return requestJson(`${API.memoryPockets}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchEntriesRequest(params) {
  return requestJson(`${API.memoryEntries}?${params}`);
}

export async function createEntryRequest(payload) {
  return requestJson(API.memoryEntries, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function patchEntryRequest(id, payload) {
  return requestJson(`${API.memoryEntries}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteEntryRequest(id) {
  return requestJson(`${API.memoryEntries}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchCustomInstructionsRequest() {
  return requestJson(API.memoryCustomInstructions);
}

export async function saveCustomInstructionsRequest(payload) {
  return requestJson(API.memoryCustomInstructions, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function fetchVectorStatusRequest() {
  return requestJson(API.memoryVectorStatus);
}

export async function fetchGlobalExcerptRequest() {
  return requestJson(API.memoryGlobalExcerpt);
}

export async function setGlobalExcerptWriteEnabledRequest(writeEnabled) {
  return requestJson(API.memoryGlobalExcerpt, {
    method: 'PATCH',
    body: JSON.stringify({ write_enabled: writeEnabled === true }),
  });
}

export async function resolveGlobalExcerptCandidateRequest(id, payload = {}) {
  return requestJson(`${API.memoryGlobalExcerpt}/candidates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function discardGlobalExcerptCandidateRequest(id) {
  return requestJson(`${API.memoryGlobalExcerpt}/candidates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
