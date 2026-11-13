import {prepareRoom} from './race/network';import {mountRace} from './race/ui';
try{if(new URLSearchParams(location.search).has('track'))await import('./race/flythrough');else mountRace(await prepareRoom());}catch(error){document.getElementById('app')!.textContent=error instanceof Error?error.message:'Unable to connect';}
