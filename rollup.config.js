import resolve from 'rollup-plugin-node-resolve';
import babel from 'rollup-plugin-babel';

export default {
  entry: 'src/client.js',
  moduleName: 'Client',
  indent: '\t',
  format: 'iife', // or es
  plugins: [
    resolve(),
    babel({
      presets: [['es2015', { modules: false }]],
      include: 'src/**', // only transpile our source code
    }),
  ],
  dest: 'build/eratosthene.js',
  sourceMap: true,
};
