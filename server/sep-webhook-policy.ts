export function httpsCallbackUrl(value:string){
 const url=URL.parse(value);
 return url?.protocol==='https:'&&!url.username&&!url.password&&!url.hash?url:null;
}
