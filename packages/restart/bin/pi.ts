#!/usr/bin/env node

import { main } from "../launcher.ts";

process.exitCode = await main(process.argv.slice(2));
