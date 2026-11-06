// Run the host without Electron (handy for development or a headless box):
//   npm run server            -> http://127.0.0.1:47430
//   PORT=5000 SAVE=./campaign.json npm run server
// Then expose it with:  cloudflared tunnel --url http://127.0.0.1:47430
import { startServer } from './server.js';

const s = await startServer({ port: Number(process.env.PORT || 47430), savePath: process.env.SAVE || null });
console.log(`Desert Command host running at ${s.url}`);
console.log(`Open ${s.url}/?host=${s.hostToken} to join as the host.`);
