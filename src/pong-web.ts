import { mountArena } from './main';
import { prepareRoom,showHostingError } from './hosting';
try{mountArena(await prepareRoom());}catch(error){showHostingError(error);}
