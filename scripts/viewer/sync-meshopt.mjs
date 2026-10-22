// Copia do decoder UMD com aviso MIT preservado; sem dependencia de CDN na visita.
import {copyFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
const require = createRequire(import.meta.url);
const folder = fileURLToPath(new URL('../../apps/viewer/public/meshopt/', import.meta.url));
await mkdir(folder, {recursive: true});
await copyFile(require.resolve('meshoptimizer/decoder.cjs'), `${folder}/meshopt_decoder.js`);
await copyFile(join(dirname(require.resolve('meshoptimizer/decoder.cjs')), 'LICENSE.md'), `${folder}/LICENSE.md`);
