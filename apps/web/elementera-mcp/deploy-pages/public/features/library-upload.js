// The model sees bounded excerpts; the owner uploads a book in small atomic batches.
export async function uploadTidalBook({base,book,requestJson,onProgress=()=>{}}) {
  const chapters=book?.chapters||[];
  const total_chars=chapters.reduce((n,c)=>n+String(c.body||'').trim().length,0);
  if(!chapters.length)throw new Error('电子书没有可阅读的章节。');
  const begin=await requestJson(`${base}/imports`,{
    method:'POST',body:JSON.stringify({
      title:book.title,format:book.format,chapters_count:chapters.length,total_chars,
    }),
  });
  const id=begin.import.id;
  const limits=begin.limits||begin.import.limits||{};
  const perBatch=Number(limits.import_batch_chapters)||8;
  const perChars=Number(limits.import_batch_chars)||120000;
  let cursor=0;
  try {
    while(cursor<chapters.length) {
      const slice=[];
      let size=0;
      while(cursor+slice.length<chapters.length && slice.length<perBatch) {
        const next=chapters[cursor+slice.length];
        const chars=String(next.body||'').trim().length;
        if(chars>perChars)throw new Error('电子书的单章过长，无法安全分批上传。');
        if(slice.length && size+chars>perChars)break;
        slice.push(next);
        size+=chars;
      }
      const start_index=cursor;
      const options={method:'POST',body:JSON.stringify({start_index,chapters:slice})};
      // Both retries are identical; server deduplicates successfully received batches.
      let response;
      try{response=await requestJson(`${base}/imports/${encodeURIComponent(id)}/chapters`,options);}
      catch(firstError){
        try{response=await requestJson(`${base}/imports/${encodeURIComponent(id)}/chapters`,options);}
        catch{throw firstError;}
      }
      cursor=response.progress.next_index;
      onProgress(cursor,chapters.length);
    }
    const finished=await requestJson(`${base}/imports/${encodeURIComponent(id)}/finish`,{
      method:'POST',body:'{}',
    });
    return finished.book;
  } catch(error) {
    // Aborted imports are never shown in the shelf; best-effort rollback on errors.
    await requestJson(`${base}/imports/${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>{});
    throw error;
  }
}
