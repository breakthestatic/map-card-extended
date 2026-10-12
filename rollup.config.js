import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

// Replace the __VERSION__ token with the package version at build time, so the
// console banner reports the shipped version without a CI sed step.
const injectVersion = {
  name: 'inject-version',
  renderChunk(code) {
    return code.replace(/__VERSION__/g, version);
  },
};

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/map-card-extended.js',
    format: 'cjs'
  },
  plugins: [nodeResolve(), commonjs(), injectVersion]
};
