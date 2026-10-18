import { makeServer } from './server.js';
const server=await makeServer({logger:true});
const close=async()=>{await server.close();process.exit(0);};
process.once('SIGINT',close);process.once('SIGTERM',close);
await server.listen({port:Number(process.env.PORT ?? 3001),host:process.env.HOST ?? '0.0.0.0'});
