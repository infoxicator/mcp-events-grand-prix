/** Called directly from a click: legacy copy works in sandbox hosts that deny Async Clipboard. */
export async function copyInvitation(input:HTMLInputElement):Promise<boolean>{
  input.focus();input.select();input.setSelectionRange(0,input.value.length);
  try{if(document.execCommand('copy'))return true;}catch{}
  try{await navigator.clipboard.writeText(input.value);return true;}catch{
    input.focus();input.select();return false;
  }
}
