import { readFile, writeFile } from "node:fs/promises";

const path = "services/indro-mcp/src/index.ts";
let source = await readFile(path, "utf8");

if (!source.includes('from "./home-tools"')) {
  source = source.replace(
    'import { createMcpHandler } from "agents/mcp/server";',
    'import { createMcpHandler } from "agents/mcp/server";\nimport { registerHomeTools } from "./home-tools";'
  );
}

const oldHome = /server\.registerTool\("commandhud\.home\.status"[\s\S]*?\}\);\s*(?=server\.registerTool\("commandhud\.projects"|return server;)/;
source = source.replace(oldHome, "");

const oldProjects = /server\.registerTool\("commandhud\.projects"[\s\S]*?\}\);\s*(?=return server;)/;
source = source.replace(oldProjects, "");

if (!source.includes("registerHomeTools(server, env);")) {
  source = source.replace(/\s*return server;/, "\n        registerHomeTools(server, env);\n        return server;");
}

await writeFile(path, source);
console.log("Applied CommandHUD home tool registration.");
