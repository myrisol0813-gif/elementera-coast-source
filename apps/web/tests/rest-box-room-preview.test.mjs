import assert from 'node:assert/strict';
import {roomPreviewSlots,previewOccupants} from '../elementera-mcp/deploy-pages/public/rest-box/room-state.mjs';
const cat={"rooms":{"living":{}},"assets":{"bed":{"id":"living-nest","name":"窝","anchors":[{"id":"nest","action":"sleep"}]},"chair":{"id":"living-sofa","name":"沙发","anchors":[{"id":"seat","action":"sit"}]}}},state={"rooms":{"living":[{"id":"a","assetId":"bed","visible":true},{"id":"b","assetId":"chair","visible":true}]}},house={"model":{"bodyId":"wolf"},"human":{"bodyId":"cat"},"humanEnabled":true};
assert.equal(roomPreviewSlots(state,cat,'living').length,2);
assert.equal(previewOccupants(state,cat,'living',house).length,2);
assert.equal(previewOccupants(state,cat,'living',house)[0].instanceId,'a');
assert.equal(previewOccupants(state,cat,'living',house,{model:'b:seat'})[0].instanceId,'b');
assert.equal(previewOccupants(state,cat,'living',house,{model:'none'}).length,1);
