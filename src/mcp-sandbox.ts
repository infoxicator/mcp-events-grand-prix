// Double-iframe relay adapted from the official ext-apps basic-host example.
if(window.parent===window)throw new Error('Sandbox requires an MCP host');
const referrer=new URL(document.referrer),expectedHost=referrer.origin;
if(referrer.protocol!=='http:'||!['127.0.0.1','localhost'].includes(referrer.hostname)||Number(referrer.port)!==Number(location.port)-1)throw new Error('Unexpected sandbox host');
try{void window.top!.document;throw new Error('Sandbox must have a different origin from the host');}catch(e){if(!(e instanceof DOMException))throw e;}
const inner=document.createElement('iframe');inner.title='Jev Pong MCP App';inner.sandbox.add('allow-scripts','allow-same-origin','allow-forms');document.body.append(inner);
window.addEventListener('message',event=>{
  if(event.source===parent&&event.origin===expectedHost){
    if(event.data?.method==='ui/notifications/sandbox-resource-ready'){
      const html=event.data.params?.html;if(typeof html!=='string')return;
      // about:blank inherits this isolated sandbox origin, never the host origin.
      const doc=inner.contentDocument!;doc.open();doc.write(html);doc.close();
    }else inner.contentWindow?.postMessage(event.data,location.origin);
  }else if(event.source===inner.contentWindow&&event.origin===location.origin){parent.postMessage(event.data,expectedHost);}
});
parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},expectedHost);
