import { createServer } from "node:http";
import { discoverProjects } from "../../packages/commandhud/core.mjs";

const host = "127.0.0.1";
const port = Number(process.env.COMMANDHUD_HOME_PORT || 8788);

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, { executor: "home-windows", status: "ready" });
    }
    if (request.method === "GET" && url.pathname === "/projects") {
      const projects = (await discoverProjects()).map(({ root, ...project }) => project);
      return send(response, 200, { executor: "home-windows", capability: "commandhud.projects", projects });
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    return send(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`CommandHUD home worker listening on http://${host}:${port}`);
});
