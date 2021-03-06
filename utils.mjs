import fg from 'fast-glob';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import resolvePackage from 'resolve';
import url from 'url';

const MAX_RETRY = 30;

const packageJSONMap = new Map;

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const intfs of Object.values(interfaces)) {
    for (const intf of intfs) {
      if (intf.family === 'IPv4' && !intf.internal) return intf;
    }
  }
  return null;
};

const { address: LOCAL_IP } = getLocalIP();

const WORKER_REXP = /(worker|sw)\d*\b/i;

export const HTTP_CODES = {
  INTERNAL_SERVER_ERROR: 500,
  NOT_ACCEPTABLE: 406,
  NOT_FOUND: 404,
  NOT_MODIFIED: 304,
  OK: 200,
};

export const WATCH_EXTENSIONS = [
  'pug',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'js',
  'jsx',
  'es6',
  'mjs',
  'vue',
  'svelte',
  'json',
  'ts',
  'tsx',
  'coffee',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'glsl',
  'vert',
  'frag',
];

export const pathToURL = filePath => url.pathToFileURL(filePath).href.slice('file://'.length).replace(/^[a-zA-Z]:/, '');

export const urlToPath = urlPath => path.sep === '\\' ? urlPath.replace(/\//g, '\\') : urlPath;

export const getVersion = (dependencies, name) => {
  if (!dependencies) return {};
  const version = dependencies[name];
  if (!version) return {};
  const [ major, minor, patch ] = version.match(/\d+/g);
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
};

const matchesModule = (filePath, module) =>
  filePath === `/node_modules/${module}` || filePath.startsWith(`/node_modules/${module}/`);

export const isMap = filePath => path.extname(filePath).toLowerCase() === '.map';

export const isTest = filePath => filePath.startsWith('/test/');

export const isVendor = filePath => filePath.startsWith('/node_modules/');

export const isPolyfill = filePath => matchesModule(filePath, 'core-js') ||
  matchesModule(filePath, 'buffer') ||
  matchesModule(filePath, 'base64-js') ||
  matchesModule(filePath, 'ieee754') ||
  matchesModule(filePath, 'process') ||
  matchesModule(filePath, 'regenerator-runtime');

export const isInternal = filePath =>
  filePath.includes('/hq-livereload.js') || filePath.includes('/hq-empty-module.js');

export const isCertificate = (filePath, app) => app.certs.includes(filePath);

export const isWorker = filePath => WORKER_REXP.test(filePath);

export const isDefaultFavicon = filePath => filePath.endsWith('favicon.ico');

export const isAngularCompiler = filePath => filePath.endsWith('compiler/fesm5/compiler.js');

export const isSource = ext => [
  '.pug',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.js',
  '.jsx',
  '.mjs',
  '.es6',
  '.vue',
  '.svelte',
  '.ts',
  '.tsx',
  '.coffee',
  '.map',
].includes(ext);

export const getResType = ext => {
  switch (ext) {
    case '.jsx':
    case '.ts':
    case '.tsx':
    case '.es6':
    case '.vue':
    case '.svelte':
    case '.coffee': return '.js';
    case '.scss':
    case '.sass':
    case '.less': return '.css';
    case '.pug': return '.html';
    default: return ext;
  }
};

/* eslint-disable complexity */
// TODO: delete this method it is unused
export const getLinkType = (ext, name) => {
  // TODO add other types https://w3c.github.io/preload/#as-attribute
  switch (ext) {
    case '.js':
    case '.jsx':
    case '.es6':
    case '.vue':
    case '.svelte':
    case '.ts':
    case '.tsx':
    case '.coffee':
    case '.mjs': return WORKER_REXP.test(name) ? 'worker' : 'script';
    case '.json': return 'script';
    case '.scss':
    case '.sass':
    case '.less':
    case '.css': return 'style';
    case '.pug':
    case '.html': return 'document';
    case '.woff':
    case '.woff2': return 'font';
    case '.gif':
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.svg':
    case '.webp': return 'image';
    default: return '';
  }
};
/* eslint-enable complexity */

export const findExistingExtension = async filepath => {
  if (filepath.endsWith('index') && await fs.pathExists(`${filepath}.html`)) return '.html';
  else if (await fs.pathExists(`${filepath}.jsx`)) return '.jsx';
  else if (await fs.pathExists(`${filepath}.vue`)) return '.vue';
  else if (await fs.pathExists(`${filepath}.svelte`)) return '.svelte';
  else if (await fs.pathExists(`${filepath}.mjs`)) return '.mjs';
  else if (await fs.pathExists(`${filepath}.json`)) return '.json';
  else if (await fs.pathExists(`${filepath}.ts`)) return '.ts';
  else if (await fs.pathExists(`${filepath}.tsx`)) return '.tsx';
  else if (await fs.pathExists(`${filepath}.coffee`)) return '.coffee';
  else if (await fs.pathExists(`${filepath}.es6`)) return '.es6';
  else if (await fs.pathExists(`${filepath}.js`)) return '.js';
  else if (await fs.pathExists(filepath)) return '';
  else if (!filepath.endsWith('index') && await fs.pathExists(`${filepath}.html`)) return '.html';
  else throw new Error(`File ${filepath} not found`);
};

export const getModulePath = filepath => {
  const parts = pathToURL(filepath).split('/node_modules/');
  return `/node_modules/${parts[parts.length - 1]}`;
};

export const getPackageJSONDir = async dir => {
  let dirPath = dir;
  let prev = '';
  while (dirPath !== prev && !await fs.pathExists(path.join(dirPath, 'package.json'))) {
    prev = dirPath;
    dirPath = path.join(dirPath, '..');
  }
  if (!await fs.pathExists(path.join(dirPath, 'package.json'))) return null;
  return dirPath;
};

export const readPackageJSON = async (
  dir,
  { search = true } = {},
  fields = [ 'browser', 'main', 'module', 'version' ],
) => {
  const dirPath = search ? await getPackageJSONDir(dir) : dir;
  if (packageJSONMap.has(dirPath)) return packageJSONMap.get(dirPath);
  try {
    const packageJSON = JSON.parse(await fs.readFile(path.join(dirPath, 'package.json'), { encoding: 'utf8' }));
    const filteredJSON = {};
    for (const field of fields) {
      filteredJSON[field] = packageJSON[field];
    }
    packageJSONMap.set(dirPath, filteredJSON);
    return filteredJSON;
  } catch {
    return {};
  }
};

export const resolvePackageMain = async (dir, { search = false } = {}) => {
  const dirPath = search ? await getPackageJSONDir(dir) : dir;
  const packageJSON = await readPackageJSON(dirPath, { search: false });
  return packageJSON.module ||
    (typeof packageJSON.browser === 'string' && packageJSON.browser) ||
    (
      typeof packageJSON.browser === 'object' &&
      packageJSON.browser && packageJSON.main &&
      (packageJSON.browser[`./${packageJSON.main}`] || packageJSON.browser[packageJSON.main])
    ) ||
    packageJSON.main ||
    `index${await findExistingExtension(`${dirPath}/index`)}`;
};

const resolveOrModify = (pkgPath, pkg, { emptyPath, resolve, result }) => {
  const pkgBasename = pkgPath.slice(0, -path.extname(pkgPath).length);
  if (typeof pkg.browser[pkgPath] === 'string') {
    result.modified = true;
    pkg.main = pkg.browser[pkgPath];
  } else if (typeof pkg.browser[pkgPath] === 'boolean') {
    result.resolved = true;
    resolve(emptyPath);
  } else if (typeof pkg.browser[`./${pkgPath}`] === 'string') {
    result.modified = true;
    pkg.main = pkg.browser[`./${pkgPath}`];
  } else if (typeof pkg.browser[`./${pkgPath}`] === 'boolean') {
    result.resolved = true;
    resolve(emptyPath);
  } else if (typeof pkg.browser[`./${pkgPath}.js`] === 'string') {
    result.modified = true;
    pkg.main = pkg.browser[`./${pkgPath}.js`];
  } else if (typeof pkg.browser[`./${pkgPath}.js`] === 'boolean') {
    result.resolved = true;
    resolve(emptyPath);
  } else if (typeof pkg.browser[`./${pkgBasename}.js`] === 'string') {
    result.modified = true;
    pkg.main = pkg.browser[`./${pkgBasename}.js`];
  } else if (typeof pkg.browser[`./${pkgBasename}.js`] === 'boolean') {
    result.resolved = true;
    resolve(emptyPath);
  }
};

export const resolvePackageFrom = (basedir, dpath, hqroot) => new Promise((resolve, reject) => {
  const emptyPath = path.resolve(hqroot, 'hq-empty-module.js');
  const parts = dpath.split('/node_modules/');
  const modName = parts[parts.length - 1];
  const modPath = modName
    .split('/')
    .slice(1)
    .join('/');
  const modResolve = resolvePackage.isCore(modName) ? `${modName}/` : modName;
  const result = {
    modified: false,
    resolved: false,
  };
  return resolvePackage(
    modResolve,
    {
      basedir,
      extensions: [
        '.js',
        '.jsx',
        '.mjs',
        '.es6',
        '.vue',
        '.svelte',
        '.ts',
        '.tsx',
        '.coffee',
        '.css',
        '.scss',
        '.sass',
        '.less',
        '.pug',
        '.html',
      ],
      packageFilter(pkg) {
        const { main: pkgMain } = pkg;
        if (pkg.module) pkg.main = pkg.module;
        if (typeof pkg.browser === 'string') pkg.main = pkg.browser;
        else if (typeof pkg.browser === 'object' && pkg.browser) {
          if (modPath) {
            resolveOrModify(modPath, pkg, { emptyPath, resolve, result });
          } else if (pkgMain) {
            resolveOrModify(pkgMain, pkg, { emptyPath, resolve, result });
          } else if (pkg.module) {
            resolveOrModify(pkg.module, pkg, { emptyPath, resolve, result });
          }
        }
        return pkg;
      },
      pathFilter(pkg, fullPath, relativePath) {
        return result.modified ? pkg.main : relativePath;
      },
    },
    (err, p) => {
      if (result.resolved) return;
      if (err) reject(err);
      resolve(p);
    },
  );
});

export const readPlugins = async (app, config) => {
  try {
    const { plugins } = JSON.parse(await fs.readFile(config, { encoding: 'utf-8' }));
    const pluginsConfig = await Promise.all(plugins.map(async p => {
      const [ pluginName, ...args ] = Array.isArray(p) ? p : [ p ];
      const pluginPath = await resolvePackageFrom(app.root, `/node_modules/${pluginName}`, app.hqroot);
      const { default: plugin } = await import(pluginPath);
      return { args, plugin };
    }));
    return pluginsConfig.map(({ args, plugin }) => plugin(...args));
  } catch {
    return [];
  }
};

/* eslint-disable no-unused-expressions */
const getFreeServer = ({
  app,
  certs,
  cfg,
  host,
  net,
  port,
  retry,
  root,
  s,
  secure,
}) => new Promise((resolve, reject) => {
  const server = secure ?
    net.createSecureServer({ allowHTTP1: true, ...cfg }, app.callback()) :
    net.createServer(app.callback());
  server.unref();
  server.on('error', reject);
  // Next 2 lines required for vscode plugin
  server.localIP = LOCAL_IP;
  server.protocol = `http${s}`;
  server.listen(port, host, () => {
    if (!app.build) {
      console.log(`Start time: ${process.uptime().toFixed(1)} s`);
      console.log(`Visit http${s}://localhost:${port}\nor http${s}://${LOCAL_IP}:${port} within local network`);
    } else {
      console.log('Building...');
    }
    import('./compilers/html.mjs');
    resolve({
      certs: certs.map(crt => crt.slice(root.length)),
      server,
    });
  });
}).catch(err => {
  if (retry > MAX_RETRY) throw err;
  return getFreeServer({ app, certs, cfg, host, net, port: port + 1, retry: retry + 1, root, s, secure });
});
/* eslint-enable no-unused-expressions */

export const getServer = async ({ app, host, port, root }) => {
  const certs = await fg(`${root}/**/*.pem`, { ignore: [ `${root}/node_modules/**` ] });
  const cfg = (await Promise.all(certs.slice(0, 2).map(crt => fs.readFile(crt))))
    .reduce(
      ({ cert, key }, file, index) => certs[index].endsWith('key.pem') ?
        { cert, key: file } :
        { cert: file, key },
      { cert: null, key: null },
    );
  const secure = Boolean(cfg.cert && cfg.key);
  const s = secure ? 's' : '';
  const net = await (secure ?
    import('http2') :
    import('http')
  );

  return getFreeServer({
    app,
    certs,
    cfg,
    host,
    net,
    port,
    retry: 0,
    root,
    s,
    secure,
  });
};

export const getSrc = async root => {
  const [ packageJSON, rootHTML, srcHTML, srcExists ] = await Promise.all([
    readPackageJSON(root),
    fs.pathExists(path.join(root, './index.html')),
    fs.pathExists(path.join(root, 'src/index.html')),
    fs.pathExists(path.join(root, 'src')),
  ]);
  return packageJSON.module ?
    path.dirname(packageJSON.module) :
    srcHTML ?
      'src' :
      rootHTML ?
        '.' :
        srcExists ?
          'src' :
          packageJSON.main ?
            path.dirname(packageJSON.main) :
            '.';
};
