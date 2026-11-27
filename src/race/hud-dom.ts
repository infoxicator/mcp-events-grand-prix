export function setAttributeIfChanged(node:Element,key:string,value:string){
 if(node.getAttribute(key)!==value)node.setAttribute(key,value);
}
export function moveMapDot(node:Element,point:{x:number;z:number}){
 setAttributeIfChanged(node,'cx',point.x.toFixed(1));
 setAttributeIfChanged(node,'cy',point.z.toFixed(1));
}
export function setTextIfChanged(node:Element,value:string){
 if(node.textContent!==value)node.textContent=value;
}
