import { API, requestJson } from '../../core/api.js';
export function fetchModelsCatalog(force=false){
  return requestJson(`${API.models}${force?'?refresh=1':''}`);
}
