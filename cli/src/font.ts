import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import { setFont } from "./render";

export const FONT_PATH = fileURLToPath(new URL("../fonts/Poah-Regular.ttf", import.meta.url));

const buf = readFileSync(FONT_PATH);
setFont(opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
