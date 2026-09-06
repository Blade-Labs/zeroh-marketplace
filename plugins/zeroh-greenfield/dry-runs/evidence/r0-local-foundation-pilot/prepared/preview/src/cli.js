#!/usr/bin/env node
import { greet } from './index.js';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node src/cli.js <name>');
} else if (args.length !== 1 || !args[0].trim()) {
  console.error('Usage: node src/cli.js <name>');
  process.exitCode = 1;
} else {
  console.log(greet(args[0].trim()));
}
