import { createHandler } from './handler.js';

Deno.serve(createHandler({ env: name => Deno.env.get(name), fetcher: fetch }));
