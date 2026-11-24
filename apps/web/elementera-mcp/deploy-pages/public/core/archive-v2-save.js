import { collectArchiveV2 } from './archive-v2-collect.js';

// Export directly to a user-selected file when supported. Mobile browsers use
// an origin-private temporary file rather than retaining the entire ZIP in JS.
export async function saveArchiveV2({applicationId,filename,onProgress}){
  let handle,root,tempName,writable,finished=false;
  try{
    if(typeof globalThis.showSaveFilePicker==='function'){
      handle=await globalThis.showSaveFilePicker({suggestedName:filename,types:[{description:'海岸归档 ZIP',accept:{'application/zip':['.zip']}}]});
    }else{
      if(!navigator.storage?.getDirectory)throw Error('当前浏览器不支持大文件暂存，请使用 Native 或旧版 JSON 导出。');
      root=await navigator.storage.getDirectory();
      tempName='coast-v2-'+crypto.randomUUID()+'.zip';
      handle=await root.getFileHandle(tempName,{create:true});
    }
    writable=await handle.createWritable();
    const manifest=await collectArchiveV2({applicationId,onProgress,sink:{
      write:b=>writable.write(b),
      close:async()=>{await writable.close();finished=true;},
      abort:async()=>{if(!finished)await writable.abort();}
    }});
    if(root){
      const file=await handle.getFile();
      const url=URL.createObjectURL(file),a=document.createElement('a');
      a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      // Keep the backing file while the browser starts the download.
      const cleanup=()=>{URL.revokeObjectURL(url);root.removeEntry(tempName).catch(()=>{});};
      setTimeout(cleanup,120000);
      tempName=null;
    }
    return manifest;
  }catch(e){
    if(writable&&!finished)await writable.abort().catch(()=>{});
    if(root&&tempName)await root.removeEntry(tempName).catch(()=>{});
    throw e;
  }
}
