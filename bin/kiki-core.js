#!/usr/bin/env node
import { exec } from "node:child_process";
import { serve } from "../src/server.js";
import { HOME } from "../src/store.js";

const port = Number(process.env.PORT) || 4747;
const server = await serve(port);
const url = `http://127.0.0.1:${server.address().port}`;
console.log(`\n  \x1b[38;2;253;137;12m◆ kiki-core\x1b[0m  ${url}\n  data: ${HOME}${process.env.KIKI_MOCK ? "\n  demo mode: canned replies, no API key needed" : ""}\n`);

if (!process.env.NO_OPEN) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start \"\"" : "xdg-open";
  exec(`${cmd} ${url}`, () => {});
}
