import {circuitClusters} from './scripts/circuit-clusters';
import {getTrack} from './src/race/track';
import {defineConfig} from 'vite';

// Ship the immutable three-metre racing line with the iframe. Solving the
// constrained path at startup repeats the same 1,000 relaxation sweeps.
const racingLines=Object.fromEntries((['monza','las-vegas'] as const).map(id=>{
 const track=getTrack(id),count=Math.ceil(track.LENGTH/3),step=track.LENGTH/count;
 return [id,Array.from({length:count},(_,i)=>track.racingLineOffset(i*step))];
}));

export default defineConfig({
 base:'./',
 publicDir:false,plugins:[circuitClusters()],
 define:{'import.meta.env.MCP_APP':JSON.stringify('true'),__MCP_RACING_LINES__:JSON.stringify(racingLines)},
 build:{outDir:'dist/mcp',emptyOutDir:true,rollupOptions:{input:'mcp-app.html'}},
});
