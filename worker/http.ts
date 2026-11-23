export const privateHeaders = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
export const json = (value: unknown, status = 200) => Response.json(value,{status,headers:privateHeaders});

export async function readSmallBody(req: Request) {
 const stream = req.body?.getReader();
 if (!stream) return '';
 const decoder = new TextDecoder();
 let length = 0, body = '';
 try {
  while (true) {
   const {value,done} = await stream.read();
   if (done) return body + decoder.decode();
   length += value.length;
   if (length > 4096) {
    await stream.cancel();
    return null;
   }
   body += decoder.decode(value,{stream:true});
  }
 } finally {
  stream.releaseLock();
 }
}
