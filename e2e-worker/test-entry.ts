import {createWorker,GameRoom as ProductionRoom} from '../worker/index';

const fixtureFetch:typeof fetch=(input,init)=>{
 const original=new URL(input instanceof Request?input.url:input);
 const url=new URL(original.pathname+original.search,'http://127.0.0.1:8798');
 return fetch(input instanceof Request?new Request(url,input):url,init);
};

export class GameRoom extends ProductionRoom {
 protected outbound(input:Parameters<typeof fetch>[0],init?:RequestInit){return fixtureFetch(input,init);}
 protected resolveCallback(hostname:string){
  if(hostname==='callback.example.test'||hostname==='another-callback.example.test')return Promise.resolve(['8.8.8.8']);
  if(hostname==='private-callback.example.test')return Promise.resolve(['8.8.8.8','127.0.0.1']);
  return super.resolveCallback(hostname);
 }
}

export default createWorker(fixtureFetch);
