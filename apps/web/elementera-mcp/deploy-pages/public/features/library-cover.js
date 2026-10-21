// Book covers are optional private furniture: downscale before the server's 600KB cap.
export async function prepareTidalCover(file) {
  if(!file || !['image/jpeg','image/png'].includes(file.type))throw Error('请选择 JPEG 或 PNG 封面。');
  if(file.size>15*1024*1024)throw Error('原图超过 15 MB，请先缩小再上传。');
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('无法读取这张封面。'));img.src=url;});
    if(!img.naturalWidth||!img.naturalHeight)throw Error('封面图片无效。');
    const scale=Math.min(1,360/img.naturalWidth,540/img.naturalHeight);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    for(const quality of [.86,.72,.58]){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob && blob.size<=600*1024)return blob;
    }
    throw Error('封面仍超过 600 KB，请裁剪后再试。');
  }finally{URL.revokeObjectURL(url);}
}
export async function uploadTidalCover(base,bookId,file) {
  const cover=await prepareTidalCover(file);
  const response=await fetch(`${base}/books/${encodeURIComponent(bookId)}/cover`,{
    method:'PUT',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':cover.type,'Accept':'application/json'},body:cover,
  });
  const value=await response.json().catch(()=>({}));
  if(!response.ok || value.ok===false)throw Error(value.error?.message||`封面上传失败（${response.status}）`);
  return value.cover;
}
