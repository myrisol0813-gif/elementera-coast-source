import assert from 'node:assert/strict';
import {snapSceneRatio,SCENE_RATIOS} from '../elementera-mcp/deploy-pages/public/rest-box/rest-box-shell.mjs';
assert.equal(snapSceneRatio(undefined),SCENE_RATIOS[1]);assert.equal(snapSceneRatio(.29),SCENE_RATIOS[0]);assert.equal(snapSceneRatio(.9),SCENE_RATIOS[2]);
assert.equal(snapSceneRatio(.63),SCENE_RATIOS[1]);console.log('rest-box split ratio checks passed');
