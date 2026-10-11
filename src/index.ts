/*
 * Coded M4Nually by: pxcvbe & Ivan.K
 * Date: 11/10/2026
 */
import { serve } from "bun"
import index from "./index.html"

const server = serve({
  port: 5173,
  routes: {
    "/*": index,
    "/api/hello": () => Response.json({message: "Hello, world!" }),
  },
  // Enable dev features only when NODE_ENV=development
  development: process.env.NODE_ENV === "development" && {
    hmr: true,     // push client updates without full page reload
    console: true, // surface browser console logs/errors in terminal
  },
})

console.log(`Server is running on ${server.url}`)