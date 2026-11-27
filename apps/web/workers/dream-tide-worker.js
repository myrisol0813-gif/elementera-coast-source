import {runDreamTideTick} from '../functions/dream-tide-scheduler.js';

// Separate Cloudflare Worker entrypoint, since Pages has no scheduled handler.
// No HTTP endpoint can wake a model. Deployment and cron registration are
// explicit operator actions; do not deploy this file from the Pages workflow.
export default {
  async scheduled(event,env,ctx){
    // A live clock is required for heartbeats, receipts and rechecking later windows.
    ctx.waitUntil(runDreamTideTick(env).then(result=>{
      console.log('dream-tide tick',JSON.stringify(result));
    }));
  },
  fetch(){return new Response('Not found',{status:404});}
};
